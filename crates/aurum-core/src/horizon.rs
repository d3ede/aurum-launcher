//! Optional native engine. Builds and prepared resources are shared; worlds stay per instance.
use crate::{
    minecraft::{extract_zip, hide},
    model::*,
    store::{persist, validate_version},
    Engine, Task,
};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ring::signature::{UnparsedPublicKey, ED25519};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

pub const MINECRAFT: &str = "26.3";
const RELEASE: &str = "https://api.github.com/repos/horizon-rust/horizon/releases/tags/nightly";
pub(crate) const PUBLIC_KEY: &str = "MU4oiIQcCxkZvbwSjjXs7SySCuM6ywRQ3nGaJYZG0gw=";
const ARCHIVE: &str = "horizon-windows-x64.zip";

fn build_complete(directory: &Path) -> bool {
    [
        "verified.json",
        "horizon-client.exe",
        "horizon-prepare.exe",
        "research-lock.json",
        "LICENSE",
    ]
    .iter()
    .all(|name| directory.join(name).is_file())
        && directory.join("exporters").is_dir()
}

fn asset_url<'a>(release: &'a Value, name: &str) -> Result<&'a str> {
    let url = release["assets"]
        .as_array()
        .context("Horizon: нет файлов релиза")?
        .iter()
        .find(|a| a["name"] == name)
        .and_then(|a| a["browser_download_url"].as_str())
        .with_context(|| format!("Horizon: в релизе нет {name}"))?;
    if !url.starts_with("https://github.com/horizon-rust/horizon/releases/download/") {
        bail!("Horizon: неизвестный источник загрузки")
    }
    Ok(url)
}

fn nightly_version(title: &str) -> Result<String> {
    let (date, commit) = title
        .strip_prefix("Nightly ")
        .and_then(|s| s.split_once(" · "))
        .context("Horizon: неизвестный формат версии Nightly")?;
    if date.len() != 10
        || !date.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
        || !(7..=40).contains(&commit.len())
        || !commit
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        bail!("Horizon: некорректная версия Nightly")
    }
    Ok(format!("nightly-{date}-{commit}"))
}

fn signed_digest(version: &str, sums: &str, signatures: &str, key: &[u8]) -> Result<String> {
    let message = format!("horizon release {version}\n{sums}");
    if !signatures
        .lines()
        .filter_map(|s| STANDARD.decode(s.trim()).ok())
        .any(|s| {
            UnparsedPublicKey::new(&ED25519, key)
                .verify(message.as_bytes(), &s)
                .is_ok()
        })
    {
        bail!("Horizon: подпись сборки не прошла проверку. Установка остановлена")
    }
    let matches: Vec<_> = sums
        .lines()
        .filter_map(|line| {
            let (hash, name) = line.split_once(' ')?;
            (name.trim_start_matches([' ', '*']) == ARCHIVE).then_some(hash)
        })
        .collect();
    if matches.len() != 1
        || matches[0].len() != 64
        || !matches[0].bytes().all(|b| b.is_ascii_hexdigit())
    {
        bail!("Horizon: нет однозначной контрольной суммы архива")
    }
    Ok(matches[0].to_ascii_lowercase())
}

fn validate_api(api: &Value, required: &[&str]) -> Result<()> {
    if !api["launch_api"]
        .as_str()
        .is_some_and(|v| v.starts_with("0.1."))
    {
        bail!("Horizon: эта сборка использует неподдерживаемый Launch API. Обновите Aurum")
    }
    let options = api["options"]
        .as_array()
        .context("Horizon: нет списка параметров API")?;
    for name in required {
        if !options.iter().any(|o| o["name"] == *name) {
            bail!("Horizon: сборка не поддерживает параметр {name}")
        }
    }
    if api["minecraft"] != MINECRAFT {
        bail!("Horizon: сборка требует другую версию Minecraft")
    }
    Ok(())
}

async fn probe(program: &Path, directory: &Path) -> Result<Value> {
    let mut command = Command::new(program);
    command
        .arg("--launch-api")
        .current_dir(directory)
        .kill_on_drop(true);
    hide(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(20), command.output())
        .await
        .context("Horizon: проверка API не ответила")??;
    if !output.status.success() {
        bail!("Horizon: эта сборка не поддерживает запуск из Aurum")
    }
    serde_json::from_slice(&output.stdout).context("Horizon: неверный ответ Launch API")
}

impl Engine {
    pub(crate) async fn horizon_owner(&self) -> Result<(Account, String, String)> {
        let account = {
            let db = self.db.lock().await;
            db.accounts
                .iter()
                .find(|a| Some(&a.id) == db.selected_account.as_ref())
                .filter(|a| a.kind == "microsoft")
                .cloned()
                .context(
                    "Horizon: выберите Microsoft-аккаунт с купленной Minecraft: Java Edition",
                )?
        };
        let (token, _, xuid) = self.minecraft_launch_credentials(&account.id).await?;
        let entitlements: Value = self
            .http
            .get("https://api.minecraftservices.com/entitlements/mcstore")
            .bearer_auth(&token)
            .send()
            .await?
            .error_for_status()
            .context("Horizon: не удалось проверить владение Minecraft. Войдите в Microsoft снова")?
            .json()
            .await?;
        if !entitlements["items"].as_array().is_some_and(|items| {
            items.iter().any(|i| {
                matches!(
                    i["name"].as_str(),
                    Some("game_minecraft" | "product_minecraft")
                )
            })
        }) {
            bail!("Horizon: на выбранном аккаунте нет Minecraft: Java Edition")
        }
        Ok((account, token, xuid))
    }

    async fn horizon_build(&self, task: &Task) -> Result<(String, PathBuf)> {
        if !cfg!(all(windows, target_arch = "x86_64")) {
            bail!("Horizon в Aurum пока поддерживается только на Windows x64")
        }
        task.progress("horizon", "Получаем подписанную сборку Horizon", 0, 0);
        let release = self.json(RELEASE).await?;
        let version = nightly_version(
            release["name"]
                .as_str()
                .context("Horizon: нет названия сборки")?,
        )?;
        let sums = self
            .http
            .get(asset_url(&release, "SHA256SUMS")?)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let signature = self
            .http
            .get(asset_url(&release, "SHA256SUMS.v2.sig")?)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let digest = signed_digest(&version, &sums, &signature, &STANDARD.decode(PUBLIC_KEY)?)?;
        let version = format!("{version}-{}", &digest[..12]);
        let directory = self.root.join("horizon/builds").join(&version);
        if !build_complete(&directory) {
            let archive = self
                .root
                .join("horizon/downloads")
                .join(format!("{digest}.zip"));
            let _archive = crate::temporary::Temporary::file(&archive);
            self.download(
                asset_url(&release, ARCHIVE)?,
                &archive,
                Some(("sha256", &digest)),
                task,
            )
            .await?;
            task.progress("horizon", "Распаковываем Horizon", 0, 0);
            // Extraction rejects traversal, links and oversized archives. Publish only the complete tree.
            let staging = self.root.join("horizon/staging").join(&task.id);
            let _staging = crate::temporary::Temporary::directory(&staging);
            extract_zip(&archive, &staging, None, task)?;
            let extracted = staging.join("horizon-windows-x64");
            if !extracted.join("horizon-client.exe").is_file()
                || !extracted.join("horizon-prepare.exe").is_file()
            {
                bail!("Horizon: архив не содержит исполняемые файлы")
            }
            tokio::fs::write(
                extracted.join("verified.json"),
                serde_json::to_vec(&json!({"version":version,"sha256":digest}))?,
            )
            .await?;
            tokio::fs::create_dir_all(directory.parent().unwrap()).await?;
            let backup = directory.with_file_name(format!("{version}.repair-{}", task.id));
            let replacing = directory.exists();
            if replacing {
                tokio::fs::rename(&directory, &backup).await?;
            }
            if let Err(error) = tokio::fs::rename(&extracted, &directory).await {
                if replacing {
                    let _ = tokio::fs::rename(&backup, &directory).await;
                }
                return Err(error.into());
            }
            if replacing {
                let _ = tokio::fs::remove_dir_all(&backup).await;
            }
            let _ = tokio::fs::remove_dir(staging).await;
        }
        Ok((version, directory))
    }

    pub(crate) async fn install_horizon(&self, profile: Profile, task: &Task) -> Result<()> {
        if self.running.lock().await.contains_key(&profile.id) {
            bail!("Сначала остановите игру")
        }
        self.horizon_owner().await?;
        task.check()?;
        let (version, directory) = if let Some(version) = &profile.installed_version {
            validate_version(version)?;
            let directory = self.root.join("horizon/builds").join(version);
            if build_complete(&directory) {
                (version.clone(), directory)
            } else {
                self.horizon_build(task).await?
            }
        } else {
            self.horizon_build(task).await?
        };
        let client = probe(&directory.join("horizon-client.exe"), &directory).await?;
        validate_api(
            &client,
            &[
                "--resources",
                "--game-dir",
                "--home",
                "--session-stdin",
                "--width",
                "--height",
            ],
        )?;
        let prepare = probe(&directory.join("horizon-prepare.exe"), &directory).await?;
        validate_api(
            &prepare,
            &[
                "--prepare",
                "--output",
                "--check",
                "--complete",
                "--progress",
                "--version-json",
                "--client-jar",
                "--libraries-dir",
                "--assets-dir",
                "--java-home",
                "--server-jar",
            ],
        )?;
        let major = prepare["java_major"]
            .as_u64()
            .filter(|m| (17..=40).contains(m))
            .context("Horizon: неподдерживаемая версия Java для подготовки")?
            as u32;
        // Reuse Aurum's verified Mojang downloads. This does not mark the native profile installed.
        self.install_java_files(profile.clone(), task).await?;
        let version_dir = self.root.join("versions").join(MINECRAFT);
        let version_json = version_dir.join(format!("{MINECRAFT}.json"));
        let meta: Value = serde_json::from_slice(&tokio::fs::read(&version_json).await?)?;
        let server = &meta["downloads"]["server"];
        let server_jar = version_dir.join("horizon-server-source.jar");
        let _server_source = crate::temporary::Temporary::file(&server_jar);
        self.download(
            server["url"].as_str().context("Horizon: нет server jar")?,
            &server_jar,
            Some((
                "sha1",
                server["sha1"]
                    .as_str()
                    .context("Horizon: нет SHA1 server jar")?,
            )),
            task,
        )
        .await?;
        let (java, _preparation_tools) = self.preparation_java(major, task).await?;
        let java_home = java
            .parent()
            .and_then(Path::parent)
            .context("Horizon: неверная папка Java")?;
        let resources = self.root.join("horizon/resources").join(&version);
        let mut command = Command::new(directory.join("horizon-prepare.exe"));
        command
            .current_dir(&directory)
            .args(["--prepare", "--complete", "--progress", "json"])
            .arg("--version-json")
            .arg(&version_json)
            .arg("--client-jar")
            .arg(version_dir.join(format!("{MINECRAFT}.jar")))
            .arg("--libraries-dir")
            .arg(self.root.join("libraries"))
            .arg("--assets-dir")
            .arg(self.root.join("assets"))
            .arg("--server-jar")
            .arg(server_jar)
            .arg("--java-home")
            .arg(java_home)
            .arg("--output")
            .arg(resources);
        run_prepare(command, task).await?;
        // The exported resources are standalone; Java exporter inputs can be downloaded again.
        for name in [".local/minecraft", ".local/datagen"] {
            let _ = tokio::fs::remove_dir_all(directory.join(name)).await;
        }
        task.check()?;
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        next.profiles
            .iter_mut()
            .find(|p| p.id == profile.id)
            .context("Сборка удалена")?
            .installed_version = Some(version);
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }

    pub(crate) async fn launch_horizon(
        &self,
        profile: Profile,
        server: Option<crate::servers::ServerAddress>,
        skip_native: bool,
    ) -> Result<()> {
        let version = profile
            .installed_version
            .as_deref()
            .context("Сначала установите Horizon")?;
        validate_version(version)?;
        let directory = self.root.join("horizon/builds").join(version);
        if !build_complete(&directory) {
            bail!("Проверьте установку Horizon: файлы сборки отсутствуют")
        }
        let game_directory = self
            .native_launch_directory(&profile, skip_native)
            .await?
            .unwrap_or_else(|| directory.clone());
        let (account, token, xuid) = self.horizon_owner().await?;
        let client = probe(&game_directory.join("horizon-client.exe"), &game_directory).await?;
        validate_api(
            &client,
            &[
                "--resources",
                "--game-dir",
                "--home",
                "--session-stdin",
                "--width",
                "--height",
            ],
        )?;
        if server.is_some() {
            validate_api(&client, &["--quickPlayMultiplayer"])?;
        }
        let resources = self.root.join("horizon/resources").join(version);
        let mut check = Command::new(directory.join("horizon-prepare.exe"));
        check
            .current_dir(&directory)
            .arg("--check")
            .arg("--output")
            .arg(&resources)
            .kill_on_drop(true);
        hide(&mut check);
        let checked = tokio::time::timeout(Duration::from_secs(20), check.output()).await??;
        if !checked.status.success() {
            bail!("Ресурсы Horizon не готовы. Нажмите «Проверить установку»")
        }
        let settings = self.db.lock().await.settings.clone();
        let instance = self.profile_directory(&profile.id).await?;
        let mut command = Command::new(game_directory.join("horizon-client.exe"));
        command
            .current_dir(&instance)
            .arg("--resources")
            .arg(resources)
            .arg("--game-dir")
            .arg(&instance)
            .arg("--home")
            .arg(&instance)
            .arg("--width")
            .arg(settings.resolution_width.to_string())
            .arg("--height")
            .arg(settings.resolution_height.to_string())
            .arg("--session-stdin")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false);
        if let Some(server) = &server {
            command.arg("--quickPlayMultiplayer").arg(&server.address);
        }
        hide(&mut command);
        let mut child = command.spawn().context("Не удалось запустить Horizon")?;
        let session = serde_json::to_vec(
            &json!({"name":account.name,"uuid":account.uuid,"access_token":token,"user_type":"msa","xuid":xuid}),
        )?;
        let mut stdin = child
            .stdin
            .take()
            .context("Horizon: нет входного канала сессии")?;
        if let Err(error) = stdin.write_all(&session).await {
            let _ = child.kill().await;
            return Err(error.into());
        }
        drop(stdin);
        let task = Task {
            id: uuid::Uuid::new_v4().to_string(),
            profile_id: Some(profile.id.clone()),
            cancel: Arc::new(AtomicBool::new(false)),
            emit: self.emit.clone(),
        };
        self.supervise_game(&profile, child, token, task, server)
            .await
    }
}

async fn run_prepare(mut command: Command, task: &Task) -> Result<()> {
    task.progress(
        "horizon",
        "Подготавливаем ресурсы Horizon — первый запуск займёт несколько минут",
        0,
        0,
    );
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    hide(&mut command);
    let mut child = command
        .spawn()
        .context("Не удалось запустить подготовку Horizon")?;
    let (tx, mut rx) = tokio::sync::mpsc::channel(128);
    for reader in [
        Box::new(child.stdout.take().unwrap()) as Box<dyn tokio::io::AsyncRead + Unpin + Send>,
        Box::new(child.stderr.take().unwrap()),
    ] {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if tx.send(line).await.is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);
    let mut tail = std::collections::VecDeque::new();
    let mut open = true;
    let status = loop {
        tokio::select! {
            status = child.wait() => break status?,
            line = rx.recv(), if open => if let Some(line) = line {
                if tail.len() == 12 { tail.pop_front(); } tail.push_back(line.clone());
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if let Some(fraction) = value["fraction"].as_f64() {
                        task.progress("horizon", "Подготавливаем ресурсы Horizon", (fraction.clamp(0.,1.) * 1000.) as u64, 1000);
                    } else if let Some(message) = value["message"].as_str().or(value["error"].as_str()) { task.progress("horizon", message, 0, 0); }
                } else { task.progress("horizon", &line, 0, 0); }
            } else { open = false; },
            _ = tokio::time::sleep(Duration::from_millis(200)) => { task.check()?; }
        }
    };
    while let Some(line) = rx.recv().await {
        if tail.len() == 12 {
            tail.pop_front();
        }
        tail.push_back(line);
    }
    if !status.success() {
        bail!(
            "Подготовка Horizon завершилась с ошибкой: {status}\n{}",
            tail.into_iter().collect::<Vec<_>>().join("\n")
        )
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::{
        rand::SystemRandom,
        signature::{Ed25519KeyPair, KeyPair},
    };
    #[test]
    fn rejects_tampering_replay_and_missing_archives() {
        let key = Ed25519KeyPair::from_pkcs8(
            Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
                .unwrap()
                .as_ref(),
        )
        .unwrap();
        let sums = format!("{}  {ARCHIVE}\n", "ab".repeat(32));
        let version = "nightly-2026-11-05-abcdef1";
        let signature = STANDARD.encode(
            key.sign(format!("horizon release {version}\n{sums}").as_bytes())
                .as_ref(),
        );
        assert_eq!(
            signed_digest(version, &sums, &signature, key.public_key().as_ref()).unwrap(),
            "ab".repeat(32)
        );
        assert!(signed_digest(
            "nightly-2026-11-06-abcdef1",
            &sums,
            &signature,
            key.public_key().as_ref()
        )
        .is_err());
        assert!(signed_digest(
            version,
            &sums.replace("ab", "cd"),
            &signature,
            key.public_key().as_ref()
        )
        .is_err());
        assert!(signed_digest(version, &sums, "", key.public_key().as_ref()).is_err());
        assert!(nightly_version("Nightly 2026-11-05 · ../../bad").is_err());
    }
    #[test]
    fn requires_supported_api_options_and_minecraft() {
        let api =
            json!({"launch_api":"0.1.0","minecraft":MINECRAFT,"options":[{"name":"--game-dir"}]});
        assert!(validate_api(&api, &["--game-dir"]).is_ok());
        assert!(validate_api(&api, &["--session-stdin"]).is_err());
        assert!(validate_api(&json!({"launch_api":"0.2.0"}), &[]).is_err());
    }
}
