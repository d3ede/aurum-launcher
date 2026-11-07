//! Separate application state from shared game data without changing account identity.
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

pub const GAMES: &str = "Game Files";
pub const LAUNCHER: &str = "Launcher";
pub const GAME_DIRECTORIES: &[&str] = &[
    "instances",
    "assets",
    "libraries",
    "versions",
    "runtimes",
    "hosting",
    "horizon",
    "downloads",
    "staging",
    "trash",
    "installers",
];
pub const APP_ENTRIES: &[&str] = &[
    "state.json",
    "state.json.tmp",
    "skin-library.json",
    "recent-servers.json",
    "instance-move.json",
    "cache",
    "logs",
    "social",
    "skins",
];

pub fn application(root: &Path) -> PathBuf {
    if root.file_name().is_some_and(|n| n == GAMES) {
        root.parent().unwrap_or(root).join(LAUNCHER).join("data")
    } else {
        root.to_owned()
    }
}

pub fn app_path(root: &Path, name: &str) -> PathBuf {
    application(root).join(name)
}

/// Move the existing UI profile, including preferences; tokens live in the unchanged OS vault.
pub fn relocate_webview(local: &Path, root: &Path) -> Result<()> {
    let old = local.join("EBWebView");
    let target = application(root)
        .parent()
        .unwrap()
        .join("webview/EBWebView");
    if !old.exists() || target.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(target.parent().unwrap())?;
    if std::fs::rename(&old, &target).is_ok() {
        return Ok(());
    }
    // Cross-volume data homes use a staged copy. Keep the original until every copy succeeds.
    let stage = target.with_extension("moving");
    if stage.exists() {
        bail!("Незавершён перенос настроек интерфейса; исходные данные сохранены")
    }
    let _stage = crate::temporary::Temporary::directory(&stage);
    for entry in walkdir::WalkDir::new(&old).follow_links(false) {
        let entry = entry?;
        if entry.file_type().is_symlink() {
            bail!("Связанные файлы интерфейса сохранены")
        }
        let destination = stage.join(entry.path().strip_prefix(&old)?);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(destination)?;
        } else {
            std::fs::copy(entry.path(), destination)?;
        }
    }
    std::fs::rename(&stage, &target)?;
    std::fs::remove_dir_all(old)?;
    Ok(())
}

/// Resumable, same-volume renames. Unknown files and executable files are never moved here.
pub fn prepare(home: &Path) -> Result<PathBuf> {
    if home.file_name().is_some_and(|n| n == GAMES) {
        std::fs::create_dir_all(application(home))?;
        return Ok(home.to_owned());
    }
    if home.join("instance-move.json").exists() {
        bail!("Перезапустите прежнюю версию Aurum для завершения переноса сборки")
    }
    let games = home.join(GAMES);
    let app = application(&games);
    let journal = app.join("layout-migration.json");
    if home.join("instances").is_dir() {
        let paths = std::fs::read_dir(home.join("instances"))?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .collect();
        if crate::processes::directories_running(paths) {
            bail!("Закройте Minecraft перед обновлением структуры папок")
        }
    }
    // Check every source before moving anything; do not merge ambiguous data trees.
    for (entries, destination) in [(GAME_DIRECTORIES, &games), (APP_ENTRIES, &app)] {
        for name in entries {
            let source = home.join(name);
            if source.exists() && destination.join(name).exists() {
                bail!(
                    "Две папки содержат {}. Данные сохранены; объедините их вручную",
                    name
                )
            }
            if source
                .symlink_metadata()
                .is_ok_and(|m| m.file_type().is_symlink())
            {
                bail!("Перенос связанной папки остановлен: {}", source.display())
            }
        }
    }
    std::fs::create_dir_all(&games)?;
    std::fs::create_dir_all(&app)?;
    std::fs::write(&journal, serde_json::to_vec(&home)?)?;
    for (entries, destination) in [(GAME_DIRECTORIES, &games), (APP_ENTRIES, &app)] {
        for name in entries {
            let source = home.join(name);
            if source.exists() {
                std::fs::rename(&source, destination.join(name))
                    .with_context(|| format!("Не удалось перенести {}", source.display()))?;
            }
        }
    }
    let owner = home.join(".aurum-data-owner");
    if owner.exists() && !games.join(".aurum-data-owner").exists() {
        std::fs::rename(owner, games.join(".aurum-data-owner"))?;
    }
    // Explicit Java paths inside the old game root must follow the move.
    let state = app.join("state.json");
    if state.exists() {
        let mut db: crate::model::Database = serde_json::from_slice(&std::fs::read(&state)?)?;
        let java = Path::new(&db.settings.java_path);
        if let Ok(relative) = java.strip_prefix(home) {
            db.settings.java_path = games.join(relative).to_string_lossy().into();
            std::fs::write(&state, serde_json::to_vec_pretty(&db)?)?;
        }
    }
    let hosting = games.join("hosting/profiles.json");
    if hosting.exists() {
        let mut profiles: serde_json::Value = serde_json::from_slice(&std::fs::read(&hosting)?)?;
        if let Some(profiles) = profiles.as_array_mut() {
            for profile in profiles {
                if let Some(old) = profile["root"].as_str() {
                    let old = Path::new(old);
                    if !old.starts_with(&games) {
                        if let Ok(relative) = old.strip_prefix(home) {
                            profile["root"] =
                                games.join(relative).to_string_lossy().into_owned().into();
                        }
                    }
                }
            }
        }
        std::fs::write(hosting, serde_json::to_vec_pretty(&profiles)?)?;
    }
    std::fs::remove_file(journal)?;
    Ok(games)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_preserves_worlds_state_and_unknown_files_and_can_repeat() {
        let home = {
            let test_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../.test-data/storage-maintenance");
            std::fs::create_dir_all(&test_root).unwrap();
            tempfile::tempdir_in(test_root).unwrap()
        };
        std::fs::create_dir_all(home.path().join("instances/world/saves")).unwrap();
        std::fs::write(
            home.path().join("instances/world/saves/level.dat"),
            b"world",
        )
        .unwrap();
        std::fs::write(
            home.path().join("state.json"),
            serde_json::to_vec(&crate::model::Database::default()).unwrap(),
        )
        .unwrap();
        std::fs::write(home.path().join("unrelated.txt"), b"keep").unwrap();
        let games = prepare(home.path()).unwrap();
        assert_eq!(
            std::fs::read(games.join("instances/world/saves/level.dat")).unwrap(),
            b"world"
        );
        assert!(app_path(&games, "state.json").is_file());
        assert!(home.path().join("unrelated.txt").exists());
        assert_eq!(prepare(home.path()).unwrap(), games);
    }
}
