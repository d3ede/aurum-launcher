pub mod auth;
pub mod catalog;
pub mod content;
pub mod content_metadata;
mod directories;
pub mod hosting;
mod launch_cache;
pub use directories::default_data_directory;
pub mod microsoft_oauth;
pub mod migration;
pub mod minecraft;
pub mod model;
pub mod modrinth_import;
pub mod modrinth_skins;
pub mod net;
pub mod pack_catalog;
pub mod packs;
pub mod platform_packs;
mod processes;
mod secret_store;
pub mod servers;
pub mod skins;
pub mod store;

use anyhow::{bail, Context, Result};
use model::*;
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Engine {
    pub root: PathBuf,
    pub http: reqwest::Client,
    pub db: Arc<Mutex<Database>>,
    pub(crate) instance_directories: Arc<RwLock<HashMap<String, String>>>,
    pub busy: Arc<Mutex<()>>,
    pub operations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub running: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub(crate) catalog_cache: Arc<Mutex<HashMap<String, (std::time::Instant, serde_json::Value)>>>,
    pub(crate) catalog_index_lock: Arc<Mutex<()>>,
    pub(crate) avatar_lock: Arc<Mutex<()>>,
    pub(crate) java_versions: Arc<Mutex<launch_cache::JavaVersionCache>>,
    pub(crate) servers: Arc<servers::ServerState>,
    pub(crate) hosting: Arc<hosting::HostingState>,
    pub(crate) recovered: Arc<Mutex<HashMap<String, Vec<processes::RecoveredProcess>>>>,
    pub emit: Arc<dyn Fn(Event) + Send + Sync>,
}
pub struct Task {
    pub id: String,
    pub profile_id: Option<String>,
    pub cancel: Arc<AtomicBool>,
    pub emit: Arc<dyn Fn(Event) + Send + Sync>,
}
impl Task {
    pub fn check(&self) -> Result<()> {
        if self.cancel.load(Ordering::Relaxed) {
            bail!("Операция отменена")
        }
        Ok(())
    }
    pub fn progress(&self, phase: &str, message: impl Into<String>, done: u64, total: u64) {
        (self.emit)(Event {
            id: self.id.clone(),
            profile_id: self.profile_id.clone(),
            pack_name: None,
            phase: phase.into(),
            message: message.into(),
            done,
            total,
        });
    }
    pub fn pack_progress(&self, name: &str, message: impl Into<String>, done: u64, total: u64) {
        (self.emit)(Event {
            id: self.id.clone(),
            profile_id: self.profile_id.clone(),
            pack_name: Some(name.into()),
            phase: "pack".into(),
            message: message.into(),
            done,
            total,
        });
    }
}
impl Engine {
    pub async fn new(root: PathBuf, emit: impl Fn(Event) + Send + Sync + 'static) -> Result<Self> {
        tokio::fs::create_dir_all(&root).await?;
        let mut db: Database = if root.join("state.json").exists() {
            serde_json::from_slice(&tokio::fs::read(root.join("state.json")).await?)
                .context("Не удалось прочитать state.json; файл сохранён для восстановления")?
        } else {
            Database::default()
        };
        directories::recover(&root, &mut db)?;
        directories::validate(&root, &db)?;
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../../package.json"))?;
        let version = package["version"].as_str().unwrap_or("dev");
        let http = reqwest::Client::builder()
            .user_agent(format!(
                "AurumLauncher/{version} (+https://github.com/d3ede/aurum-launcher)"
            ))
            .connect_timeout(std::time::Duration::from_secs(20))
            .timeout(std::time::Duration::from_secs(180))
            .https_only(true)
            .build()?;
        let engine = Self {
            root,
            http,
            instance_directories: Arc::new(RwLock::new(db.instance_directories.clone())),
            db: Arc::new(Mutex::new(db)),
            busy: Arc::new(Mutex::new(())),
            operations: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(HashMap::new())),
            catalog_cache: Arc::new(Mutex::new(HashMap::new())),
            catalog_index_lock: Arc::new(Mutex::new(())),
            avatar_lock: Arc::new(Mutex::new(())),
            java_versions: Arc::new(Mutex::new(HashMap::new())),
            servers: Arc::new(servers::ServerState::default()),
            hosting: Arc::new(hosting::HostingState::default()),
            recovered: Arc::new(Mutex::new(HashMap::new())),
            emit: Arc::new(emit),
        };
        engine.recover_running().await?;
        engine.migrate_instance_directories().await?;
        Ok(engine)
    }
    pub async fn snapshot(&self) -> Snapshot {
        self.refresh_recovered().await;
        Snapshot {
            database: self.db.lock().await.clone(),
            data_dir: self.root.to_string_lossy().into(),
            running: self.running.lock().await.keys().cloned().collect(),
            curseforge_configured: auth::secret("curseforge").is_ok(),
            server_manager: true,
            hosting_support: true,
            hosting_running: self.hosting_running(),
        }
    }
    pub async fn profile(&self, id: &str) -> Result<Profile> {
        self.db
            .lock()
            .await
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .context("Сборка не найдена")
    }
    pub fn instance(&self, id: &str) -> Result<PathBuf> {
        uuid::Uuid::parse_str(id).context("Неверный идентификатор сборки")?;
        if self.root.join("instance-move.json").try_exists()? {
            bail!("Перезапустите лаунчер для завершения переноса профилей")
        }
        let directories = self.instance_directories.read().unwrap();
        directories::instance_path(&self.root, directories.get(id).map_or(id, String::as_str))
    }
    pub async fn task(&self, id: String, profile_id: Option<String>) -> Result<Task> {
        uuid::Uuid::parse_str(&id)?;
        let mut operations = self.operations.lock().await;
        if operations.contains_key(&id) {
            bail!("Операция уже выполняется")
        }
        let cancel = Arc::new(AtomicBool::new(false));
        operations.insert(id.clone(), cancel.clone());
        Ok(Task {
            id,
            profile_id,
            cancel,
            emit: self.emit.clone(),
        })
    }
    pub async fn finish(&self, task: &Task, result: &Result<()>) {
        self.operations.lock().await.remove(&task.id);
        task.progress(
            if result.is_ok() { "complete" } else { "error" },
            match result {
                Ok(_) => "Готово".into(),
                Err(e) => format!("{e:#}"),
            },
            0,
            0,
        );
    }
    pub async fn cancel(&self, id: &str) -> Result<()> {
        self.operations
            .lock()
            .await
            .get(id)
            .context("Операция уже завершена")?
            .store(true, Ordering::Relaxed);
        Ok(())
    }
    pub async fn ensure_idle(&self, id: &str) -> Result<()> {
        self.refresh_recovered().await;
        if self.running.lock().await.contains_key(id) {
            bail!("Сначала остановите игру")
        }
        if !self.operations.lock().await.is_empty() {
            bail!("Дождитесь завершения текущей операции")
        }
        Ok(())
    }
}
pub fn safe_join(root: &Path, value: &str) -> Result<PathBuf> {
    if value.is_empty() || value.contains('\\') || value.contains(':') {
        bail!("Небезопасный путь: {value}")
    }
    let path = Path::new(value);
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        bail!("Небезопасный путь: {value}")
    }
    for part in value.split('/') {
        let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.ends_with(['.', ' '])
            || part
                .chars()
                .any(|c| c.is_control() || "<>\"|?*".contains(c))
            || ["CON", "PRN", "AUX", "NUL"].contains(&base.as_str())
            || (base.len() == 4
                && (base.starts_with("COM") || base.starts_with("LPT"))
                && base.as_bytes()[3].is_ascii_digit())
        {
            bail!("Небезопасное имя файла: {part}")
        }
    }
    Ok(root.join(path))
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
