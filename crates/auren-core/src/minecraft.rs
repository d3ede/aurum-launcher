use crate::{
    model::*,
    store::{persist, validate_version},
    Engine, Task,
};
use anyhow::{bail, Context, Result};
use futures_util::{stream, TryStreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

const MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
pub fn os() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}
pub fn architecture() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "x86_64"
    }
}
pub fn allowed(item: &Value, features: &HashMap<String, bool>) -> bool {
    let Some(rules) = item.get("rules").and_then(Value::as_array) else {
        return true;
    };
    let mut allowed = false;
    for rule in rules {
        let mut matches = true;
        if let Some(o) = rule.get("os") {
            if let Some(name) = o["name"].as_str() {
                matches &= name == os();
            }
            if let Some(arch) = o["arch"].as_str() {
                matches &= arch == architecture() || (arch == "x86" && cfg!(target_arch = "x86"));
            }
            if o.get("version").is_some() {
                matches = false;
            } // Fail closed for unsupported legacy OS-specific rules.
        }
        if let Some(fs) = rule["features"].as_object() {
            for (name, expected) in fs {
                matches &= features.get(name).copied().unwrap_or(false)
                    == expected.as_bool().unwrap_or(false);
            }
        }
        if matches {
            allowed = rule["action"] == "allow";
        }
    }
    allowed
}
pub fn maven_path(name: &str) -> Result<String> {
    let (name, extension) = name.split_once('@').unwrap_or((name, "jar"));
    let p: Vec<_> = name.split(':').collect();
    if !(3..=4).contains(&p.len()) {
        bail!("Некорректные Maven-координаты")
    }
    let classifier = p.get(3).map(|v| format!("-{v}")).unwrap_or_default();
    let path = format!(
        "{}/{}/{}/{}-{}{classifier}.{extension}",
        p[0].replace('.', "/"),
        p[1],
        p[2],
        p[1],
        p[2]
    );
    crate::safe_join(Path::new("libraries"), &path)?;
    Ok(path)
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key]
        .as_str()
        .with_context(|| format!("В метаданных отсутствует {key}"))
}
fn library_key(name: &str) -> String {
    let (coordinate,ext)=name.split_once('@').unwrap_or((name,"jar"));
    let parts:Vec<_>=coordinate.split(':').collect();
    format!("{}:{}:{}@{}",parts.first().unwrap_or(&""),parts.get(1).unwrap_or(&""),parts.get(3).unwrap_or(&""),ext)
}
pub fn library_allowed(lib:&Value,features:&HashMap<String,bool>)->bool {
    if !allowed(lib,features){return false}
    if let Some(classifier)=lib["name"].as_str().and_then(|s|s.split(':').nth(3)) {
        if classifier.starts_with("natives-") {
            if classifier.ends_with("-arm64"){return cfg!(target_arch="aarch64")}
            if classifier.ends_with("-x86"){return cfg!(target_arch="x86")}
            return !cfg!(target_arch="aarch64") && !cfg!(target_arch="x86");
        }
    }
    true
}
pub fn merge(base: &mut Value, extra: Value) {
    for key in ["mainClass", "id", "type", "javaVersion", "logging"] {
        if let Some(v) = extra.get(key) {
            base[key] = v.clone();
        }
    }
    if let Some(new) = extra["libraries"].as_array() {
        let libs = base["libraries"].as_array_mut().unwrap();
        for lib in new {
            let name = lib["name"].as_str().unwrap_or("");
            let key = library_key(name);
            libs.retain(|l| library_key(l["name"].as_str().unwrap_or("")) != key);
            libs.push(lib.clone());
        }
    }
    for side in ["jvm", "game"] {
        if let Some(new) = extra["arguments"][side].as_array() {
            if !base["arguments"][side].is_array() {
                base["arguments"][side] = json!([]);
            }
            base["arguments"][side]
                .as_array_mut()
                .unwrap()
                .extend(new.clone());
        }
    }
    if let Some(old) = extra.get("minecraftArguments") {
        base["minecraftArguments"] = old.clone();
    }
}
impl Engine {
    pub async fn minecraft_versions(&self) -> Result<Value> {
        self.json(MANIFEST).await
    }
    pub async fn loader_versions(&self, mc: &str, loader: Loader) -> Result<Vec<String>> {
        validate_version(mc)?;
        match loader {
            Loader::Vanilla => Ok(vec![]),
            Loader::Fabric | Loader::Quilt => {
                let host = if loader == Loader::Fabric {
                    "https://meta.fabricmc.net/v2"
                } else {
                    "https://meta.quiltmc.org/v3"
                };
                let v = self.json(&format!("{host}/versions/loader/{mc}")).await?;
                Ok(v.as_array()
                    .context("Неизвестный ответ загрузчика")?
                    .iter()
                    .filter_map(|v| v["loader"]["version"].as_str().map(String::from))
                    .collect())
            }
            Loader::Forge => {
                let xml = self.http.get("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml").send().await?.error_for_status()?.text().await?;
                let re = regex::Regex::new(r"<version>([^<]+)</version>")?;
                let prefix = format!("{mc}-");
                let mut versions: Vec<_> = re
                    .captures_iter(&xml)
                    .filter_map(|c| c[1].strip_prefix(&prefix).map(String::from))
                    .collect();
                versions.reverse();
                Ok(versions)
            }
            Loader::Neoforge => {
                let xml = self.http.get("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml").send().await?.error_for_status()?.text().await?;
                let re = regex::Regex::new(r"<version>([^<]+)</version>")?;
                // NeoForge 20.2+ version numbering maps to 1.20.2+; 1.20.1 used Forge coordinates.
                let parts: Vec<_> = mc.split('.').collect();
                if parts.first() != Some(&"1") || parts.len() < 2 {
                    return Ok(vec![]);
                }
                let prefix = format!("{}.{}.", parts[1], parts.get(2).unwrap_or(&"0"));
                let mut versions: Vec<_> = re
                    .captures_iter(&xml)
                    .filter(|c| c[1].starts_with(&prefix))
                    .map(|c| c[1].into())
                    .collect();
                versions.reverse();
                Ok(versions)
            }
        }
    }
    pub async fn install(&self, id: &str, task: &Task) -> Result<()> {
        let profile = self.profile(id).await?;
        if self.running.lock().await.contains_key(id) {
            bail!("Игра уже запущена")
        }
        task.progress("metadata", "Получаем метаданные Minecraft", 0, 0);
        let manifest = self.minecraft_versions().await?;
        let version = manifest["versions"]
            .as_array()
            .context("Нет списка версий")?
            .iter()
            .find(|v| v["id"] == profile.minecraft)
            .context("Версия Minecraft не найдена")?;
        let path = self
            .root
            .join("versions")
            .join(&profile.minecraft)
            .join(format!("{}.json", profile.minecraft));
        self.download(
            text(version, "url")?,
            &path,
            version["sha1"].as_str().map(|s| ("sha1", s)),
            task,
        )
        .await?;
        let mut meta: Value = serde_json::from_slice(&tokio::fs::read(&path).await?)?;
        if !meta["assetIndex"].is_object() {
            bail!("Версии до assetIndex не поддерживаются; выберите Minecraft 1.6 или новее")
        }
        let required_java = meta["javaVersion"]["majorVersion"].as_u64().unwrap_or(8) as u32;
        let java = self.java(required_java, task).await?;
        self.install_libraries(&meta, task).await?;
        let client = &meta["downloads"]["client"];
        self.download(
            text(client, "url")?,
            &self
                .root
                .join("versions")
                .join(&profile.minecraft)
                .join(format!("{}.jar", profile.minecraft)),
            client["sha1"].as_str().map(|s| ("sha1", s)),
            task,
        )
        .await?;
        let vanilla_id = profile.minecraft.clone();
        if profile.loader != Loader::Vanilla {
            let loader_version = profile
                .loader_version
                .as_deref()
                .context("Не задана версия загрузчика")?;
            let extra = match profile.loader {
                Loader::Fabric | Loader::Quilt => {
                    let host = if profile.loader == Loader::Fabric {
                        "https://meta.fabricmc.net/v2"
                    } else {
                        "https://meta.quiltmc.org/v3"
                    };
                    self.json(&format!(
                        "{host}/versions/loader/{}/{loader_version}/profile/json",
                        profile.minecraft
                    ))
                    .await?
                }
                _ => self.install_forge(&profile, &java, task).await?,
            };
            if let Some(parent) = extra["inheritsFrom"].as_str() {
                if parent != profile.minecraft {
                    bail!("Загрузчик требует другую версию Minecraft: {parent}")
                }
            }
            merge(&mut meta, extra);
            self.install_libraries(&meta, task).await?;
        }
        meta["aurenClient"] = json!(vanilla_id);
        self.install_assets(&meta, task).await?;
        if let Some(config) = meta["logging"]["client"]["file"].as_object() {
            let file = Value::Object(config.clone());
            self.download(
                text(&file, "url")?,
                &crate::safe_join(&self.root.join("assets/log_configs"), text(&file, "id")?)?,
                file["sha1"].as_str().map(|s| ("sha1", s)),
                task,
            )
            .await?;
        }
        task.check()?;
        let instance = self.instance(id)?;
        tokio::fs::create_dir_all(&instance).await?;
        tokio::fs::write(
            instance.join("launch.json.tmp"),
            serde_json::to_vec_pretty(&meta)?,
        )
        .await?;
        tokio::fs::rename(
            instance.join("launch.json.tmp"),
            instance.join("launch.json"),
        )
        .await?;
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        next.profiles
            .iter_mut()
            .find(|p| p.id == id)
            .context("Сборка удалена")?
            .installed_version = meta["id"].as_str().map(String::from);
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }
    async fn install_libraries(&self, meta: &Value, task: &Task) -> Result<()> {
        let libs = meta["libraries"].as_array().context("Нет библиотек")?;
        let features = HashMap::new();
        for (i, lib) in libs.iter().enumerate() {
            if !library_allowed(lib, &features) {
                continue;
            }
            task.progress(
                "libraries",
                format!("Библиотеки · {}", lib["name"].as_str().unwrap_or("")),
                i as u64,
                libs.len() as u64,
            );
            if let Some(artifact) = lib["downloads"].get("artifact") {
                self.artifact(artifact, task).await?;
            } else if lib.get("downloads").is_none() {
                let path = maven_path(text(lib, "name")?)?;
                let target = crate::safe_join(&self.root.join("libraries"), &path)?;
                if !target.exists() {
                    self.download(
                        &format!(
                            "{}{}",
                            lib["url"]
                                .as_str()
                                .unwrap_or("https://libraries.minecraft.net/")
                                .trim_end_matches('/')
                                .to_owned()
                                + "/",
                            path
                        ),
                        &target,
                        None,
                        task,
                    )
                    .await?;
                }
            }
            if let Some(classifier) = lib["natives"][os()].as_str() {
                let key = classifier.replace(
                    "${arch}",
                    if cfg!(target_arch = "x86") {
                        "32"
                    } else {
                        "64"
                    },
                );
                let a = &lib["downloads"]["classifiers"][&key];
                if a.is_object() {
                    self.artifact(a, task).await?;
                } else {
                    bail!("Нет native-библиотеки для этой платформы")
                }
            }
        }
        Ok(())
    }
    async fn artifact(&self, a: &Value, task: &Task) -> Result<()> {
        self.download(
            text(a, "url")?,
            &crate::safe_join(&self.root.join("libraries"), text(a, "path")?)?,
            a["sha1"].as_str().map(|s| ("sha1", s)),
            task,
        )
        .await
    }
    async fn install_assets(&self, meta: &Value, task: &Task) -> Result<()> {
        let index = &meta["assetIndex"];
        let index_path = crate::safe_join(
            &self.root.join("assets/indexes"),
            &format!("{}.json", text(index, "id")?),
        )?;
        self.download(
            text(index, "url")?,
            &index_path,
            index["sha1"].as_str().map(|s| ("sha1", s)),
            task,
        )
        .await?;
        let assets: Value = serde_json::from_slice(&tokio::fs::read(index_path).await?)?;
        let objects = assets["objects"].as_object().context("Нет списка assets")?;
        let completed = AtomicU64::new(0);
        let total = objects.len() as u64;
        stream::iter(objects.values().map(Ok::<_, anyhow::Error>))
            .try_for_each_concurrent(12, |a| async {
                let hash = text(a, "hash")?;
                if hash.len() != 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
                    bail!("Неверный hash asset")
                }
                self.download(
                    &format!(
                        "https://resources.download.minecraft.net/{}/{hash}",
                        &hash[..2]
                    ),
                    &self.root.join("assets/objects").join(&hash[..2]).join(hash),
                    Some(("sha1", hash)),
                    task,
                )
                .await?;
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                if done % 20 == 0 || done == total {
                    task.progress("assets", "Ресурсы игры", done, total);
                }
                Ok(())
            })
            .await?;
        if assets["virtual"] == true || assets["map_to_resources"] == true {
            for (name, a) in objects {
                task.check()?;
                let hash = text(a, "hash")?;
                let target = if assets["virtual"] == true {
                    self.root.join("assets/virtual").join(text(index, "id")?)
                } else {
                    self.instance(task.profile_id.as_deref().context("Нет сборки")?)?
                        .join("resources")
                };
                let path = crate::safe_join(&target, name)?;
                tokio::fs::create_dir_all(path.parent().unwrap()).await?;
                tokio::fs::copy(
                    self.root.join("assets/objects").join(&hash[..2]).join(hash),
                    path,
                )
                .await?;
            }
        }
        Ok(())
    }
    pub async fn java(&self, major: u32, task: &Task) -> Result<PathBuf> {
        let configured = self.db.lock().await.settings.java_path.clone();
        if !configured.is_empty() {
            let version = java_version(Path::new(&configured)).await?;
            if version < major {
                bail!("Требуется Java {major}, выбрана Java {version}")
            }
            return Ok(configured.into());
        }
        let runtime = self.root.join("runtimes").join(format!("java-{major}"));
        if runtime.exists() {
            if let Some(path) = find_java(&runtime) {
                if java_version(&path).await? >= major {
                    return Ok(path);
                }
            }
        }
        if !cfg!(windows) {
            bail!("Автоматическая Java сейчас доступна на Windows. Укажите путь к Java {major} в настройках")
        }
        task.progress(
            "java",
            format!("Устанавливаем Eclipse Temurin Java {major}"),
            0,
            0,
        );
        let arch = if cfg!(target_arch = "aarch64") {
            "aarch64"
        } else {
            "x64"
        };
        let list=self.json(&format!("https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture={arch}&image_type=jdk&os=windows&vendor=eclipse")).await?;
        let package = &list
            .as_array()
            .context("Нет ответа Adoptium")?
            .first()
            .context("Java для этой платформы не найдена")?["binary"]["package"];
        let zip = self.root.join("runtimes").join(format!("java-{major}.zip"));
        self.download(
            text(package, "link")?,
            &zip,
            Some(("sha256", text(package, "checksum")?)),
            task,
        )
        .await?;
        extract_zip(&zip, &runtime, None, task)?;
        let path = find_java(&runtime).context("Java не найдена после распаковки")?;
        java_version(&path).await?;
        Ok(path)
    }
    async fn install_forge(&self, p: &Profile, java: &Path, task: &Task) -> Result<Value> {
        let version = p.loader_version.as_deref().context("Нет загрузчика")?;
        let (base, coordinate) = if p.loader == Loader::Forge {
            (
                "https://maven.minecraftforge.net",
                format!(
                    "net/minecraftforge/forge/{}-{version}/forge-{}-{version}",
                    p.minecraft, p.minecraft
                ),
            )
        } else {
            (
                "https://maven.neoforged.net/releases",
                format!("net/neoforged/neoforge/{version}/neoforge-{version}"),
            )
        };
        let jar = self.root.join("installers").join(format!(
            "{}-{}-{version}.jar",
            p.loader.key(),
            p.minecraft
        ));
        let url = format!("{base}/{coordinate}-installer.jar");
        let checksum = self
            .http
            .get(format!("{url}.sha1"))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let checksum = checksum
            .split_whitespace()
            .next()
            .context("Нет SHA1 установщика")?;
        self.download(&url, &jar, Some(("sha1", checksum)), task)
            .await?;
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&jar)?)?;
        let metadata: Value = {
            let mut file = archive.by_name("install_profile.json")?;
            serde_json::from_reader(&mut file)?
        };
        let extra: Value = if let Some(path) = metadata["json"].as_str() {
            serde_json::from_reader(archive.by_name(path.trim_start_matches('/'))?)?
        } else {
            metadata["versionInfo"].clone()
        };
        drop(archive);
        let expected = text(&extra, "id")?.to_string();
        validate_version(&expected)?;
        let launcher = self.root.join("launcher_profiles.json");
        if !launcher.exists() {
            tokio::fs::write(&launcher, b"{\"profiles\":{}} ").await?;
        }
        task.progress(
            "loader",
            format!("Официальный установщик {}", p.loader.key()),
            0,
            0,
        );
        let mut command = Command::new(java);
        command
            .arg("-jar")
            .arg(&jar)
            .arg("--installClient")
            .arg(&self.root)
            .current_dir(&self.root);
        hide(&mut command);
        self.run_installer(command, task).await?;
        let path = self
            .root
            .join("versions")
            .join(&expected)
            .join(format!("{expected}.json"));
        serde_json::from_slice(
            &tokio::fs::read(path)
                .await
                .context("Установщик не создал версию клиента")?,
        )
        .map_err(Into::into)
    }
    async fn run_installer(&self, mut command: Command, task: &Task) -> Result<()> {
        command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn()?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::channel(128);
        for reader in [
            Box::new(stdout) as Box<dyn tokio::io::AsyncRead + Unpin + Send>,
            Box::new(stderr),
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
        loop {
            tokio::select! { line=rx.recv()=>if let Some(line)=line { task.progress("loader",line,0,0); } else { let status=child.wait().await?; if !status.success() { bail!("Установщик завершился с кодом {status}") } return Ok(()) }, _=tokio::time::sleep(std::time::Duration::from_millis(200))=>{ if task.check().is_err() { child.kill().await?; bail!("Установка отменена") } } }
        }
    }
    pub async fn launch(&self, id: &str) -> Result<()> {
        let _guard = self
            .busy
            .try_lock()
            .context("Дождитесь завершения текущей операции")?;
        if self.running.lock().await.contains_key(id) {
            bail!("Игра уже запущена")
        }
        let p = self.profile(id).await?;
        if p.installed_version.is_none() {
            bail!("Сначала установите Minecraft")
        }
        let (account, settings) = {
            let db = self.db.lock().await;
            (
                db.accounts
                    .iter()
                    .find(|a| Some(&a.id) == db.selected_account.as_ref())
                    .cloned()
                    .context("Добавьте и выберите аккаунт")?,
                db.settings.clone(),
            )
        };
        let token = if account.kind == "microsoft" {
            self.minecraft_token(&account.id).await?
        } else {
            "0".into()
        };
        let instance = self.instance(id)?;
        let meta: Value =
            serde_json::from_slice(&tokio::fs::read(instance.join("launch.json")).await?)?;
        let major = meta["javaVersion"]["majorVersion"].as_u64().unwrap_or(8) as u32;
        let task = Task {
            id: uuid::Uuid::new_v4().to_string(),
            profile_id: Some(id.into()),
            cancel: Arc::new(AtomicBool::new(false)),
            emit: self.emit.clone(),
        };
        let java = self.java(major, &task).await?;
        let natives = instance.join("natives");
        tokio::fs::create_dir_all(&natives).await?;
        let features = HashMap::from([("has_custom_resolution".into(), true)]);
        let mut cp = vec![];
        for lib in meta["libraries"].as_array().context("Нет библиотек")? {
            if !library_allowed(lib, &features) {
                continue;
            }
            if let Some(a) = lib["downloads"].get("artifact") {
                cp.push(crate::safe_join(
                    &self.root.join("libraries"),
                    text(a, "path")?,
                )?);
            } else if lib.get("downloads").is_none() {
                cp.push(crate::safe_join(
                    &self.root.join("libraries"),
                    &maven_path(text(lib, "name")?)?,
                )?);
            }
            if let Some(classifier) = lib["natives"][os()].as_str() {
                let key = classifier.replace(
                    "${arch}",
                    if cfg!(target_arch = "x86") {
                        "32"
                    } else {
                        "64"
                    },
                );
                let a = &lib["downloads"]["classifiers"][&key];
                extract_zip(
                    &crate::safe_join(&self.root.join("libraries"), text(a, "path")?)?,
                    &natives,
                    Some("native"),
                    &task,
                )?;
            }
        }
        let client = text(&meta, "aurenClient")?;
        cp.push(
            self.root
                .join("versions")
                .join(client)
                .join(format!("{client}.jar")),
        );
        for path in &cp {
            if !path.exists() {
                bail!(
                    "Отсутствует библиотека {}; переустановите сборку",
                    path.display()
                )
            }
        }
        let classpath = cp
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(if cfg!(windows) { ";" } else { ":" });
        let mut vars = HashMap::<String, String>::from([
            ("auth_player_name".into(), account.name),
            ("auth_uuid".into(), account.uuid),
            ("auth_access_token".into(), token.clone()),
            (
                "auth_session".into(),
                format!("token:{token}:{}", account.id),
            ),
            (
                "user_type".into(),
                if account.kind == "microsoft" {
                    "msa".into()
                } else {
                    "legacy".into()
                },
            ),
            ("user_properties".into(), "{}".into()),
            ("clientid".into(), settings.microsoft_client_id.clone()),
            ("auth_xuid".into(), if account.kind=="microsoft" {self.xuid(&account.id)?}else{String::new()}),
            ("version_name".into(), text(&meta, "id")?.into()),
            (
                "version_type".into(),
                meta["type"].as_str().unwrap_or("release").into(),
            ),
            ("game_directory".into(), instance.to_string_lossy().into()),
            (
                "assets_root".into(),
                self.root.join("assets").to_string_lossy().into(),
            ),
            (
                "game_assets".into(),
                self.root
                    .join("assets/virtual")
                    .join(meta["assets"].as_str().unwrap_or("legacy"))
                    .to_string_lossy()
                    .into(),
            ),
            (
                "assets_index_name".into(),
                text(&meta["assetIndex"], "id")?.into(),
            ),
            ("natives_directory".into(), natives.to_string_lossy().into()),
            ("launcher_name".into(), "Auren".into()),
            ("launcher_version".into(), "0.1.0".into()),
            ("classpath".into(), classpath.clone()),
            (
                "classpath_separator".into(),
                if cfg!(windows) {
                    ";".into()
                } else {
                    ":".into()
                },
            ),
            (
                "library_directory".into(),
                self.root.join("libraries").to_string_lossy().into(),
            ),
            (
                "resolution_width".into(),
                settings.resolution_width.to_string(),
            ),
            (
                "resolution_height".into(),
                settings.resolution_height.to_string(),
            ),
        ]);
        let mut args = vec![
            format!("-Xmx{}M", p.ram_mb.unwrap_or(settings.ram_mb)),
            "-Xms512M".into(),
        ];
        args.extend(shlex::split(&settings.jvm_args).context("Некорректные JVM-аргументы")?);
        args.extend(shlex::split(&p.jvm_args).context("Некорректные JVM-аргументы сборки")?);
        if let Some(jvm) = meta["arguments"]["jvm"].as_array() {
            args.extend(expand_args(jvm, &vars, &features)?);
        } else {
            args.extend([
                format!("-Djava.library.path={}", natives.display()),
                "-cp".into(),
                classpath,
            ]);
        }
        if let Some(logging) = meta["logging"].get("client") {
            vars.insert(
                "path".into(),
                crate::safe_join(
                    &self.root.join("assets/log_configs"),
                    text(&logging["file"], "id")?,
                )?
                .to_string_lossy()
                .into(),
            );
            args.push(substitute(text(logging, "argument")?, &vars)?);
        }
        args.push(text(&meta, "mainClass")?.into());
        if let Some(game) = meta["arguments"]["game"].as_array() {
            args.extend(expand_args(game, &vars, &features)?);
        } else {
            args.extend(
                shlex::split(text(&meta, "minecraftArguments")?)
                    .context("Неверные аргументы игры")?
                    .into_iter()
                    .map(|v| substitute(&v, &vars))
                    .collect::<Result<Vec<_>>>()?,
            );
        }
        let mut command = Command::new(java);
        command
            .args(&args)
            .current_dir(&instance)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        hide(&mut command);
        // No shell interpolation, no printed token-bearing command line.
        let mut child = command.spawn().context("Не удалось запустить Java")?;
        let stop = Arc::new(AtomicBool::new(false));
        self.running.lock().await.insert(id.into(), stop.clone());
        let engine = self.clone();
        let id = id.to_string();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::channel(256);
        for reader in [
            Box::new(stdout) as Box<dyn tokio::io::AsyncRead + Unpin + Send>,
            Box::new(stderr),
        ] {
            let tx = tx.clone();
            let token = token.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(reader).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = redact(&line, &token);
                    if tx.send(line).await.is_err() {
                        break;
                    }
                }
            });
        }
        drop(tx);
        task.progress("running", "Minecraft запущен", 0, 0);
        tokio::spawn(async move {
            let mut log = tokio::fs::File::create(instance.join("auren-latest.log"))
                .await
                .ok();
            let status = loop {
                tokio::select! {
                    status=child.wait()=>break status,
                    line=rx.recv(), if !rx.is_closed() => if let Some(line)=line { if let Some(f)=log.as_mut() { let _=f.write_all(format!("{line}\n").as_bytes()).await; } task.progress("log",line,0,0); },
                    _=tokio::time::sleep(std::time::Duration::from_millis(200))=>if stop.load(Ordering::Relaxed) { let _=child.kill().await; break child.wait().await; }
                }
            };
            engine.running.lock().await.remove(&id);
            task.progress(
                "exited",
                match status {
                    Ok(s) => format!("Minecraft завершён: {s}"),
                    Err(e) => format!("Ошибка процесса: {e}"),
                },
                0,
                0,
            );
        });
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        next.profiles
            .iter_mut()
            .find(|v| v.id == p.id)
            .unwrap()
            .last_played = Some(crate::now());
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }
    pub async fn stop(&self, id: &str) -> Result<()> {
        self.running
            .lock()
            .await
            .get(id)
            .context("Игра не запущена")?
            .store(true, Ordering::Relaxed);
        Ok(())
    }
}
pub async fn java_version(path: &Path) -> Result<u32> {
    let mut command = Command::new(path);
    command.arg("-version");
    hide(&mut command);
    let out = command.output().await.context("Java не найдена")?;
    let output = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stderr),
        String::from_utf8_lossy(&out.stdout)
    );
    let re = regex::Regex::new(r#"version "(?:1\.)?(\d+)"#)?;
    let capture = re
        .captures(&output)
        .context("Не удалось определить версию Java")?;
    Ok(capture[1].parse()?)
}
fn find_java(root: &Path) -> Option<PathBuf> {
    walkdir::WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .find(|e| e.file_name() == if cfg!(windows) { "java.exe" } else { "java" })
        .map(|e| e.into_path())
}
pub fn hide(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(0x08000000);
}
pub fn extract_zip(zip: &Path, target: &Path, mode: Option<&str>, task: &Task) -> Result<()> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(zip)?)?;
    let mut total = 0u64;
    for i in 0..archive.len() {
        task.check()?;
        let mut f = archive.by_index(i)?;
        let name = f.name().to_owned();
        if mode == Some("native")
            && (name.starts_with("META-INF/")
                || ![".dll", ".so", ".dylib", ".jnilib"]
                    .iter()
                    .any(|ext| name.ends_with(ext)))
        {
            continue;
        }
        if f.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            bail!("Символические ссылки в архиве запрещены")
        }
        total += f.size();
        if total > 2_000_000_000 {
            bail!("Архив слишком велик")
        }
        let path = crate::safe_join(target, name.trim_end_matches('/'))?;
        if f.is_dir() {
            std::fs::create_dir_all(path)?;
        } else {
            std::fs::create_dir_all(path.parent().unwrap())?;
            std::io::copy(&mut f, &mut std::fs::File::create(path)?)?;
        }
    }
    Ok(())
}
pub fn substitute(s: &str, vars: &HashMap<String, String>) -> Result<String> {
    let re = regex::Regex::new(r"\$\{([^}]+)\}")?;
    for cap in re.captures_iter(s) {
        if !vars.contains_key(&cap[1]) {
            bail!("Неизвестный параметр запуска: {}", &cap[1])
        }
    }
    Ok(re
        .replace_all(s, |c: &regex::Captures| vars[&c[1]].clone())
        .into())
}
pub fn expand_args(
    args: &[Value],
    vars: &HashMap<String, String>,
    features: &HashMap<String, bool>,
) -> Result<Vec<String>> {
    let mut result = vec![];
    for arg in args {
        if let Some(s) = arg.as_str() {
            result.push(substitute(s, vars)?);
        } else if allowed(arg, features) {
            if let Some(s) = arg["value"].as_str() {
                result.push(substitute(s, vars)?);
            } else if let Some(values) = arg["value"].as_array() {
                for v in values {
                    result.push(substitute(v.as_str().context("Неверный аргумент")?, vars)?);
                }
            }
        }
    }
    Ok(result)
}
pub fn redact(line: &str, token: &str) -> String {
    let value = if token != "0" && !token.is_empty() {
        line.replace(token, "[REDACTED]")
    } else {
        line.into()
    };
    regex::Regex::new(r"(?i)(access[_-]?token|refresh[_-]?token|authorization)([=: ]+)(\S+)")
        .unwrap()
        .replace_all(&value, "$1$2[REDACTED]")
        .into_owned()
}
