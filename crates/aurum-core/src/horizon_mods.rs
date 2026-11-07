//! Reviewed native source mods, explicit compilation, and exact-input launch selection.
use crate::{
    horizon::MINECRAFT,
    minecraft::{extract_zip, hide},
    model::*,
    store::{persist, validate_version},
    Engine, Task,
};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

const INDEX: &str = "https://horizon-rust.github.io/horizon-mods/index.json";
const BUILDER_TAG: &str = "launcher@0.2.43";
const BUILDER_ASSET: &str = "horizon-launcher-windows-x64.zip";
const MAX_BUNDLE: u64 = 64 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStatus {
    pub mods: Vec<Content>,
    pub enabled: usize,
    pub needs_build: bool,
    pub has_build: bool,
    pub built_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct BuildRecord {
    fingerprint: String,
    version: String,
    client_sha256: String,
    built_at: u64,
}

fn native_project(value: &Value) -> Result<Project> {
    let id = value["id"].as_str().context("Horizon: проект без id")?;
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        bail!("Horizon: неверный id мода")
    }
    Ok(Project {
        id: id.into(),
        source: "horizon".into(),
        title: value["name"].as_str().unwrap_or(id).into(),
        description: value["summary"].as_str().unwrap_or("").into(),
        author: value["authors"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default(),
        icon: value["icon"]
            .as_str()
            .filter(|u| u.starts_with("https://"))
            .map(String::from),
        downloads: value["downloads"].as_u64().unwrap_or(0),
        kind: "mod".into(),
    })
}

fn revoked(index: &Value, id: &str, hash: &str) -> bool {
    index["revoked"].as_array().is_some_and(|list| {
        list.iter()
            .any(|r| r["id"] == id && r["sha256"].as_str().is_none_or(|h| h == hash))
    })
}

fn versions<'a>(index: &Value, project: &'a Value, mc: Option<&str>) -> Vec<&'a Value> {
    project["versions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|v| {
            v["game"] == mc.unwrap_or(MINECRAFT)
                && !revoked(
                    index,
                    project["id"].as_str().unwrap_or(""),
                    v["file"]["sha256"].as_str().unwrap_or(""),
                )
        })
        .collect()
}

fn registry_project<'a>(index: &'a Value, id: &str) -> Result<&'a Value> {
    index["projects"]
        .as_array()
        .context("Horizon: нет проектов")?
        .iter()
        .find(|p| p["id"] == id && p["kind"] == "native-mod")
        .context("Нативный мод Horizon не найден")
}

fn release_url(url: &str) -> Result<()> {
    let parsed = reqwest::Url::parse(url)?;
    let segments: Vec<_> = parsed
        .path_segments()
        .context("Неверный адрес мода")?
        .collect();
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || segments.len() != 6
        || segments[2..4] != ["releases", "download"]
    {
        bail!("Horizon: файл должен быть опубликован в GitHub Releases")
    }
    Ok(())
}

async fn digest(path: &Path) -> Result<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hash = Sha256::new();
    let mut block = vec![0; 65536];
    loop {
        let n = file.read(&mut block).await?;
        if n == 0 {
            break;
        }
        hash.update(&block[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn sources(instance: &Path) -> PathBuf {
    instance.join(".aurum/horizon-mods")
}
fn record_path(instance: &Path) -> PathBuf {
    instance.join(".aurum/native-build.json")
}

impl Engine {
    async fn horizon_index(&self) -> Result<Value> {
        if let Some((when, value)) = self.catalog_cache.lock().await.get("horizon-native-index") {
            if when.elapsed() < Duration::from_secs(300) {
                return Ok(value.clone());
            }
        }
        let mut response = self.http.get(INDEX).send().await?.error_for_status()?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                bail!("Horizon: реестр слишком велик")
            }
            bytes.extend_from_slice(&chunk);
        }
        let index: Value = serde_json::from_slice(&bytes)?;
        if index["schema"] != 1 || !index["projects"].is_array() {
            bail!("Horizon: формат реестра изменился. Обновите Aurum")
        }
        self.catalog_cache.lock().await.insert(
            "horizon-native-index".into(),
            (Instant::now(), index.clone()),
        );
        Ok(index)
    }

    pub async fn search_horizon_mods(&self, query: Search) -> Result<SearchResult> {
        let index = self.horizon_index().await?;
        let mut projects: Vec<&Value> = index["projects"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| {
                let text = format!(
                    "{} {} {} {}",
                    p["name"], p["summary"], p["authors"], p["tags"]
                )
                .to_lowercase();
                p["kind"] == "native-mod"
                    && query.kind == "mod"
                    && text.contains(&query.query.to_lowercase())
                    && !versions(&index, p, query.minecraft.as_deref()).is_empty()
                    && query
                        .category
                        .as_ref()
                        .filter(|s| !s.is_empty())
                        .is_none_or(|c| {
                            p["categories"]
                                .as_array()
                                .is_some_and(|a| a.iter().any(|v| v == c))
                        })
            })
            .collect();
        projects.sort_by(|a, b| match query.sort.as_str() {
            "newest" | "updated" => b["versions"][0]["published"]
                .as_str()
                .cmp(&a["versions"][0]["published"].as_str()),
            _ => b["downloads"]
                .as_u64()
                .unwrap_or(0)
                .cmp(&a["downloads"].as_u64().unwrap_or(0)),
        });
        let total = projects.len() as u64;
        Ok(SearchResult {
            total,
            projects: projects
                .into_iter()
                .skip(query.offset as usize)
                .take(24)
                .map(native_project)
                .collect::<Result<_>>()?,
        })
    }

    pub async fn horizon_mod_detail(&self, id: &str, mc: Option<&str>) -> Result<ProjectDetail> {
        let index = self.horizon_index().await?;
        let raw = registry_project(&index, id)?;
        Ok(ProjectDetail {
            project: native_project(raw)?,
            body: raw["description"].as_str().unwrap_or("").into(),
            gallery: raw["screenshots"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|u| u.starts_with("https://"))
                .map(String::from)
                .collect(),
            versions: versions(&index, raw, mc)
                .into_iter()
                .filter_map(|v| {
                    Some(ProjectVersion {
                        id: v["version"].as_str()?.into(),
                        name: v["version"].as_str()?.into(),
                        game_versions: vec![v["game"].as_str()?.into()],
                        loaders: vec!["horizon".into()],
                    })
                })
                .collect(),
            url: format!("https://playhorizon.dev/mods/{id}"),
        })
    }

    pub(crate) async fn install_horizon_mod(
        &self,
        id: &str,
        project_id: &str,
        version: &str,
        task: &Task,
    ) -> Result<()> {
        let profile = self.profile(id).await?;
        if profile.engine != Runtime::Horizon {
            bail!("Этот мод работает только в профиле Horizon")
        }
        if self.running.lock().await.contains_key(id) {
            bail!("Сначала остановите игру")
        }
        let index = self.horizon_index().await?;
        let raw = registry_project(&index, project_id)?;
        let item = versions(&index, raw, Some(&profile.minecraft))
            .into_iter()
            .find(|v| v["version"] == version)
            .context("Нет совместимой версии мода Horizon")?;
        let file = &item["file"];
        let name = file["name"].as_str().context("Нет имени файла мода")?;
        if !name.ends_with(".hnmod") || name.contains(['/', '\\']) {
            bail!("Неверное имя нативного мода")
        }
        let size = file["size"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= MAX_BUNDLE)
            .context("Неподдерживаемый размер мода")?;
        let hash = file["sha256"]
            .as_str()
            .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
            .context("Нет SHA-256 мода")?;
        let url = file["url"].as_str().context("Нет URL мода")?;
        release_url(url)?;
        let cached = self
            .root
            .join("horizon/mod-downloads")
            .join(format!("{hash}.hnmod"));
        task.progress("horizon-mod", "Скачиваем исходники мода Horizon", 0, 0);
        let _download = crate::temporary::Temporary::file(&cached);
        self.download(url, &cached, Some(("sha256", hash)), task)
            .await?;
        if tokio::fs::metadata(&cached).await?.len() != size {
            bail!("Размер пакета мода не совпадает с реестром")
        }
        if let Some(key) = raw["key"].as_str() {
            let key = if key.contains('\n') {
                minisign_verify::PublicKey::decode(key)
            } else {
                minisign_verify::PublicKey::from_base64(key)
            }
            .context("Неверный ключ автора мода")?;
            let signature = minisign_verify::Signature::decode(
                file["signature"]
                    .as_str()
                    .context("Нет подписи автора мода")?,
            )
            .context("Неверная подпись мода")?;
            key.verify(&tokio::fs::read(&cached).await?, &signature, true)
                .context("Подпись мода не прошла проверку")?;
        }
        validate_bundle(
            &cached,
            project_id,
            version,
            &profile.minecraft,
            item["api"].as_str().unwrap_or(""),
        )?;
        task.check()?;
        let instance = self.instance(id)?;
        let folder = sources(&instance);
        tokio::fs::create_dir_all(&folder).await?;
        let target = crate::safe_join(&folder, name)?;
        let temporary = target.with_extension(format!("{}.tmp", task.id));
        let _temporary = crate::temporary::Temporary::file(&temporary);
        tokio::fs::copy(&cached, &temporary).await?;
        tokio::fs::rename(&temporary, &target).await?;
        let old_file = profile.content.iter().find(|c| c.source == "horizon" && c.project_id == project_id)
            .filter(|c| c.filename != name).map(|c| folder.join(&c.filename));
        let project = native_project(raw)?;
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        let p = next
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .context("Сборка удалена")?;
        p.content
            .retain(|c| !(c.source == "horizon" && c.project_id == project_id));
        p.content.push(Content {
            id: format!("horizon:{project_id}"),
            source: "horizon".into(),
            project_id: project_id.into(),
            version_id: version.into(),
            name: project.title,
            filename: name.into(),
            kind: "mod".into(),
            enabled: true,
            info: ContentInfo {
                version_name: version.into(),
                icon: project.icon,
                author: project.author,
                project_url: Some(format!("https://playhorizon.dev/mods/{project_id}")),
                modified_at: crate::now(),
                sha256: hash.into(),
                native_api: item["api"].as_str().unwrap_or("").into(),
                ..Default::default()
            },
        });
        persist(&self.root, &next).await?;
        *db = next;
        if let Some(old) = old_file { let _ = tokio::fs::remove_file(old).await; }
        Ok(())
    }

    pub(crate) async fn manage_horizon_mod(
        &self,
        id: &str,
        content_id: &str,
        action: &str,
    ) -> Result<()> {
        self.ensure_idle(id).await?;
        let profile = self.profile(id).await?;
        let item = profile
            .content
            .iter()
            .find(|c| c.id == content_id && c.source == "horizon")
            .context("Мод Horizon не найден")?;
        if action == "remove" {
            let file = crate::safe_join(&sources(&self.instance(id)?), &item.filename)?;
            if file.exists() {
                self.trash_content(id, item, &file).await?;
            }
        } else if action != "toggle" {
            bail!("Неизвестное действие с модом")
        }
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        let p = next
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .context("Сборка удалена")?;
        if action == "remove" {
            p.content.retain(|c| c.id != content_id);
        } else if let Some(c) = p.content.iter_mut().find(|c| c.id == content_id) {
            c.enabled = !c.enabled;
        }
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }

    async fn native_fingerprint(&self, profile: &Profile) -> Result<String> {
        let mut hash = Sha256::new();
        hash.update(
            profile
                .installed_version
                .as_deref()
                .unwrap_or("uninstalled"),
        );
        let mut enabled: Vec<_> = profile
            .content
            .iter()
            .filter(|c| c.source == "horizon" && c.enabled)
            .collect();
        enabled.sort_by(|a, b| a.project_id.cmp(&b.project_id));
        for c in enabled {
            let path = crate::safe_join(&sources(&self.instance(&profile.id)?), &c.filename)?;
            let actual = digest(&path)
                .await
                .with_context(|| format!("Не найден пакет {}. Установите мод заново", c.name))?;
            if actual != c.info.sha256 {
                bail!("Пакет {} изменён. Установите мод заново", c.name)
            }
            hash.update(format!("\n{}\0{}\0{}", c.project_id, c.version_id, actual));
        }
        Ok(format!("{:x}", hash.finalize()))
    }

    async fn native_record(&self, id: &str) -> Option<BuildRecord> {
        serde_json::from_slice(
            &tokio::fs::read(record_path(&self.instance(id).ok()?))
                .await
                .ok()?,
        )
        .ok()
    }

    fn compiler_root(&self) -> PathBuf {
        self.root.join("horizon/compiler")
    }

    pub async fn horizon_mod_status(&self, id: &str) -> Result<NativeStatus> {
        let p = self.profile(id).await?;
        if p.engine != Runtime::Horizon {
            bail!("Сборка не использует Horizon")
        }
        let record = self.native_record(id).await;
        let fingerprint = self.native_fingerprint(&p).await;
        let directory = record.as_ref().and_then(|r| {
            crate::safe_join(&self.compiler_root().join("versions"), &r.version).ok()
        });
        let has_build = if let (Some(directory), Some(record)) = (&directory, &record) {
            digest(&directory.join("horizon-client.exe"))
                .await
                .is_ok_and(|hash| hash == record.client_sha256)
        } else {
            false
        };
        let enabled = p
            .content
            .iter()
            .filter(|c| c.source == "horizon" && c.enabled)
            .count();
        Ok(NativeStatus {
            enabled,
            needs_build: enabled > 0
                && (!has_build
                    || !matches!((&record,&fingerprint),(Some(r),Ok(f)) if r.fingerprint==*f)),
            has_build,
            built_at: record.as_ref().map(|r| r.built_at),
            error: fingerprint.err().map(|e| e.to_string()),
            mods: p
                .content
                .into_iter()
                .filter(|c| c.source == "horizon")
                .collect(),
        })
    }

    pub(crate) async fn native_launch_directory(
        &self,
        profile: &Profile,
        skip: bool,
    ) -> Result<Option<PathBuf>> {
        if skip
            || !profile
                .content
                .iter()
                .any(|c| c.source == "horizon" && c.enabled)
        {
            return Ok(None);
        }
        let fingerprint = self.native_fingerprint(profile).await?;
        let record = self
            .native_record(&profile.id)
            .await
            .context("Моды Horizon ещё не скомпилированы")?;
        if record.fingerprint != fingerprint {
            bail!("Моды Horizon изменились. Скомпилируйте их или выберите запуск без пользовательских модов")
        }
        let directory = crate::safe_join(&self.compiler_root().join("versions"), &record.version)?;
        if digest(&directory.join("horizon-client.exe")).await? != record.client_sha256 {
            bail!("Скомпилированный Horizon изменён. Повторите компиляцию")
        }
        Ok(Some(directory))
    }

    async fn native_builder(&self, task: &Task) -> Result<PathBuf> {
        if !cfg!(all(windows, target_arch = "x86_64")) {
            bail!("Компиляция модов Horizon пока доступна на Windows x64")
        }
        let directory = self
            .root
            .join("horizon/tools")
            .join(BUILDER_TAG.replace('@', "-"));
        let program = directory.join("horizon-launcher.exe");
        if program.is_file() && directory.join("verified").is_file() {
            return Ok(program);
        }
        task.progress(
            "horizon-build",
            "Скачиваем официальный сборщик Horizon",
            0,
            0,
        );
        let base = "https://github.com/horizon-rust/horizon/releases/download/launcher%400.2.43";
        let sums = self
            .http
            .get(format!("{base}/SHA256SUMS"))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let signatures = self
            .http
            .get(format!("{base}/SHA256SUMS.sig"))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let message = format!("horizon release {BUILDER_TAG}\n{sums}");
        let key = STANDARD.decode(crate::horizon::PUBLIC_KEY)?;
        if !signatures
            .lines()
            .filter_map(|s| STANDARD.decode(s.trim()).ok())
            .any(|s| {
                UnparsedPublicKey::new(&ED25519, &key)
                    .verify(message.as_bytes(), &s)
                    .is_ok()
            })
        {
            bail!("Подпись сборщика Horizon не прошла проверку")
        }
        let hash = sums
            .lines()
            .find_map(|l| {
                l.split_once("  ")
                    .filter(|(_, n)| *n == BUILDER_ASSET)
                    .map(|(h, _)| h)
            })
            .context("Нет контрольной суммы сборщика")?;
        let archive = self
            .root
            .join("horizon/downloads")
            .join("native-builder-0.2.43.zip");
        let _archive = crate::temporary::Temporary::file(&archive);
        self.download(
            &format!("{base}/{BUILDER_ASSET}"),
            &archive,
            Some(("sha256", hash)),
            task,
        )
        .await?;
        extract_zip(&archive, &directory, None, task)?;
        if !program.is_file() {
            bail!("Не найден официальный сборщик Horizon")
        }
        tokio::fs::write(directory.join("verified"), hash).await?;
        Ok(program)
    }

    pub async fn build_horizon_mods(&self, id: &str, trust: bool, task: &Task) -> Result<()> {
        if !trust {
            bail!("Подтвердите компиляцию: нативные моды выполняются с правами пользователя")
        }
        self.ensure_horizon_build_idle(id).await?;
        let profile = self.profile(id).await?;
        self.horizon_owner().await?;
        let base = profile
            .installed_version
            .as_deref()
            .context("Сначала установите Horizon")?;
        let fingerprint = self.native_fingerprint(&profile).await?;
        let enabled: Vec<_> = profile
            .content
            .iter()
            .filter(|c| c.source == "horizon" && c.enabled)
            .collect();
        if enabled.is_empty() {
            return Ok(());
        }
        let index = self.horizon_index().await?;
        for c in &enabled {
            if revoked(&index, &c.project_id, &c.info.sha256) {
                bail!(
                    "Мод {} отозван из реестра. Удалите или отключите его",
                    c.name
                )
            }
            let archive = crate::safe_join(&sources(&self.instance(id)?), &c.filename)?;
            let manifest = validate_bundle(
                &archive,
                &c.project_id,
                &c.version_id,
                &profile.minecraft,
                &c.info.native_api,
            )?;
            if manifest["hooks"].as_u64().is_none() {
                let revision = manifest["horizon"]
                    .as_str()
                    .context("Мод не указал версию Horizon")?;
                if revision.len() != 40 || !revision.bytes().all(|b| b.is_ascii_hexdigit()) {
                    bail!("Мод указал неверную версию Horizon")
                }
                let key = format!("horizon-launch-source:{revision}");
                let cached = self
                    .catalog_cache
                    .lock()
                    .await
                    .get(&key)
                    .map(|(_, value)| value.clone());
                let supported = if let Some(value) = cached {
                    value == true
                } else {
                    task.progress(
                        "horizon-build",
                        "Проверяем совместимость версии Horizon, выбранной автором мода",
                        0,
                        0,
                    );
                    let response = self.http.get(format!("https://raw.githubusercontent.com/horizon-rust/horizon/{revision}/crates/horizon-client/src/game/launch_api.rs")).send().await?;
                    let supported = if response.status() == reqwest::StatusCode::NOT_FOUND {
                        false
                    } else {
                        let source = response.error_for_status()?.text().await?;
                        source.contains("--session-stdin") && source.contains("--game-dir")
                    };
                    self.catalog_cache
                        .lock()
                        .await
                        .insert(key, (Instant::now(), Value::Bool(supported)));
                    supported
                };
                if !supported {
                    bail!("{}: эта версия мода закреплена за Horizon, который ещё не поддерживает запуск из Aurum. Выберите более новую версию мода", c.name)
                }
            }
        }
        let builder = self.native_builder(task).await?;
        let root = self.compiler_root();
        // Aurum's build id adds an archive digest; upstream's revision resolver expects the commit last.
        let upstream_base = base
            .rsplit_once('-')
            .context("Неизвестная сборка Horizon")?
            .0;
        validate_version(upstream_base)?;
        let target_base = root.join("versions").join(upstream_base);
        let source_base = self.root.join("horizon/builds").join(base);
        let resources = self.root.join("horizon/resources").join(base);
        if !resources.join("horizon-resources.json").is_file() {
            bail!("Сначала завершите подготовку ресурсов Horizon")
        }
        task.progress(
            "horizon-build",
            "Готовим исходники и общие ресурсы. Первый запуск может занять 20–30 минут или дольше",
            0,
            0,
        );
        clone_tree(&source_base, &target_base, task)?;
        clone_tree(
            &resources,
            &target_base.join(".local/horizon-client").join(MINECRAFT),
            task,
        )?;
        tokio::fs::write(target_base.join(".installed"), b"").await?;
        let home = root.join("home");
        tokio::fs::create_dir_all(home.join("instances").join(id)).await?;
        let input = root.join("inputs").join(&task.id);
        tokio::fs::create_dir_all(&input).await?;
        let _input = crate::temporary::Temporary::directory(&input);
        for c in &enabled {
            task.check()?;
            let archive = crate::safe_join(&sources(&self.instance(id)?), &c.filename)?;
            extract_zip(&archive, &input.join(&c.project_id), None, task)?;
        }
        let mut command = Command::new(&builder);
        command
            .env("HORIZON_LAUNCHER_HOME", &root)
            .env("HORIZON_HOME", &home)
            .arg("native-build")
            .arg(&input)
            .arg("--instance")
            .arg(id)
            .arg("--version")
            .arg(upstream_base)
            .arg("--profile")
            .arg("performance")
            .arg("--trust-native-code")
            .current_dir(&root);
        let log = self.instance(id)?.join("horizon-build.log");
        let result = run_build(command, task, &log).await;
        let _ = tokio::fs::remove_dir_all(&input).await;
        result?;
        // Ask the CLI for the version it selected; do not infer success from log text.
        let mut query = Command::new(&builder);
        query
            .env("HORIZON_LAUNCHER_HOME", &root)
            .env("HORIZON_HOME", &home)
            .args(["instance", "list", "--json"])
            .kill_on_drop(true);
        hide(&mut query);
        let out = tokio::time::timeout(Duration::from_secs(20), query.output()).await??;
        if !out.status.success() {
            bail!("Не удалось прочитать результат компиляции Horizon")
        }
        let list: Value = serde_json::from_slice(&out.stdout)?;
        let found = list
            .as_array()
            .or_else(|| list["instances"].as_array())
            .context("Неизвестный ответ сборщика Horizon")?;
        let version = found
            .iter()
            .find(|v| v["id"] == id)
            .and_then(|v| v["version"].as_str())
            .filter(|v| v.starts_with("native-"))
            .context("Сборщик не выбрал скомпилированную версию")?;
        validate_version(version)?;
        let directory = root.join("versions").join(version);
        let client = directory.join("horizon-client.exe");
        let mut probe = Command::new(&client);
        probe
            .arg("--launch-api")
            .current_dir(&directory)
            .kill_on_drop(true);
        hide(&mut probe);
        let out = tokio::time::timeout(Duration::from_secs(20), probe.output()).await??;
        let api: Value = serde_json::from_slice(&out.stdout)
            .context("Скомпилированная игра не поддерживает запуск из Aurum")?;
        if !out.status.success()
            || !api["launch_api"]
                .as_str()
                .is_some_and(|v| v.starts_with("0.1."))
            || api["minecraft"] != MINECRAFT
        {
            bail!("Скомпилированная версия несовместима с Aurum")
        }
        task.check()?;
        let record = BuildRecord {
            fingerprint,
            version: version.into(),
            client_sha256: digest(&client).await?,
            built_at: crate::now(),
        };
        let target = record_path(&self.instance(id)?);
        let temp = target.with_extension("tmp");
        tokio::fs::create_dir_all(target.parent().unwrap()).await?;
        tokio::fs::write(&temp, serde_json::to_vec(&record)?).await?;
        tokio::fs::rename(temp, target).await?;
        Ok(())
    }

    async fn ensure_horizon_build_idle(&self, id: &str) -> Result<()> {
        if self.profile(id).await?.engine != Runtime::Horizon {
            bail!("Сборка не использует Horizon")
        }
        self.refresh_recovered().await;
        if self.running.lock().await.contains_key(id) {
            bail!("Сначала остановите игру")
        }
        Ok(())
    }

    pub async fn horizon_build_log(&self, id: &str) -> Result<String> {
        self.profile(id).await?;
        let path = self.instance(id)?.join("horizon-build.log");
        let Ok(mut file) = tokio::fs::File::open(path).await else {
            return Ok(String::new());
        };
        use tokio::io::AsyncSeekExt;
        let length = file.metadata().await?.len();
        file.seek(std::io::SeekFrom::Start(length.saturating_sub(256 * 1024)))
            .await?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).await?;
        Ok(String::from_utf8_lossy(&bytes).into())
    }
}

fn validate_bundle(path: &Path, id: &str, version: &str, game: &str, api: &str) -> Result<Value> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?)?;
    let entry = zip
        .by_name("horizon-native.json")
        .context("В пакете нет horizon-native.json")?;
    if entry.size() > 65536 {
        bail!("Слишком большой манифест мода")
    }
    let manifest: Value = serde_json::from_reader(entry)?;
    let pins = format!(
        "native-1/{}/{}",
        manifest["horizon"].as_str().unwrap_or(""),
        manifest["mixins"].as_str().unwrap_or("")
    );
    if manifest["schema"] != 1
        || manifest["id"] != id
        || manifest["version"] != version
        || manifest["game"] != game
        || pins != api
    {
        bail!("Содержимое мода не совпадает с реестром Horizon")
    }
    Ok(manifest)
}

fn clone_tree(from: &Path, to: &Path, task: &Task) -> Result<()> {
    for entry in walkdir::WalkDir::new(from) {
        task.check()?;
        let entry = entry?;
        if entry.file_type().is_symlink() {
            bail!("Ссылки в исходниках сборки запрещены")
        }
        let target = to.join(entry.path().strip_prefix(from)?);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target)?;
        } else {
            if target.exists() {
                std::fs::remove_file(&target)?;
            }
            if std::fs::hard_link(entry.path(), &target).is_err() {
                std::fs::copy(entry.path(), &target)?;
            }
        }
    }
    Ok(())
}

async fn run_build(mut command: Command, task: &Task, log: &Path) -> Result<()> {
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    hide(&mut command);
    let mut child = command
        .spawn()
        .context("Не удалось запустить сборщик Horizon")?;
    #[cfg(windows)]
    let _job = BuildJob::attach(&child)?;
    let (tx, mut rx) = tokio::sync::mpsc::channel(256);
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
    let mut file = tokio::fs::File::create(log).await?;
    let mut tail = std::collections::VecDeque::new();
    let mut open = true;
    let mut written = 0;
    let status = loop {
        tokio::select! {
            status=child.wait()=>break status?,
            line=rx.recv(),if open=>if let Some(line)=line {
                if tail.len()==12 {tail.pop_front();} tail.push_back(line.clone());
                if written<16*1024*1024 { let bytes=format!("{line}\n"); file.write_all(bytes.as_bytes()).await?; written+=bytes.len(); }
                task.progress("horizon-build",line.chars().take(800).collect::<String>(),0,0);
            } else {open=false;},
            _=tokio::time::sleep(Duration::from_millis(200))=>{task.check()?;}
        }
    };
    while let Ok(Some(line)) = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        if tail.len() == 12 {
            tail.pop_front();
        }
        tail.push_back(line.clone());
        if written < 16 * 1024 * 1024 {
            let bytes = format!("{line}\n");
            file.write_all(bytes.as_bytes()).await?;
            written += bytes.len();
        }
    }
    if !status.success() {
        bail!(
            "Компиляция Horizon не завершена. Предыдущая рабочая сборка сохранена.\n{}",
            tail.into_iter().collect::<Vec<_>>().join("\n")
        )
    }
    Ok(())
}

#[cfg(windows)]
struct BuildJob(std::os::windows::io::OwnedHandle);
#[cfg(windows)]
impl BuildJob {
    fn attach(child: &tokio::process::Child) -> Result<Self> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle};
        use windows_sys::Win32::{Foundation::HANDLE, System::JobObjects::*};
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let job = Self(unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(handle) });
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                job.0.as_raw_handle() as HANDLE,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        if unsafe {
            AssignProcessToJobObject(
                job.0.as_raw_handle() as HANDLE,
                child.raw_handle().context("Нет процесса компиляции")? as HANDLE,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(job)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicBool, Arc};
    fn task() -> Task {
        Task {
            id: uuid::Uuid::new_v4().to_string(),
            profile_id: None,
            cancel: Arc::new(AtomicBool::new(false)),
            emit: Arc::new(|_| {}),
        }
    }
    #[test]
    fn registry_rejects_revoked_files_and_unsupported_download_locations() {
        let index =
            serde_json::json!({"revoked":[{"id":"unsafe","sha256":"bad"},{"id":"removed"}]});
        assert!(revoked(&index, "unsafe", "bad"));
        assert!(!revoked(&index, "unsafe", "good"));
        assert!(revoked(&index, "removed", "any"));
        assert!(release_url(
            "https://github.com/horizon-rust/horizon-mods/releases/download/mod-1/mod.hnmod"
        )
        .is_ok());
        for url in [
            "http://github.com/a/b/releases/download/v/m.hnmod",
            "https://github.com.evil.test/a/b/releases/download/v/m.hnmod",
            "https://github.com/a/b/raw/main/a.hnmod",
            "https://user@github.com/a/b/releases/download/v/m.hnmod",
        ] {
            assert!(release_url(url).is_err());
        }
    }
    #[test]
    fn native_archive_identity_and_pins_must_match_the_registry() {
        use std::io::Write;
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("a.hnmod");
        let mut archive = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        archive
            .start_file(
                "horizon-native.json",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        archive.write_all(br#"{"schema":1,"id":"sample","version":"1.0","game":"26.3","horizon":"aaa","mixins":"bbb"}"#).unwrap();
        archive.finish().unwrap();
        assert!(validate_bundle(&path, "sample", "1.0", "26.3", "native-1/aaa/bbb").is_ok());
        assert!(validate_bundle(&path, "other", "1.0", "26.3", "native-1/aaa/bbb").is_err());
        assert!(validate_bundle(&path, "sample", "1.0", "26.3", "native-1/ccc/bbb").is_err());
    }
    #[tokio::test]
    async fn selected_inputs_and_binary_integrity_gate_launch_while_skip_always_uses_base() {
        let root = tempfile::tempdir().unwrap();
        let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
        let p = engine
            .create_profile_with_engine(
                "Native".into(),
                MINECRAFT.into(),
                Loader::Vanilla,
                None,
                0,
                Runtime::Horizon,
            )
            .await
            .unwrap();
        let instance = engine.instance(&p.id).unwrap();
        std::fs::create_dir_all(sources(&instance)).unwrap();
        let package = sources(&instance).join("one.hnmod");
        std::fs::write(&package, b"original-source").unwrap();
        {
            let mut db = engine.db.lock().await;
            let p = db
                .profiles
                .iter_mut()
                .find(|stored| stored.id == p.id)
                .unwrap();
            p.installed_version = Some("nightly-2026-11-05-abcdef1-digest".into());
            p.content.push(Content {
                id: "horizon:one".into(),
                source: "horizon".into(),
                project_id: "one".into(),
                version_id: "1".into(),
                name: "One".into(),
                filename: "one.hnmod".into(),
                kind: "mod".into(),
                enabled: true,
                info: ContentInfo {
                    sha256: digest(&package).await.unwrap(),
                    ..Default::default()
                },
            });
        }
        assert!(engine.horizon_mod_status(&p.id).await.unwrap().needs_build);
        let profile = engine.profile(&p.id).await.unwrap();
        assert!(engine
            .native_launch_directory(&profile, false)
            .await
            .is_err());
        assert!(engine
            .native_launch_directory(&profile, true)
            .await
            .unwrap()
            .is_none());
        let version = "native-test";
        let built = engine.compiler_root().join("versions").join(version);
        std::fs::create_dir_all(&built).unwrap();
        let client = built.join("horizon-client.exe");
        std::fs::write(&client, b"compiled-original").unwrap();
        let record = BuildRecord {
            fingerprint: engine.native_fingerprint(&profile).await.unwrap(),
            version: version.into(),
            client_sha256: digest(&client).await.unwrap(),
            built_at: crate::now(),
        };
        std::fs::write(record_path(&instance), serde_json::to_vec(&record).unwrap()).unwrap();
        assert!(!engine.horizon_mod_status(&p.id).await.unwrap().needs_build);
        assert_eq!(
            engine
                .native_launch_directory(&profile, false)
                .await
                .unwrap(),
            Some(built.clone())
        );
        std::fs::write(&client, b"changed-binary").unwrap();
        assert!(engine.horizon_mod_status(&p.id).await.unwrap().needs_build);
        assert!(engine
            .native_launch_directory(&profile, false)
            .await
            .is_err());
        std::fs::write(&package, b"changed-source").unwrap();
        let status = engine.horizon_mod_status(&p.id).await.unwrap();
        assert!(status.needs_build);
        assert!(status.error.is_some());
        assert!(engine
            .native_launch_directory(&profile, true)
            .await
            .unwrap()
            .is_none());
        let before = std::fs::read(record_path(&instance)).unwrap();
        assert!(engine
            .build_horizon_mods(&p.id, false, &task())
            .await
            .is_err());
        assert_eq!(std::fs::read(record_path(&instance)).unwrap(), before);
        assert!(!engine.root.join("horizon/tools").exists());
        engine
            .manage_horizon_mod(&p.id, "horizon:one", "toggle")
            .await
            .unwrap();
        assert!(!engine.horizon_mod_status(&p.id).await.unwrap().needs_build);
        engine
            .manage_horizon_mod(&p.id, "horizon:one", "remove")
            .await
            .unwrap();
        assert!(!package.exists());
        assert!(engine
            .horizon_mod_status(&p.id)
            .await
            .unwrap()
            .mods
            .is_empty());
    }
    #[tokio::test]
    async fn failed_process_keeps_previous_build_record_and_exposes_log() {
        let root = tempfile::tempdir().unwrap();
        let record = root.path().join("native-build.json");
        std::fs::write(&record, b"previous-build").unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.arg("--not-a-test-runner-option");
        let log = root.path().join("build.log");
        assert!(run_build(command, &task(), &log).await.is_err());
        assert_eq!(std::fs::read(record).unwrap(), b"previous-build");
        assert!(!std::fs::read(log).unwrap().is_empty());
    }
    #[tokio::test]
    #[ignore = "contacts the public Horizon registry and downloads one reviewed source bundle into .test-data"]
    async fn live_registry_and_signed_native_bundle_install_without_compilation() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../.test-data")
            .join(format!("horizon-registry-live-{}", uuid::Uuid::new_v4()));
        let engine = Engine::new(root, |_| {}).await.unwrap();
        let index = engine.horizon_index().await.unwrap();
        let raw = index["projects"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| {
                p["kind"] == "native-mod"
                    && p["key"].is_string()
                    && !versions(&index, p, None).is_empty()
            })
            .unwrap();
        let id = raw["id"].as_str().unwrap();
        let version = versions(&index, raw, None)[0]["version"].as_str().unwrap();
        let profile = engine
            .create_profile_with_engine(
                "Registry check".into(),
                MINECRAFT.into(),
                Loader::Vanilla,
                None,
                0,
                Runtime::Horizon,
            )
            .await
            .unwrap();
        engine
            .install_horizon_mod(&profile.id, id, version, &task())
            .await
            .unwrap();
        let status = engine.horizon_mod_status(&profile.id).await.unwrap();
        assert!(status.needs_build);
        assert_eq!(status.mods.len(), 1);
        assert!(status.error.is_none());
        assert!(!engine.root.join("horizon/tools").exists());
        assert!(!engine.root.join("horizon/compiler").exists());
    }
    #[tokio::test]
    #[ignore = "downloads and verifies the official builder into .test-data; does not compile or install Rust"]
    async fn live_signed_builder_and_isolated_instance_discovery() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../.test-data")
            .join(format!("horizon-builder-live-{}", uuid::Uuid::new_v4()));
        let engine = Engine::new(root, |_| {}).await.unwrap();
        let builder = engine.native_builder(&task()).await.unwrap();
        let compiler = engine.compiler_root();
        let home = compiler.join("home");
        let id = uuid::Uuid::new_v4().to_string();
        tokio::fs::create_dir_all(home.join("instances").join(&id))
            .await
            .unwrap();
        let mut query = Command::new(&builder);
        query
            .env("HORIZON_LAUNCHER_HOME", &compiler)
            .env("HORIZON_HOME", &home)
            .args(["instance", "list", "--json"])
            .kill_on_drop(true);
        hide(&mut query);
        let output = tokio::time::timeout(Duration::from_secs(20), query.output())
            .await
            .unwrap()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let list: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(list.as_array().unwrap().iter().any(|v| v["id"] == id));
        assert!(!compiler.join("toolchain").exists());
    }

    #[test]
    #[ignore = "subprocess fixture invoked by the cancellation test"]
    fn native_build_process_fixture() {
        let Ok(root) = std::env::var("AURUM_NATIVE_PROCESS_FIXTURE") else {
            return;
        };
        if std::env::var("AURUM_NATIVE_PROCESS_ROLE").as_deref() == Ok("leaf") {
            std::thread::sleep(Duration::from_secs(20));
            return;
        }
        let mut leaf = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "horizon_mods::tests::native_build_process_fixture",
                "--nocapture",
            ])
            .env("AURUM_NATIVE_PROCESS_ROLE", "leaf")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::fs::write(Path::new(&root).join("leaf.pid"), leaf.id().to_string()).unwrap();
        std::thread::sleep(Duration::from_secs(20));
        let _ = leaf.kill();
        let _ = leaf.wait();
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn cancelling_compilation_terminates_its_owned_process_tree() {
        let root = tempfile::tempdir().unwrap();
        let build_task = task();
        let cancel = build_task.cancel.clone();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--ignored",
                "--exact",
                "horizon_mods::tests::native_build_process_fixture",
                "--nocapture",
            ])
            .env("AURUM_NATIVE_PROCESS_FIXTURE", root.path());
        let log = root.path().join("build.log");
        let worker = tokio::spawn(async move { run_build(command, &build_task, &log).await });
        let pid_file = root.path().join("leaf.pid");
        for _ in 0..100 {
            if pid_file.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(worker.await.unwrap().is_err());
        let pid: u32 = std::fs::read_to_string(pid_file)
            .expect("compiler fixture did not start")
            .parse()
            .unwrap();
        let pid = sysinfo::Pid::from_u32(pid);
        let mut system = sysinfo::System::new();
        for _ in 0..40 {
            system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
            if system.process(pid).is_none() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("compiler descendant still running after cancellation");
    }
}
