pub mod auth;
pub mod catalog;
pub mod content;
pub mod minecraft;
pub mod model;
pub mod net;
pub mod packs;
pub mod store;

use anyhow::{bail, Context, Result};
use model::*;
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Engine {
    pub root: PathBuf,
    pub http: reqwest::Client,
    pub db: Arc<Mutex<Database>>,
    pub busy: Arc<Mutex<()>>,
    pub operations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub running: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
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
            phase: phase.into(),
            message: message.into(),
            done,
            total,
        });
    }
}
impl Engine {
    pub async fn new(root: PathBuf, emit: impl Fn(Event) + Send + Sync + 'static) -> Result<Self> {
        tokio::fs::create_dir_all(&root).await?;
        let db = if root.join("state.json").exists() {
            serde_json::from_slice(&tokio::fs::read(root.join("state.json")).await?)
                .context("Не удалось прочитать state.json; файл сохранён для восстановления")?
        } else {
            Database::default()
        };
        let http = reqwest::Client::builder()
            .user_agent("Auren/0.1.0 (independent desktop Minecraft launcher)")
            .connect_timeout(std::time::Duration::from_secs(20))
            .timeout(std::time::Duration::from_secs(180))
            .https_only(true)
            .build()?;
        Ok(Self {
            root,
            http,
            db: Arc::new(Mutex::new(db)),
            busy: Arc::new(Mutex::new(())),
            operations: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(HashMap::new())),
            emit: Arc::new(emit),
        })
    }
    pub async fn snapshot(&self) -> Snapshot {
        Snapshot {
            database: self.db.lock().await.clone(),
            data_dir: self.root.to_string_lossy().into(),
            running: self.running.lock().await.keys().cloned().collect(),
            curseforge_configured: auth::secret("curseforge").is_ok(),
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
        Ok(self.root.join("instances").join(id))
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
        if self.running.lock().await.contains_key(id) {
            bail!("Сначала остановите игру")
        }
        if self.operations.lock().await.len() > 0 {
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
