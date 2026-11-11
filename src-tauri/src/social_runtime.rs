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

#[cfg(aurum_offline_social)]
const BUNDLED_SOCIAL: &[&[u8]] = &[
    include_bytes!("../social-runtime/aurum-social-worker.exe.gz"),
    include_bytes!("../social-runtime/aurum-social-firewall.exe.gz"),
];

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
    activation: Mutex<()>,
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
            activation: Mutex::new(()),
            download: tokio::sync::Mutex::new(()),
            cancel: AtomicBool::new(false),
            state: Mutex::new(Status::default()),
        })
    }

    pub fn worker(&self, app: &tauri::AppHandle) -> anyhow::Result<Option<PathBuf>> {
        let _guard = self
            .activation
            .lock()
            .map_err(|_| anyhow::anyhow!("Social component state unavailable"))?;
        if let Some(worker) = self.manifest.in_directory(&self.root.join("client"))? {
            return Ok(Some(worker));
        }
        if let Some(worker) = self.manifest.installed(&self.root)? {
            return self
                .manifest
                .activate(worker.parent().unwrap(), &self.root)
                .map(Some);
        }
        // Supports an integrity-checked offline QA package, and matching legacy installs.
        let source = app.path().resource_dir()?.join("social");
        if self.manifest.in_directory(&source)?.is_some() {
            return self.manifest.activate(&source, &self.root).map(Some);
        }
        #[cfg(aurum_offline_social)]
        {
            let worker = self.manifest.install_bundled(&self.root, BUNDLED_SOCIAL)?;
            self.manifest
                .activate(worker.parent().unwrap(), &self.root)
                .map(Some)
        }
        #[cfg(not(aurum_offline_social))]
        Ok(None)
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

#[cfg(all(test, aurum_offline_social))]
mod tests {
    use super::*;

    #[test]
    fn standalone_build_contains_the_exact_pinned_social_runtime() {
        let manifest = Manifest::decode(include_str!("../social-runtime/manifest.json")).unwrap();
        let test_root =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.test-data/social-runtime");
        std::fs::create_dir_all(&test_root).unwrap();
        let root = tempfile::tempdir_in(test_root).unwrap();
        let worker = manifest
            .install_bundled(root.path(), BUNDLED_SOCIAL)
            .unwrap();
        let active = manifest
            .activate(worker.parent().unwrap(), root.path())
            .unwrap();
        assert_eq!(
            active,
            root.path()
                .join("client")
                .join(aurum_core::social_runtime::WORKER)
        );
        assert!(manifest
            .in_directory(active.parent().unwrap())
            .unwrap()
            .is_some());
    }
}
