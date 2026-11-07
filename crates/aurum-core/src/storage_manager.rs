//! Explicit storage accounting and recoverable deletion. Paths received over IPC are never used.
use crate::{model::*, store::persist, Engine};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const RECORD: &str = ".aurum-trash.json";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCategory {
    pub id: String,
    pub bytes: u64,
    pub cleanable: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEntry {
    pub id: String,
    pub name: String,
    pub bytes: u64,
    pub kind: String,
    pub restorable: bool,
    pub deleted_at: u64,
    pub in_use: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSnapshot {
    pub total_bytes: u64,
    pub cleanable_bytes: u64,
    pub game_directory: String,
    pub launcher_directory: String,
    pub categories: Vec<StorageCategory>,
    pub profiles: Vec<StorageEntry>,
    pub installations: Vec<StorageEntry>,
    pub trash: Vec<StorageEntry>,
    pub browser_cleanup_pending: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct TrashRecord {
    deleted_at: u64,
    profile: Option<Profile>,
    directory: Option<String>,
    profile_id: Option<String>,
    content: Option<Content>,
    destination: Option<String>,
}

pub fn bytes(path: &Path) -> Result<u64> {
    if !path.try_exists()? {
        return Ok(0);
    }
    let mut total = 0u64;
    for entry in walkdir::WalkDir::new(path).follow_links(false) {
        let entry = entry?;
        if entry.file_type().is_symlink() {
            continue;
        }
        if entry.file_type().is_file() {
            total = total.saturating_add(entry.metadata()?.len());
        }
    }
    Ok(total)
}

/// Reject links and directory escapes before any destructive operation.
fn checked(root: &Path, path: &Path) -> Result<()> {
    let root = std::fs::canonicalize(root)?;
    let target = std::fs::canonicalize(path)?;
    if target == root || !target.starts_with(&root) {
        bail!("Папка находится вне хранилища Aurum")
    }
    for entry in walkdir::WalkDir::new(path).follow_links(false) {
        let entry = entry?;
        if entry.file_type().is_symlink()
            || !std::fs::canonicalize(entry.path())?.starts_with(&root)
        {
            bail!("Связанные папки сохранены: {}", entry.path().display())
        }
    }
    Ok(())
}
fn discard(root: &Path, path: &Path) -> Result<u64> {
    if !path.try_exists()? {
        return Ok(0);
    }
    checked(root, path)?;
    let size = bytes(path)?;
    if path.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else {
        std::fs::remove_file(path)?;
    }
    Ok(size)
}
fn children(path: &Path) -> Result<Vec<PathBuf>> {
    if !path.try_exists()? {
        return Ok(vec![]);
    }
    std::fs::read_dir(path)?.map(|e| Ok(e?.path())).collect()
}
fn managed_java_path(root: &Path, configured: &str) -> bool {
    if configured.is_empty() { return false; }
    let managed = root.join("runtimes");
    let path = Path::new(configured);
    path.starts_with(&managed) || std::fs::canonicalize(path).is_ok_and(|path| {
        std::fs::canonicalize(&managed).is_ok_and(|managed| path.starts_with(managed))
    })
}
fn owned_part(name: &str) -> bool {
    name.strip_suffix(".part")
        .and_then(|s| s.rsplit('.').next())
        .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
}
pub fn browser_cache_paths(root: &Path) -> Vec<PathBuf> {
    let app = crate::layout::application(root);
    let web = app.parent().unwrap_or(&app).join("webview/EBWebView");
    [
        "Default/Cache",
        "Default/Code Cache",
        "GrShaderCache",
        "ShaderCache",
        "GPUCache",
        "Default/GPUCache",
        "Default/DawnGraphiteCache",
        "Default/DawnWebGPUCache",
        "Crashpad/reports",
        "component_crx_cache",
    ]
    .iter()
    .map(|p| web.join(p))
    .collect()
}
pub fn clean_browser_cache(root: &Path) -> Result<u64> {
    let app = crate::layout::application(root);
    let launcher = app.parent().unwrap_or(&app);
    let mut removed = 0;
    for path in browser_cache_paths(root) {
        removed += discard(launcher, &path)?;
    }
    let marker = app.join("clear-browser-cache");
    if marker.exists() {
        std::fs::remove_file(marker)?;
    }
    Ok(removed)
}

fn horizon_scratch_paths(root: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = vec![];
    for build in children(&root.join("horizon/builds"))? {
        if !build.join("verified.json").is_file() {
            continue;
        }
        for name in [".local/minecraft", ".local/datagen"] {
            paths.push(build.join(name));
        }
    }
    Ok(paths)
}

impl Engine {
    async fn storage_idle(&self) -> Result<()> {
        self.refresh_recovered().await;
        if !self.operations.lock().await.is_empty()
            || !self.running.lock().await.is_empty()
            || !self.hosting_running().is_empty()
        {
            bail!("Сначала завершите задачи, игру и локальные серверы")
        }
        #[cfg(windows)]
        if self.social.has_active_tunnels() {
            bail!("Сначала завершите совместную игру")
        }
        let paths = self
            .db
            .lock()
            .await
            .profiles
            .iter()
            .map(|p| self.instance(&p.id))
            .collect::<Result<Vec<_>>>()?;
        if crate::processes::directories_running(paths) {
            bail!("Сначала остановите игру")
        }
        Ok(())
    }

    pub async fn storage_snapshot(&self) -> Result<StorageSnapshot> {
        let app = crate::layout::application(&self.root);
        let mut categories = vec![];
        for (id, names, cleanable) in [
            ("profiles", vec!["instances"], false),
            ("minecraft", vec!["assets", "libraries", "versions"], false),
            ("java", vec!["runtimes"], false),
            ("horizon", vec!["horizon"], false),
            ("hosting", vec!["hosting"], false),
            ("temporary", vec!["downloads", "installers"], true),
            ("trash", vec!["trash"], true),
        ] {
            let size = names
                .iter()
                .map(|n| bytes(&self.root.join(n)))
                .collect::<Result<Vec<_>>>()?
                .iter()
                .sum();
            categories.push(StorageCategory {
                id: id.into(),
                bytes: size,
                cleanable,
            });
        }
        let browser_cache: u64 = browser_cache_paths(&self.root)
            .iter()
            .map(|p| bytes(p))
            .collect::<Result<Vec<_>>>()?
            .iter()
            .sum();
        let scratch: u64 = horizon_scratch_paths(&self.root)?
            .iter()
            .map(|p| bytes(p))
            .collect::<Result<Vec<_>>>()?
            .iter()
            .sum();
        let mod_cache = bytes(&self.root.join("horizon/mod-downloads"))?;
        let cache = bytes(&app.join("cache"))? + browser_cache + scratch + mod_cache;
        if let Some(horizon) = categories.iter_mut().find(|c| c.id == "horizon") {
            horizon.bytes = horizon.bytes.saturating_sub(scratch + mod_cache);
        }
        categories.push(StorageCategory {
            id: "cache".into(),
            bytes: cache,
            cleanable: true,
        });
        let logs = bytes(&app.join("logs"))?;
        categories.push(StorageCategory {
            id: "logs".into(),
            bytes: logs,
            cleanable: true,
        });
        let app_total = if app != self.root {
            bytes(app.parent().unwrap())?
        } else {
            0
        };
        categories.push(StorageCategory {
            id: "launcher".into(),
            bytes: app_total.saturating_sub(bytes(&app.join("cache"))? + browser_cache + logs),
            cleanable: false,
        });
        let known_game: u64 = categories
            .iter()
            .filter(|c| !["cache", "logs", "launcher"].contains(&c.id.as_str()))
            .map(|c| c.bytes)
            .sum();
        let other = bytes(&self.root)?.saturating_sub(known_game + scratch + mod_cache);
        if other > 0 {
            categories.push(StorageCategory {
                id: "other".into(),
                bytes: other,
                cleanable: false,
            });
        }
        let db = self.db.lock().await;
        let profiles = db
            .profiles
            .iter()
            .map(|p| {
                Ok(StorageEntry {
                    id: p.id.clone(),
                    name: p.name.clone(),
                    bytes: bytes(&self.instance(&p.id)?)?,
                    kind: "profile".into(),
                    restorable: false,
                    deleted_at: 0,
                    in_use: true,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let mut used_versions = std::collections::HashSet::new();
        let mut used_java = std::collections::HashSet::new();
        let mut unknown_java = false;
        let mut used_horizon = std::collections::HashSet::new();
        for profile in &db.profiles {
            used_versions.insert(profile.minecraft.clone());
            if let Some(version) = &profile.installed_version {
                if profile.engine == Runtime::Horizon {
                    used_horizon.insert(version.clone());
                } else {
                    used_versions.insert(version.clone());
                }
            }
            let version = self
                .root
                .join("versions")
                .join(&profile.minecraft)
                .join(format!("{}.json", profile.minecraft));
            let metadata = std::fs::read(version)
                .ok()
                .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok());
            if let Some(major) = metadata
                .as_ref()
                .and_then(|m| m["javaVersion"]["majorVersion"].as_u64())
            {
                used_java.insert(major as u32);
            } else {
                unknown_java = true;
            }
        }
        let configured_java = db.settings.java_path.clone();
        drop(db);
        for profile in self.hosting_profiles().await? {
            used_java.insert(profile.java_major);
        }
        let mut installations = vec![];
        for (kind, folder) in [
            ("java", "runtimes"),
            ("version", "versions"),
            ("horizon", "horizon/builds"),
        ] {
            for path in children(&self.root.join(folder))? {
                if !path.is_dir() {
                    continue;
                }
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                let in_use = match kind {
                    "java" => {
                        unknown_java
                            || Path::new(&configured_java).starts_with(&path)
                            || name
                                .strip_prefix("java-")
                                .and_then(|n| n.parse::<u32>().ok())
                                .is_none_or(|n| used_java.contains(&n))
                    }
                    "version" => used_versions.contains(&name),
                    _ => used_horizon.contains(&name),
                };
                let mut size = bytes(&path)?;
                if kind == "horizon" {
                    size += bytes(&self.root.join("horizon/resources").join(&name))?;
                }
                installations.push(StorageEntry {
                    id: format!("{kind}/{name}"),
                    name,
                    bytes: size,
                    kind: kind.into(),
                    restorable: false,
                    deleted_at: 0,
                    in_use,
                });
            }
        }
        let trash = self.trash_entries()?;
        Ok(StorageSnapshot {
            total_bytes: categories.iter().map(|c| c.bytes).sum(),
            cleanable_bytes: categories
                .iter()
                .filter(|c| c.cleanable)
                .map(|c| c.bytes)
                .sum(),
            game_directory: self.root.to_string_lossy().into(),
            launcher_directory: app.parent().unwrap_or(&app).to_string_lossy().into(),
            categories,
            profiles,
            installations,
            trash,
            browser_cleanup_pending: app.join("clear-browser-cache").exists(),
        })
    }

    fn trash_entries(&self) -> Result<Vec<StorageEntry>> {
        let root = self.root.join("trash");
        let mut paths = vec![];
        for entry in children(&root)? {
            if entry.file_name().is_some_and(|n| n == "content") {
                paths.extend(children(&entry)?);
            } else {
                paths.push(entry);
            }
        }
        let mut entries = vec![];
        for path in paths {
            let record = std::fs::read(path.join(RECORD))
                .ok()
                .and_then(|b| serde_json::from_slice::<TrashRecord>(&b).ok());
            let name = record
                .as_ref()
                .and_then(|r| {
                    r.profile
                        .as_ref()
                        .map(|p| p.name.clone())
                        .or_else(|| r.content.as_ref().map(|c| c.name.clone()))
                })
                .unwrap_or_else(|| path.file_name().unwrap().to_string_lossy().into());
            entries.push(StorageEntry {
                id: path
                    .strip_prefix(&root)?
                    .to_string_lossy()
                    .replace('\\', "/"),
                name,
                bytes: bytes(&path)?,
                kind: if record.as_ref().is_some_and(|r| r.profile.is_some()) {
                    "profile"
                } else {
                    "content"
                }
                .into(),
                restorable: record.is_some(),
                deleted_at: record.map_or(0, |r| r.deleted_at),
                in_use: false,
            });
        }
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.deleted_at));
        Ok(entries)
    }

    pub async fn trash_profile(&self, id: &str) -> Result<()> {
        self.ensure_idle(id).await?;
        let profile = self.profile(id).await?;
        let source = self.instance(id)?;
        let mut db = self.db.lock().await;
        let directory = db
            .instance_directories
            .get(id)
            .cloned()
            .unwrap_or_else(|| id.into());
        let mut next = db.clone();
        next.profiles.retain(|p| p.id != id);
        next.instance_directories.remove(id);
        let target = self
            .root
            .join("trash")
            .join(format!("{}-{id}", crate::now()));
        if source.exists() {
            checked(&self.root, &source)?;
            std::fs::create_dir_all(target.parent().unwrap())?;
            let record = TrashRecord {
                deleted_at: crate::now(),
                profile: Some(profile),
                directory: Some(directory),
                profile_id: None,
                content: None,
                destination: None,
            };
            std::fs::write(source.join(RECORD), serde_json::to_vec(&record)?)?;
            std::fs::rename(&source, &target)?;
        } else {
            // Even an uninstalled profile can be restored.
            std::fs::create_dir_all(&target)?;
            let record = TrashRecord {
                deleted_at: crate::now(),
                profile: Some(profile),
                directory: Some(directory),
                profile_id: None,
                content: None,
                destination: None,
            };
            std::fs::write(target.join(RECORD), serde_json::to_vec(&record)?)?;
        }
        if let Err(error) = persist(&self.root, &next).await {
            std::fs::rename(&target, &source).context("Не удалось вернуть сборку из корзины")?;
            return Err(error);
        }
        *db = next;
        self.instance_directories.write().unwrap().remove(id);
        Ok(())
    }

    pub(crate) async fn trash_content(
        &self,
        profile_id: &str,
        item: &Content,
        source: &Path,
    ) -> Result<()> {
        let instance = self.instance(profile_id)?;
        checked(&self.root, source)?;
        let destination = source
            .strip_prefix(&instance)?
            .to_string_lossy()
            .replace('\\', "/");
        let target = self
            .root
            .join("trash/content")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&target)?;
        let record = TrashRecord {
            deleted_at: crate::now(),
            profile: None,
            directory: None,
            profile_id: Some(profile_id.into()),
            content: Some(item.clone()),
            destination: Some(destination),
        };
        std::fs::write(target.join(RECORD), serde_json::to_vec(&record)?)?;
        std::fs::rename(source, target.join(&item.filename))?;
        Ok(())
    }

    pub async fn storage_trash(&self, ids: &[String], restore: bool) -> Result<u64> {
        let _guard = self
            .busy
            .try_lock()
            .map_err(|_| anyhow::anyhow!("Дождитесь завершения операции"))?;
        self.storage_idle().await?;
        let root = self.root.join("trash");
        let entries = self.trash_entries()?;
        let mut targets = vec![];
        for id in ids {
            if !entries.iter().any(|e| &e.id == id) {
                bail!("Элемент корзины уже изменился")
            }
            let path = crate::safe_join(&root, id)?;
            checked(&root, &path)?;
            targets.push(path);
        }
        let mut changed = 0;
        if restore {
            targets.sort_by_key(|p| {
                std::fs::read(p.join(RECORD))
                    .ok()
                    .and_then(|b| serde_json::from_slice::<TrashRecord>(&b).ok())
                    .is_none_or(|r| r.profile.is_none())
            });
        }
        for path in targets {
            let size = bytes(&path)?;
            if !restore {
                changed += discard(&root, &path)?;
                continue;
            }
            let record: TrashRecord = serde_json::from_slice(
                &std::fs::read(path.join(RECORD))
                    .context("Для старого элемента корзины нет данных восстановления")?,
            )?;
            let mut db = self.db.lock().await;
            let mut next = db.clone();
            if let Some(mut profile) = record.profile {
                if next.profiles.iter().any(|p| p.id == profile.id) {
                    bail!("Эта сборка уже существует")
                }
                let name = record.directory.context("Нет имени папки сборки")?;
                let target = crate::directories::instance_path(&self.root, &name)?;
                if target.exists() {
                    bail!("Папка сборки уже существует: {name}")
                }
                std::fs::create_dir_all(target.parent().unwrap())?;
                let id = profile.id.clone();
                if let Some(version) = &profile.installed_version {
                    let installed = if profile.engine == Runtime::Horizon {
                        self.root.join("horizon/builds").join(version).join("horizon-client.exe").is_file()
                            && self.root.join("horizon/resources").join(version).join("horizon-resources.json").is_file()
                    } else {
                        self.root.join("versions").join(version).join(format!("{version}.json")).is_file()
                    };
                    if !installed { profile.installed_version = None; }
                }
                next.profiles.push(profile);
                next.instance_directories.insert(id.clone(), name.clone());
                std::fs::rename(&path, &target)?;
                if let Err(error) = persist(&self.root, &next).await {
                    std::fs::rename(&target, &path)?;
                    return Err(error);
                }
                let _ = std::fs::remove_file(target.join(RECORD));
                self.instance_directories.write().unwrap().insert(id, name);
            } else {
                let id = record.profile_id.context("Нет исходной сборки")?;
                let item = record.content.context("Нет данных файла")?;
                let profile = next
                    .profiles
                    .iter_mut()
                    .find(|p| p.id == id)
                    .context("Сначала восстановите исходную сборку")?;
                if profile.content.iter().any(|c| c.id == item.id) {
                    bail!("Этот контент уже установлен")
                }
                let target = crate::safe_join(
                    &self.instance(&id)?,
                    &record.destination.context("Нет пути файла")?,
                )?;
                if target.exists() {
                    bail!("Файл с таким именем уже существует")
                }
                let source = crate::safe_join(&path, &item.filename)?;
                std::fs::create_dir_all(target.parent().unwrap())?;
                std::fs::rename(&source, &target)?;
                profile.content.push(item);
                if let Err(error) = persist(&self.root, &next).await {
                    std::fs::rename(&target, &source)?;
                    return Err(error);
                }
                discard(&root, &path)?;
            }
            *db = next;
            changed += size;
        }
        Ok(changed)
    }

    /// Run only before tasks start, or while holding the maintenance gate.
    pub async fn cleanup_installation_leftovers(&self) -> Result<u64> {
        let mut removed = 0;
        for name in [
            "assets",
            "libraries",
            "versions",
            "runtimes",
            "downloads",
            "horizon/downloads",
        ] {
            let base = self.root.join(name);
            if !base.exists() {
                continue;
            }
            let files = walkdir::WalkDir::new(&base)
                .follow_links(false)
                .into_iter()
                .collect::<std::result::Result<Vec<_>, _>>()?;
            for entry in files {
                if entry.file_type().is_file() && owned_part(&entry.file_name().to_string_lossy()) {
                    removed += discard(&self.root, entry.path())?;
                }
            }
        }
        for path in children(&self.root.join("downloads"))? {
            if path.extension().is_some_and(|e| e == "zip")
                && path
                    .file_stem()
                    .is_some_and(|n| uuid::Uuid::parse_str(&n.to_string_lossy()).is_ok())
            {
                removed += discard(&self.root, &path)?;
            }
        }
        for path in children(&self.root.join("installers"))? {
            let name = path.file_name().unwrap().to_string_lossy();
            if (name.starts_with("forge-") || name.starts_with("neoforge-"))
                && name.ends_with(".jar")
            {
                removed += discard(&self.root, &path)?;
            }
        }
        for path in children(&self.root.join("horizon/downloads"))? {
            let stem = path.file_stem().unwrap_or_default().to_string_lossy();
            if path.extension().is_some_and(|e| e == "zip")
                && ((stem.len() == 64 && stem.bytes().all(|b| b.is_ascii_hexdigit()))
                    || stem.starts_with("native-builder-"))
            {
                removed += discard(&self.root, &path)?;
            }
        }
        for version in children(&self.root.join("versions"))? {
            removed += discard(&self.root, &version.join("horizon-server-source.jar"))?;
        }
        for path in children(&self.root.join("horizon/mod-downloads"))? {
            if path.extension().is_some_and(|e| e == "hnmod") {
                removed += discard(&self.root, &path)?;
            }
        }
        if !crate::layout::app_path(&self.root, "instance-move.json").exists() {
            for path in children(&self.root.join("staging"))? {
                let name = path.file_name().unwrap().to_string_lossy();
                if !name.starts_with("social-") && !path.join("backup").exists() {
                    removed += discard(&self.root, &path)?;
                }
            }
        }
        for name in ["horizon/staging", "horizon/compiler/inputs"] {
            for path in children(&self.root.join(name))? {
                removed += discard(&self.root, &path)?;
            }
        }
        for path in children(&self.root.join("runtimes"))? {
            let name = path.file_name().unwrap().to_string_lossy();
            if name.starts_with(".preparation-")
                || (name.starts_with(".java-")
                    && (name.ends_with(".zip") || name.ends_with(".installing")))
            {
                removed += discard(&self.root, &path)?;
            }
        }
        // These were bundled by older releases; current Social runtimes have their own lifecycle.
        let social = crate::layout::app_path(&self.root, "social");
        for name in ["aurum-social-worker.exe", "aurum-social-firewall.exe"] {
            removed += discard(&crate::layout::application(&self.root), &social.join(name))?;
        }
        let log_root = crate::layout::app_path(&self.root, "logs");
        let mut logs = children(&log_root)?;
        logs.sort_by_key(|p| std::cmp::Reverse(p.metadata().and_then(|m| m.modified()).ok()));
        for path in logs.into_iter().skip(20) {
            if path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("installer-")
            {
                removed += discard(&log_root, &path)?;
            }
        }
        Ok(removed)
    }

    pub async fn clean_storage(&self, category: &str) -> Result<u64> {
        let _guard = self
            .busy
            .try_lock()
            .map_err(|_| anyhow::anyhow!("Дождитесь завершения операции"))?;
        self.storage_idle().await?;
        let app = crate::layout::application(&self.root);
        let mut removed = 0;
        match category {
            "temporary" => {
                removed += self.cleanup_installation_leftovers().await?;
            }
            "cache" => {
                for path in children(&app.join("cache"))? {
                    removed += discard(&app, &path)?;
                }
                for path in children(&self.root.join("horizon/mod-downloads"))? {
                    removed += discard(&self.root, &path)?;
                }
                for build in children(&self.root.join("horizon/builds"))? {
                    let resources = self
                        .root
                        .join("horizon/resources")
                        .join(build.file_name().unwrap());
                    if !build.join("verified.json").is_file()
                        || !resources.join("horizon-resources.json").is_file()
                    {
                        continue;
                    }
                    checked(&self.root, &build)?;
                    let mut command =
                        tokio::process::Command::new(build.join("horizon-prepare.exe"));
                    command
                        .current_dir(&build)
                        .args(["--check", "--output"])
                        .arg(&resources)
                        .kill_on_drop(true);
                    crate::minecraft::hide(&mut command);
                    if tokio::time::timeout(std::time::Duration::from_secs(20), command.output())
                        .await
                        .is_ok_and(|r| r.is_ok_and(|o| o.status.success()))
                    {
                        for name in [".local/minecraft", ".local/datagen"] {
                            removed += discard(&self.root, &build.join(name))?;
                        }
                    }
                }
                std::fs::write(app.join("clear-browser-cache"), b"1")?;
            }
            "logs" => {
                for path in children(&app.join("logs"))? {
                    removed += discard(&app, &path)?;
                }
            }
            _ => bail!("Неизвестная категория очистки"),
        }
        Ok(removed)
    }

    /// Remove an entire storage category. Instance directories are never included
    /// in reinstallable component plans; external Java and server folders stay untouched.
    pub async fn remove_storage_component(&self, category: &str) -> Result<u64> {
        if matches!(category, "cache" | "temporary" | "logs") {
            return self.clean_storage(category).await;
        }
        if category == "trash" {
            let ids = self.trash_entries()?.into_iter().map(|entry| entry.id).collect::<Vec<_>>();
            return self.storage_trash(&ids, false).await;
        }
        let _guard = self.busy.try_lock()
            .map_err(|_| anyhow::anyhow!("Дождитесь завершения операции"))?;
        self.storage_idle().await?;
        if category == "profiles" {
            let ids = self.db.lock().await.profiles.iter().map(|p| p.id.clone()).collect::<Vec<_>>();
            // Validate every instance before moving the first one.
            for id in &ids {
                let path = self.instance(id)?;
                if path.try_exists()? { checked(&self.root, &path)?; }
            }
            for id in ids { self.trash_profile(&id).await?; }
            return Ok(0); // Recoverable deletion does not reclaim space yet.
        }
        let targets = match category {
            "minecraft" => ["assets", "libraries", "versions"].map(|name| self.root.join(name)).to_vec(),
            "java" => vec![self.root.join("runtimes")],
            "horizon" => vec![self.root.join("horizon")],
            "hosting" => vec![self.root.join("hosting")],
            "other" => self.other_storage_paths()?,
            _ => bail!("Неизвестный компонент хранилища"),
        };
        // Hosting has its own start/install lock in addition to the engine lock.
        let _hosting = if matches!(category, "hosting" | "java") { Some(self.hosting.gate.lock().await) } else { None };
        if matches!(category, "hosting" | "java") {
            self.check_hosting_storage_idle().await?;
        }
        for path in &targets {
            if path.try_exists()? { checked(&self.root, path)?; }
        }
        if matches!(category, "minecraft" | "horizon" | "java") {
            let mut db = self.db.lock().await;
            let mut next = db.clone();
            if category == "java" {
                if managed_java_path(&self.root, &next.settings.java_path) {
                    next.settings.java_path.clear();
                }
                let mut servers = self.hosting_profiles_unlocked().await?;
                let mut changed = false;
                for server in &mut servers {
                    if managed_java_path(&self.root, &server.java_path) {
                        server.java_path.clear();
                        changed = true;
                    }
                }
                if changed { self.hosting_save(&servers).await?; }
            } else {
                for profile in &mut next.profiles {
                    if (category == "horizon") == (profile.engine == Runtime::Horizon) {
                        profile.installed_version = None;
                    }
                }
            }
            // Publish the reinstall requirement before touching shared files.
            // If a delete fails, a repair remains available and personal data stays intact.
            persist(&self.root, &next).await?;
            *db = next;
        }
        let mut removed = 0;
        for path in targets { removed += discard(&self.root, &path)?; }
        Ok(removed)
    }

    fn other_storage_paths(&self) -> Result<Vec<PathBuf>> {
        let app = crate::layout::application(&self.root);
        let known = ["instances", "assets", "libraries", "versions", "runtimes", "horizon", "hosting", "downloads", "installers", "trash", ".aurum-data-owner"];
        Ok(children(&self.root)?.into_iter().filter(|path| {
            let name = path.file_name().unwrap().to_string_lossy();
            !known.contains(&name.as_ref())
                && !(app == self.root && crate::layout::APP_ENTRIES.contains(&name.as_ref()))
        }).collect())
    }

    pub async fn remove_unused_installation(&self, id: &str) -> Result<u64> {
        let _guard = self
            .busy
            .try_lock()
            .map_err(|_| anyhow::anyhow!("Дождитесь завершения операции"))?;
        self.storage_idle().await?;
        let snapshot = self.storage_snapshot().await?;
        let entry = snapshot
            .installations
            .iter()
            .find(|e| e.id == id)
            .context("Версия уже удалена")?;
        if entry.in_use {
            bail!("Версия используется сборкой или сервером")
        }
        let name = id.split_once('/').context("Неверная версия")?.1;
        let folder = match entry.kind.as_str() {
            "java" => "runtimes",
            "version" => "versions",
            "horizon" => "horizon/builds",
            _ => bail!("Неизвестный тип версии"),
        };
        let path = crate::safe_join(&self.root.join(folder), name)?;
        let mut removed = discard(&self.root, &path)?;
        if entry.kind == "horizon" {
            removed += discard(
                &self.root,
                &crate::safe_join(&self.root.join("horizon/resources"), name)?,
            )?;
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn component_removal_preserves_instances_and_invalidates_only_the_affected_engine() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/storage-components");
        std::fs::create_dir_all(&base).unwrap();
        let fixture = tempfile::tempdir_in(base).unwrap();
        let root = crate::layout::prepare(&fixture.path().join("home")).unwrap();
        let e = Engine::new(root.clone(), |_| {}).await.unwrap();
        let java = e.create_profile("Java world".into(), "1.21.1".into(), Loader::Vanilla, None, 0).await.unwrap();
        let native = e.create_profile("Horizon world".into(), "26.3".into(), Loader::Vanilla, None, 0).await.unwrap();
        {
            let mut db = e.db.lock().await;
            db.profiles[0].installed_version = Some("1.21.1".into());
            db.profiles[1].engine = Runtime::Horizon;
            db.profiles[1].installed_version = Some("nightly-test".into());
            persist(&root, &db).await.unwrap();
        }
        for p in [&java, &native] {
            let instance = e.instance(&p.id).unwrap();
            std::fs::create_dir_all(instance.join("saves/world")).unwrap();
            std::fs::write(instance.join("saves/world/level.dat"), b"precious-world").unwrap();
            std::fs::write(instance.join("options.txt"), b"settings").unwrap();
        }
        for path in ["assets/test", "libraries/test", "versions/1.21.1/1.21.1.json", "horizon/builds/nightly-test/client", "horizon/resources/nightly-test/data", "runtimes/java-17/bin/java.exe"] {
            let path = root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"data").unwrap();
        }
        assert!(e.remove_storage_component("../instances").await.is_err());
        assert_eq!(e.remove_storage_component("horizon").await.unwrap(), 8);
        assert!(e.profile(&native.id).await.unwrap().installed_version.is_none());
        assert_eq!(e.profile(&java.id).await.unwrap().installed_version.as_deref(), Some("1.21.1"));
        assert_eq!(e.remove_storage_component("minecraft").await.unwrap(), 12);
        assert!(e.profile(&java.id).await.unwrap().installed_version.is_none());
        let outside = fixture.path().join("system-java.exe");
        std::fs::write(&outside, b"external-java").unwrap();
        e.db.lock().await.settings.java_path = outside.to_string_lossy().into();
        assert_eq!(e.remove_storage_component("java").await.unwrap(), 4);
        assert!(outside.exists());
        assert_eq!(e.db.lock().await.settings.java_path, outside.to_string_lossy());
        for p in [&java, &native] {
            assert_eq!(std::fs::read(e.instance(&p.id).unwrap().join("saves/world/level.dat")).unwrap(), b"precious-world");
            assert_eq!(std::fs::read(e.instance(&p.id).unwrap().join("options.txt")).unwrap(), b"settings");
        }
        let reopened = Engine::new(root, |_| {}).await.unwrap();
        assert_eq!(reopened.db.lock().await.profiles.len(), 2);
        assert!(reopened.profile(&java.id).await.unwrap().installed_version.is_none());
    }

    #[tokio::test]
    async fn bulk_profiles_remain_recoverable_after_shared_files_are_removed() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/storage-components");
        std::fs::create_dir_all(&base).unwrap();
        let fixture = tempfile::tempdir_in(base).unwrap();
        let e = Engine::new(fixture.path().into(), |_| {}).await.unwrap();
        let p = e.create_profile("Keep my world".into(), "1.21.1".into(), Loader::Vanilla, None, 0).await.unwrap();
        e.db.lock().await.profiles[0].installed_version = Some("1.21.1".into());
        let instance = e.instance(&p.id).unwrap();
        std::fs::create_dir_all(instance.join("saves/world")).unwrap();
        std::fs::write(instance.join("saves/world/level.dat"), b"world").unwrap();
        assert_eq!(e.remove_storage_component("profiles").await.unwrap(), 0);
        assert!(e.db.lock().await.profiles.is_empty());
        let snapshot = e.storage_snapshot().await.unwrap();
        assert_eq!(snapshot.trash.len(), 1);
        assert!(snapshot.trash[0].restorable);
        e.remove_storage_component("minecraft").await.unwrap();
        e.storage_trash(&[snapshot.trash[0].id.clone()], true).await.unwrap();
        assert!(e.profile(&p.id).await.unwrap().installed_version.is_none());
        assert_eq!(std::fs::read(e.instance(&p.id).unwrap().join("saves/world/level.dat")).unwrap(), b"world");
    }

    #[tokio::test]
    async fn category_removal_rejects_active_operations_and_keeps_owner_and_app_state() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/storage-components");
        std::fs::create_dir_all(&base).unwrap();
        let fixture = tempfile::tempdir_in(base).unwrap();
        let e = Engine::new(fixture.path().into(), |_| {}).await.unwrap();
        std::fs::create_dir_all(e.root.join("runtimes/java-17/bin")).unwrap();
        let managed = e.root.join("runtimes/java-17/bin/java.exe");
        std::fs::write(&managed, b"runtime").unwrap();
        e.db.lock().await.settings.java_path = managed.to_string_lossy().into();
        let task = e.task(uuid::Uuid::new_v4().to_string(), None).await.unwrap();
        assert!(e.remove_storage_component("java").await.is_err());
        assert!(managed.exists());
        e.finish(&task, &Ok(())).await;
        e.remove_storage_component("java").await.unwrap();
        assert!(e.db.lock().await.settings.java_path.is_empty());
        crate::storage::register_owner(&e.root, "test.application").unwrap();
        std::fs::write(e.root.join("old.tmp"), b"unused").unwrap();
        let app_state = std::fs::read(e.root.join("state.json")).unwrap();
        e.remove_storage_component("other").await.unwrap();
        assert_eq!(std::fs::read(e.root.join("state.json")).unwrap(), app_state);
        assert!(e.root.join(".aurum-data-owner").is_file());
        assert!(!e.root.join("old.tmp").exists());
    }

    #[test]
    fn graphics_cache_cleanup_preserves_browser_preferences() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/storage-components");
        std::fs::create_dir_all(&base).unwrap();
        let fixture = tempfile::tempdir_in(base).unwrap();
        let games = crate::layout::prepare(fixture.path()).unwrap();
        let browser = crate::layout::application(&games).parent().unwrap().join("webview/EBWebView/Default");
        for path in ["GPUCache/data", "DawnGraphiteCache/data", "DawnWebGPUCache/data", "Local Storage/preferences"] {
            let file = browser.join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"data").unwrap();
        }
        assert_eq!(clean_browser_cache(&games).unwrap(), 12);
        assert_eq!(std::fs::read(browser.join("Local Storage/preferences")).unwrap(), b"data");
    }

    #[tokio::test]
    async fn removing_hosting_storage_does_not_delete_imported_external_worlds() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/storage-components");
        std::fs::create_dir_all(&base).unwrap();
        let fixture = tempfile::tempdir_in(base).unwrap();
        let games = crate::layout::prepare(&fixture.path().join("home")).unwrap();
        let e = Engine::new(games.clone(), |_| {}).await.unwrap();
        let outside = fixture.path().join("external-server");
        std::fs::create_dir_all(outside.join("world")).unwrap();
        std::fs::write(outside.join("world/level.dat"), b"external-world").unwrap();
        std::fs::create_dir_all(games.join("hosting/server/world")).unwrap();
        std::fs::write(games.join("hosting/server/world/level.dat"), b"managed-world").unwrap();
        assert_eq!(e.remove_storage_component("hosting").await.unwrap(), 13);
        assert!(!games.join("hosting").exists());
        assert_eq!(std::fs::read(outside.join("world/level.dat")).unwrap(), b"external-world");
        assert!(e.hosting_profiles().await.unwrap().is_empty());
    }
    #[tokio::test]
    async fn profile_trash_roundtrip_preserves_world_and_metadata() {
        let root = {
            let test_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../.test-data/storage-maintenance");
            std::fs::create_dir_all(&test_root).unwrap();
            tempfile::tempdir_in(test_root).unwrap()
        };
        let e = Engine::new(root.path().into(), |_| {}).await.unwrap();
        let p = e
            .create_profile("World".into(), "1.20.1".into(), Loader::Vanilla, None, 0)
            .await
            .unwrap();
        let game = e.profile_directory(&p.id).await.unwrap();
        std::fs::create_dir(game.join("saves")).unwrap();
        std::fs::write(game.join("saves/level.dat"), b"world").unwrap();
        e.delete_profile(&p.id).await.unwrap();
        let snapshot = e.storage_snapshot().await.unwrap();
        assert_eq!(snapshot.trash.len(), 1);
        assert!(e.profile(&p.id).await.is_err());
        e.storage_trash(&[snapshot.trash[0].id.clone()], true)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(e.instance(&p.id).unwrap().join("saves/level.dat")).unwrap(),
            b"world"
        );
        assert_eq!(e.profile(&p.id).await.unwrap().name, "World");
    }
    #[tokio::test]
    async fn cleanup_leaves_user_archives_and_recovery_backups() {
        let root = {
            let test_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../.test-data/storage-maintenance");
            std::fs::create_dir_all(&test_root).unwrap();
            tempfile::tempdir_in(test_root).unwrap()
        };
        let e = Engine::new(root.path().into(), |_| {}).await.unwrap();
        std::fs::create_dir_all(root.path().join("downloads")).unwrap();
        std::fs::write(root.path().join("downloads/my-pack.zip"), b"keep").unwrap();
        let owned = root
            .path()
            .join("downloads")
            .join(format!("{}.zip", uuid::Uuid::new_v4()));
        std::fs::write(&owned, b"remove").unwrap();
        std::fs::create_dir_all(root.path().join("staging/recovery/backup")).unwrap();
        std::fs::write(root.path().join("staging/recovery/backup/world"), b"keep").unwrap();
        e.cleanup_installation_leftovers().await.unwrap();
        assert!(!owned.exists());
        assert!(root.path().join("downloads/my-pack.zip").exists());
        assert!(root.path().join("staging/recovery/backup/world").exists());
        assert!(e
            .storage_trash(&["../instances".into()], false)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn content_restore_preserves_disabled_state_and_refuses_overwriting() {
        let test_root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/storage-maintenance");
        std::fs::create_dir_all(&test_root).unwrap();
        let root = tempfile::tempdir_in(test_root).unwrap();
        let e = Engine::new(root.path().into(), |_| {}).await.unwrap();
        let p = e
            .create_profile("World".into(), "1.20.1".into(), Loader::Vanilla, None, 0)
            .await
            .unwrap();
        let game = e.profile_directory(&p.id).await.unwrap();
        std::fs::create_dir(game.join("mods")).unwrap();
        let source = game.join("mods/test.jar.disabled");
        std::fs::write(&source, b"original").unwrap();
        let item = Content {
            id: "local:test".into(),
            source: "local".into(),
            project_id: "".into(),
            version_id: "".into(),
            name: "Test".into(),
            filename: "test.jar".into(),
            kind: "mod".into(),
            enabled: false,
            info: ContentInfo::default(),
        };
        e.trash_content(&p.id, &item, &source).await.unwrap();
        let id = e.trash_entries().unwrap()[0].id.clone();
        std::fs::write(&source, b"replacement").unwrap();
        assert!(e
            .storage_trash(std::slice::from_ref(&id), true)
            .await
            .is_err());
        assert_eq!(std::fs::read(&source).unwrap(), b"replacement");
        std::fs::remove_file(&source).unwrap();
        e.storage_trash(&[id], true).await.unwrap();
        assert_eq!(std::fs::read(&source).unwrap(), b"original");
        assert!(!e.profile(&p.id).await.unwrap().content[0].enabled);
    }

    #[tokio::test]
    async fn cancelled_copy_removes_partial_data_and_success_copies_application_state() {
        let test_root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/storage-maintenance");
        std::fs::create_dir_all(&test_root).unwrap();
        let fixture = tempfile::tempdir_in(test_root).unwrap();
        let home = fixture.path().join("source");
        let destination = fixture.path().join("destination");
        std::fs::create_dir_all(&destination).unwrap();
        let games = crate::layout::prepare(&home).unwrap();
        let e = Engine::new(games.clone(), |_| {}).await.unwrap();
        let p = e
            .create_profile("World".into(), "1.20.1".into(), Loader::Vanilla, None, 0)
            .await
            .unwrap();
        let game = e.profile_directory(&p.id).await.unwrap();
        std::fs::create_dir(game.join("saves")).unwrap();
        std::fs::write(game.join("saves/level.dat"), b"world").unwrap();
        std::fs::write(
            crate::layout::app_path(&games, "skin-library.json"),
            b"library",
        )
        .unwrap();
        let task = e
            .task(uuid::Uuid::new_v4().to_string(), None)
            .await
            .unwrap();
        task.cancel
            .store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(e.copy_data(&destination, &task).await.is_err());
        assert_eq!(std::fs::read_dir(&destination).unwrap().count(), 0);
        let task = e
            .task(uuid::Uuid::new_v4().to_string(), None)
            .await
            .unwrap();
        e.copy_data(&destination, &task).await.unwrap();
        let copied = crate::layout::prepare(&destination).unwrap();
        let reopened = Engine::new(copied.clone(), |_| {}).await.unwrap();
        assert_eq!(reopened.profile(&p.id).await.unwrap().name, "World");
        assert_eq!(
            std::fs::read(reopened.instance(&p.id).unwrap().join("saves/level.dat")).unwrap(),
            b"world"
        );
        assert_eq!(
            std::fs::read(crate::layout::app_path(&copied, "skin-library.json")).unwrap(),
            b"library"
        );
        assert_eq!(
            std::fs::read(game.join("saves/level.dat")).unwrap(),
            b"world"
        );
    }
}
