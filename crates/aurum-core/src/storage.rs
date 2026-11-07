//! Delete only launcher-owned data, following an explicit uninstall choice.
use anyhow::{bail, Context, Result};
use std::path::Path;

const DIRECTORIES: &[&str] = &[
    "instances",
    "assets",
    "libraries",
    "versions",
    "runtimes",
    "cache",
    "staging",
    "downloads",
    "trash",
    "hosting",
    "skins",
    "horizon",
    "installers",
    "logs",
    "social",
];
const FILES: &[&str] = &[
    "launcher_profiles.json",
    "state.json",
    "skin-library.json",
    "recent-servers.json",
    "instance-move.json",
    ".aurum-data-owner",
];

pub fn register_owner(root: &Path, identifier: &str) -> Result<()> {
    std::fs::write(root.join(".aurum-data-owner"), identifier)?;
    let app = crate::layout::application(root);
    std::fs::create_dir_all(&app)?;
    std::fs::write(app.join(".aurum-data-owner"), identifier)?;
    Ok(())
}

pub fn remove_owned_data(root: &Path, identifier: &str) -> Result<()> {
    let root = std::fs::canonicalize(root)?;
    if root.parent().is_none()
        || std::fs::read_to_string(root.join(".aurum-data-owner"))? != identifier
    {
        bail!("Папка не принадлежит этой установке Aurum")
    }
    let state = crate::layout::app_path(&root, "state.json");
    if state.exists() {
        let _: crate::model::Database = serde_json::from_slice(&std::fs::read(state)?)
            .context("Не удалось проверить данные Aurum; удалите их вручную")?;
    }
    let application = crate::layout::application(&root);
    let mut application_targets = vec![];
    if application != root
        && std::fs::read_to_string(application.join(".aurum-data-owner")).is_ok_and(|value| value == identifier)
    {
        let launcher = application.parent().context("Нет папки лаунчера")?;
        for path in [application.clone(), launcher.join("webview")] {
            if !path.exists() { continue; }
            for entry in walkdir::WalkDir::new(&path).follow_links(false) {
                let entry = entry?;
                if entry.file_type().is_symlink() || !std::fs::canonicalize(entry.path())?.starts_with(std::fs::canonicalize(launcher)?) {
                    bail!("Связанная папка приложения сохранена")
                }
            }
            application_targets.push(path);
        }
    }
    // Validate every target before making any change. Linked folders are never traversed.
    for name in DIRECTORIES.iter().chain(FILES.iter()) {
        let path = root.join(name);
        if !path.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&path).follow_links(false) {
            let entry = entry?;
            if entry.file_type().is_symlink()
                || !std::fs::canonicalize(entry.path())?.starts_with(&root)
            {
                bail!(
                    "В данных есть ссылка; папка сохранена: {}",
                    entry.path().display()
                )
            }
        }
    }
    let game_dirs = std::fs::read_dir(root.join("instances"))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .collect();
    if crate::processes::directories_running(game_dirs) {
        bail!("Сначала закройте Minecraft")
    }
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing()
            .with_exe(sysinfo::UpdateKind::Always)
            .with_cwd(sysinfo::UpdateKind::Always),
    );
    if system.processes().iter().any(|(pid, process)| {
        pid.as_u32() != std::process::id()
            && [process.exe(), process.cwd()]
                .into_iter()
                .flatten()
                .any(|path| std::fs::canonicalize(path).is_ok_and(|p| p.starts_with(&root)))
    }) {
        bail!("Сначала закройте игры и локальные серверы, использующие данные Aurum")
    }
    for name in DIRECTORIES {
        let path = root.join(name);
        if path.is_dir() {
            std::fs::remove_dir_all(path)?;
        }
    }
    for name in FILES {
        let path = root.join(name);
        if path.is_file() {
            std::fs::remove_file(path)?;
        }
    }
    for path in application_targets { std::fs::remove_dir_all(path)?; }
    // Keep the root if application files or unrelated files are still present.
    let _ = std::fs::remove_dir(root);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> tempfile::TempDir {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/storage");
        std::fs::create_dir_all(&root).unwrap();
        tempfile::tempdir_in(root).unwrap()
    }
    #[test]
    fn explicit_cleanup_preserves_unrelated_files_and_rejects_wrong_owner() {
        let temp = fixture();
        let root = temp.path();
        std::fs::create_dir(root.join("instances")).unwrap();
        std::fs::write(root.join("instances/world"), b"world").unwrap();
        std::fs::write(root.join("keep.txt"), b"unrelated").unwrap();
        register_owner(root, "qa").unwrap();
        assert!(remove_owned_data(root, "other").is_err());
        assert!(root.join("instances/world").exists());
        remove_owned_data(root, "qa").unwrap();
        assert!(!root.join("instances").exists());
        assert!(root.join("keep.txt").exists());
    }
}
