mod discovery;
mod install;
mod network;
mod process;
#[cfg(windows)]
mod script;

use crate::Engine;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::sync::Mutex as AsyncMutex;

pub use discovery::{inspect, HostingCandidate, HostingInspection};
pub use install::HostingInstall;
pub use process::{HostingConsole, HostingLive};

#[cfg(test)]
pub(super) fn test_server_jar(path: &Path) {
    use std::io::Write;
    let mut archive = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    archive
        .start_file(
            "META-INF/MANIFEST.MF",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    archive
        .write_all(b"Manifest-Version: 1.0\nMain-Class: net.minecraft.server.Main\n")
        .unwrap();
    archive.finish().unwrap();
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingIcon {
    pub symbol: String,
    pub color: String,
    pub background: String,
}
impl Default for HostingIcon {
    fn default() -> Self {
        Self {
            symbol: "core".into(),
            color: "#e6c56f".into(),
            background: "#302b20".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub root: PathBuf,
    pub directory: String,
    pub entrypoint: String,
    pub core: String,
    pub version: String,
    pub java_major: u32,
    pub java_path: String,
    pub ram_mb: u32,
    pub jvm_args: String,
    pub icon: HostingIcon,
    pub launches: u64,
    pub last_started: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub network: Option<HostingNetworkProfile>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingNetworkProfile {
    pub components: Vec<String>,
    pub startup_script: Option<String>,
    #[serde(default)]
    pub trusted_hash: Option<String>,
    #[serde(default = "network::default_stop_command")]
    pub stop_command: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingSettings {
    pub port: u16,
    pub bind: String,
    pub online_mode: bool,
    pub max_players: u32,
    pub motd: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingFile {
    pub name: String,
    pub directory: bool,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct HostingFiles {
    pub entries: Vec<HostingFile>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingUpdate {
    pub name: String,
    pub description: String,
    pub java_major: u32,
    pub java_path: String,
    pub ram_mb: u32,
    pub jvm_args: String,
    pub icon: HostingIcon,
    pub settings: HostingSettings,
}

#[derive(Default)]
pub struct HostingState {
    pub(crate) gate: AsyncMutex<()>,
    pub(crate) runtime: Mutex<HashMap<String, Arc<process::Runtime>>>,
}

pub(crate) fn confined(root: &Path, relative: &str) -> Result<PathBuf> {
    let path = if relative == "." {
        root.to_path_buf()
    } else {
        crate::safe_join(root, relative)?
    };
    let canonical = path.canonicalize().context("Файл сервера не найден")?;
    if !canonical.starts_with(root.canonicalize()?) {
        bail!("Путь выходит за пределы выбранной папки")
    }
    Ok(canonical)
}

pub(crate) fn proxy(core: &str) -> bool {
    matches!(core, "velocity" | "bungeecord" | "waterfall")
}

fn validate_appearance(update: &HostingUpdate) -> Result<()> {
    if update.name.trim().is_empty() || update.name.len() > 120 || update.description.len() > 2000 {
        bail!("Проверьте название и описание сервера")
    }
    if ![
        "core", "paper", "spigot", "folia", "velocity", "purpur", "vanilla", "fabric", "server",
        "leaf", "gem", "box", "network", "flame",
    ]
    .contains(&update.icon.symbol.as_str())
        || [&update.icon.color, &update.icon.background]
            .iter()
            .any(|color| {
                color.len() != 7
                    || !color.starts_with('#')
                    || !color[1..].bytes().all(|value| value.is_ascii_hexdigit())
            })
    {
        bail!("Неверный стиль значка")
    }
    Ok(())
}

fn validate(update: &HostingUpdate) -> Result<()> {
    validate_appearance(update)?;
    if !(512..=65536).contains(&update.ram_mb) || !(8..=30).contains(&update.java_major) {
        bail!("Проверьте объём RAM и версию Java")
    }
    if update.jvm_args.len() > 4096 || update.java_path.contains(['\r', '\n', '\0']) {
        bail!("Неверные параметры Java")
    }
    let args = shlex::split(&update.jvm_args).context("Проверьте кавычки JVM-аргументов")?;
    if args.iter().any(|arg| {
        !arg.starts_with('-')
            || arg.starts_with("-jar")
            || arg.starts_with("--class-path")
            || arg == "-cp"
            || arg.starts_with("-Xmx")
            || arg.starts_with("-Xms")
            || arg.contains(['\r', '\n', '\0'])
    }) {
        bail!("Укажите только JVM-флаги; память задаётся отдельно")
    }
    let settings = &update.settings;
    if settings.port == 0
        || settings.max_players > 100000
        || settings.bind.len() > 100
        || settings.bind.contains(['\r', '\n', '\0'])
        || settings.motd.len() > 1000
        || settings.motd.contains(['\r', '\n', '\0'])
        || settings
            .motd
            .chars()
            .rev()
            .take_while(|character| *character == '\\')
            .count()
            % 2
            == 1
    {
        bail!("Проверьте сетевые настройки")
    }
    if !settings.bind.is_empty() {
        settings
            .bind
            .parse::<std::net::IpAddr>()
            .context("Адрес привязки должен быть IP-адресом")?;
    }
    Ok(())
}

impl Engine {
    pub fn hosting_running(&self) -> Vec<String> {
        self.hosting
            .runtime
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, runtime)| runtime.active())
            .map(|(id, _)| id.clone())
            .collect()
    }
    pub(crate) async fn hosting_profiles_unlocked(&self) -> Result<Vec<HostingProfile>> {
        let path = self.root.join("hosting/profiles.json");
        if tokio::fs::metadata(&path)
            .await
            .is_ok_and(|metadata| metadata.len() > 8 * 1024 * 1024)
        {
            bail!("Файл профилей хостинга слишком велик; он не изменён")
        }
        match tokio::fs::read(path).await {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .context("Не удалось прочитать профили хостинга; файл не изменён"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        }
    }
    pub async fn hosting_profiles(&self) -> Result<Vec<HostingProfile>> {
        let _guard = self.hosting.gate.lock().await;
        let mut profiles = self.hosting_profiles_unlocked().await?;
        if self.hosting_running().is_empty() && network::group_profiles(&mut profiles)? {
            let backup = self.root.join("hosting/profiles.before-networks.json");
            if !backup.exists() {
                tokio::fs::copy(self.root.join("hosting/profiles.json"), backup).await?;
            }
            self.hosting_save(&profiles).await?;
        }
        Ok(profiles)
    }
    pub(crate) async fn hosting_save(&self, profiles: &[HostingProfile]) -> Result<()> {
        let directory = self.root.join("hosting");
        tokio::fs::create_dir_all(&directory).await?;
        let temporary = directory.join("profiles.json.tmp");
        tokio::fs::write(&temporary, serde_json::to_vec_pretty(profiles)?).await?;
        tokio::fs::rename(temporary, directory.join("profiles.json")).await?;
        Ok(())
    }
    pub(crate) async fn hosting_rebase_copy(&self, target: &Path) -> Result<()> {
        if !self.root.join("hosting/profiles.json").exists() {
            return Ok(());
        }
        let source = self.root.canonicalize()?;
        let mut profiles = self.hosting_profiles_unlocked().await?;
        for profile in &mut profiles {
            if let Ok(relative) = profile.root.strip_prefix(&source) {
                profile.root = target.join(relative);
            }
        }
        tokio::fs::write(
            target.join("hosting/profiles.json"),
            serde_json::to_vec_pretty(&profiles)?,
        )
        .await?;
        Ok(())
    }
    pub(crate) async fn hosting_profile(&self, id: &str) -> Result<HostingProfile> {
        self.hosting_profiles_unlocked()
            .await?
            .into_iter()
            .find(|profile| profile.id == id)
            .context("Профиль сервера не найден")
    }
    pub async fn hosting_import(
        &self,
        root: PathBuf,
        selected: Vec<String>,
    ) -> Result<Vec<HostingProfile>> {
        let _guard = self.hosting.gate.lock().await;
        let inspection = tokio::task::spawn_blocking(move || inspect(&root)).await??;
        if selected.is_empty() || selected.len() > 32 {
            bail!("Выберите серверы для импорта")
        }
        let mut profiles = self.hosting_profiles_unlocked().await?;
        let mut added = Vec::new();
        for id in selected {
            let candidate = inspection
                .candidates
                .iter()
                .find(|candidate| candidate.id == id)
                .context("Состав папки изменился. Повторите поиск")?;
            let folder = confined(&inspection.root, &candidate.directory)?;
            if profiles.iter().any(|profile| {
                confined(&profile.root, &profile.directory).is_ok_and(|existing| existing == folder)
            }) {
                continue;
            }
            let profile = HostingProfile {
                id: uuid::Uuid::new_v4().to_string(),
                name: candidate.name.clone(),
                description: String::new(),
                root: inspection.root.clone(),
                directory: candidate.directory.clone(),
                entrypoint: candidate.entrypoint.clone(),
                core: candidate.core.clone(),
                version: candidate.version.clone(),
                java_major: candidate.java_major,
                java_path: String::new(),
                ram_mb: if proxy(&candidate.core) { 1024 } else { 4096 },
                jvm_args: String::new(),
                icon: HostingIcon::default(),
                launches: 0,
                last_started: None,
                network: None,
            };
            profiles.push(profile.clone());
            added.push(profile);
        }
        if profiles.len() > 100 {
            bail!("Можно добавить не более 100 серверов")
        }
        network::group_profiles(&mut profiles)?;
        self.hosting_save(&profiles).await?;
        let added_ids: Vec<_> = added.iter().map(|profile| &profile.id).collect();
        let children: Vec<_> = profiles
            .iter()
            .filter_map(|profile| profile.network.as_ref())
            .flat_map(|network| network.components.iter().cloned())
            .collect();
        Ok(profiles
            .into_iter()
            .filter(|profile| {
                profile.network.as_ref().map_or_else(
                    || added_ids.contains(&&profile.id) && !children.contains(&profile.id),
                    |network| network.components.iter().any(|id| added_ids.contains(&id)),
                )
            })
            .collect())
    }
    pub async fn hosting_settings(&self, id: &str) -> Result<HostingSettings> {
        let profile = self.hosting_profile(id).await?;
        discovery::settings(&self.hosting_gateway(&profile).await?)
    }
    pub async fn hosting_update(&self, id: &str, update: HostingUpdate) -> Result<()> {
        let _guard = self.hosting.gate.lock().await;
        if self.hosting_running().contains(&id.to_owned()) {
            bail!("Сначала остановите сервер")
        }
        let mut profiles = self.hosting_profiles_unlocked().await?;
        if profiles.iter().any(|profile| {
            profile
                .network
                .as_ref()
                .is_some_and(|network| network.components.contains(&id.to_owned()))
                && self.hosting_running().contains(&profile.id)
        }) {
            bail!("Сначала остановите сеть");
        }
        let profile = profiles
            .iter_mut()
            .find(|profile| profile.id == id)
            .context("Сервер не найден")?;
        if profile.network.is_some() {
            validate_appearance(&update)?;
            profile.name = update.name.trim().into();
            profile.description = update.description;
            profile.icon = update.icon;
            return self.hosting_save(&profiles).await;
        }
        validate(&update)?;
        if process::port_busy(profile).await? {
            bail!("Порт сервера занят. Сначала остановите внешний процесс")
        }
        discovery::write_settings(profile, &update.settings)?;
        profile.name = update.name.trim().into();
        profile.description = update.description;
        profile.java_major = update.java_major;
        profile.java_path = update.java_path;
        profile.ram_mb = update.ram_mb;
        profile.jvm_args = update.jvm_args;
        profile.icon = update.icon;
        self.hosting_save(&profiles).await
    }
    pub async fn hosting_remove(&self, id: &str) -> Result<()> {
        let _guard = self.hosting.gate.lock().await;
        if self.hosting_running().contains(&id.to_owned()) {
            bail!("Сначала остановите сервер")
        }
        let mut profiles = self.hosting_profiles_unlocked().await?;
        let members = profiles
            .iter()
            .find(|profile| profile.id == id)
            .and_then(|profile| profile.network.as_ref())
            .map(|network| network.components.clone())
            .unwrap_or_default();
        if profiles.iter().any(|profile| {
            profile
                .network
                .as_ref()
                .is_some_and(|network| network.components.contains(&id.to_owned()))
        }) {
            bail!("Удалите сеть целиком, а не отдельный компонент")
        }
        profiles.retain(|profile| profile.id != id && !members.contains(&profile.id));
        self.hosting_save(&profiles).await
    }
    pub async fn hosting_path(&self, id: &str, logs: bool) -> Result<PathBuf> {
        let profile = self.hosting_profile(id).await?;
        if logs {
            discovery::config_path(&self.hosting_gateway(&profile).await?, "logs")
        } else {
            confined(&profile.root, &profile.directory)
        }
    }
    pub async fn hosting_files(&self, id: &str, relative: &str) -> Result<HostingFiles> {
        let profile = self.hosting_profile(id).await?;
        let root = confined(&profile.root, &profile.directory)?;
        let directory = confined(&root, relative)?;
        tokio::task::spawn_blocking(move || {
            let mut entries = Vec::new();
            let mut truncated = false;
            for (index, entry) in std::fs::read_dir(directory)?.take(501).enumerate() {
                if index == 500 {
                    truncated = true;
                    break;
                }
                let entry = entry?;
                let path = match entry.path().canonicalize() {
                    Ok(path) if path.starts_with(&root) => path,
                    _ => continue,
                };
                let metadata = std::fs::metadata(path)?;
                entries.push(HostingFile {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    directory: metadata.is_dir(),
                    bytes: metadata.len(),
                });
            }
            entries.sort_by_key(|entry| (!entry.directory, entry.name.to_lowercase()));
            Ok(HostingFiles { entries, truncated })
        })
        .await?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn import_is_metadata_only_and_remove_preserves_files() {
        let source = tempfile::tempdir().unwrap();
        test_server_jar(&source.path().join("paper-test.jar"));
        std::fs::write(
            source.path().join("server.properties"),
            "server-port=25565\nmotd=Original\nrcon.password=private",
        )
        .unwrap();
        let data = tempfile::tempdir().unwrap();
        let engine = Engine::new(data.path().into(), |_| {}).await.unwrap();
        let scan = inspect(source.path()).unwrap();
        let added = engine
            .hosting_import(source.path().into(), vec![scan.candidates[0].id.clone()])
            .await
            .unwrap();
        assert_eq!(added.len(), 1);
        let files = engine.hosting_files(&added[0].id, ".").await.unwrap();
        assert!(files
            .entries
            .iter()
            .any(|entry| entry.name == "paper-test.jar" && !entry.directory));
        assert!(engine.hosting_files(&added[0].id, "../").await.is_err());
        assert!(!source.path().join("eula.txt").exists());
        assert!(engine
            .hosting_import(source.path().into(), vec![scan.candidates[0].id.clone()])
            .await
            .unwrap()
            .is_empty());
        engine.hosting_remove(&added[0].id).await.unwrap();
        assert!(source.path().join("paper-test.jar").exists());
        assert!(engine.hosting_profiles().await.unwrap().is_empty());
    }
    #[test]
    fn confines_files_and_rejects_traversal() {
        let root = tempfile::tempdir().unwrap();
        assert!(confined(root.path(), "../outside").is_err());
        assert!(confined(root.path(), "C:/Windows").is_err());
        assert!(confined(root.path(), ".").is_ok());
    }
    #[tokio::test]
    async fn corrupt_hosting_metadata_is_preserved() {
        let root = tempfile::tempdir().unwrap();
        let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
        std::fs::create_dir(root.path().join("hosting")).unwrap();
        std::fs::write(root.path().join("hosting/profiles.json"), "not json").unwrap();
        assert!(engine.hosting_profiles().await.is_err());
        assert!(engine.hosting_remove("unknown").await.is_err());
        assert_eq!(
            std::fs::read_to_string(root.path().join("hosting/profiles.json")).unwrap(),
            "not json"
        );
    }
}
