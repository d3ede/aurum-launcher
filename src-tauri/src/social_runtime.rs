use aurum_core::social_runtime::Manifest;
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::Manager;

pub fn cleanup(identifier: &str) -> anyhow::Result<()> {
    // Installer QA uses a separate identity and must not touch production rules.
    if identifier == "app.aurum.launcher" {
        aurum_social::firewall::request_cleanup()?;
    }
    let local = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| anyhow::anyhow!("Missing local app data directory"))?;
    let root = PathBuf::from(local).join(identifier).join("social-runtime");
    if root.is_dir() {
        std::fs::remove_dir_all(root)?;
    }
    Ok(())
}

pub struct Runtime {
    root: PathBuf,
    manifest: Manifest,
    download: tokio::sync::Mutex<()>,
    cancel: AtomicBool,
    state: Mutex<Status>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    installed: bool,
    downloading: bool,
    done: u64,
    total: u64,
}

impl Runtime {
    pub fn new(app: &tauri::AppHandle) -> anyhow::Result<Self> {
        Ok(Self {
            root: app.path().app_local_data_dir()?.join("social-runtime"),
            manifest: Manifest::decode(include_str!("../social-runtime/manifest.json"))?,
            download: tokio::sync::Mutex::new(()),
            cancel: AtomicBool::new(false),
            state: Mutex::new(Status::default()),
        })
    }

    pub fn worker(&self, app: &tauri::AppHandle) -> anyhow::Result<Option<PathBuf>> {
        if let Some(worker) = self.manifest.installed(&self.root)? {
            return Ok(Some(worker));
        }
        #[cfg(debug_assertions)]
        {
            let directory = std::env::current_exe()?.parent().map(PathBuf::from);
            if let Some(directory) = directory {
                let worker = directory.join(aurum_core::social_runtime::WORKER);
                if worker.is_file()
                    && directory
                        .join(aurum_core::social_runtime::FIREWALL)
                        .is_file()
                {
                    return Ok(Some(worker));
                }
            }
        }
        // Supports an integrity-checked offline QA package, and matching legacy installs.
        self.manifest
            .in_directory(&app.path().resource_dir()?.join("social"))
    }

    pub fn status(&self, app: &tauri::AppHandle) -> anyhow::Result<Status> {
        let mut status = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("Social component state unavailable"))?
            .clone();
        if !status.downloading {
            status.installed = self.worker(app)?.is_some();
        }
        Ok(status)
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Release);
    }

    pub async fn install(
        &self,
        app: &tauri::AppHandle,
        http: &reqwest::Client,
    ) -> anyhow::Result<()> {
        let _guard = self
            .download
            .try_lock()
            .map_err(|_| anyhow::anyhow!("Social component download already in progress"))?;
        if self.worker(app)?.is_some() {
            return Ok(());
        }
        self.cancel.store(false, Ordering::Release);
        let update = |downloading, done, total| {
            if let Ok(mut state) = self.state.lock() {
                *state = Status {
                    installed: false,
                    downloading,
                    done,
                    total,
                };
            }
        };
        update(true, 0, 0);
        let result = self
            .manifest
            .install(http, &self.root, &self.cancel, |done, total| {
                update(true, done, total)
            })
            .await;
        update(false, 0, 0);
        result.map(|_| ())
    }
}
