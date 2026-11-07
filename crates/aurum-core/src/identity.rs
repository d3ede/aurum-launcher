//! Read the previous installation identity only while upgrading existing data.
use anyhow::{bail, Result};
use std::path::{Path, PathBuf};

pub const APPLICATION_ID: &str = "app.aurum.launcher";
pub const LEGACY_APPLICATION_ID: &str = "app.auren.launcher";

pub fn same_application(left: &str, right: &str) -> bool {
    left == right
        || [left, right]
            .iter()
            .all(|id| [APPLICATION_ID, LEGACY_APPLICATION_ID].contains(id))
}

pub fn upgrade_location(selected: PathBuf, current_default: &Path) -> PathBuf {
    if current_default.parent() == selected.parent()
        && selected.file_name().is_some_and(|name| name == LEGACY_APPLICATION_ID)
    {
        current_default.to_owned()
    } else {
        selected
    }
}

/// Rename only within a known OS application-data parent. Never overwrite data.
pub fn migrate_directory(parent: &Path) -> Result<()> {
    let source = parent.join(LEGACY_APPLICATION_ID);
    if !source.try_exists()? {
        return Ok(());
    }
    let target = parent.join(APPLICATION_ID);
    for path in [&source, &target] {
        if path.try_exists()? {
            for entry in walkdir::WalkDir::new(path).follow_links(false) {
                let entry = entry?;
                if entry.file_type().is_symlink()
                    || !std::fs::canonicalize(entry.path())?
                        .starts_with(std::fs::canonicalize(path)?)
                {
                    bail!("Linked application data cannot be migrated automatically");
                }
            }
        }
    }
    if target.try_exists()? {
        if std::fs::read_dir(&target)?.next().is_some() {
            bail!("Both application identities contain data; existing files were preserved");
        }
        std::fs::remove_dir(&target)?;
    }
    std::fs::rename(source, target)?;
    Ok(())
}

pub fn migrate_user_directories() -> Result<()> {
    let mut parents = vec![];
    for parent in [dirs::config_dir(), dirs::data_dir(), dirs::data_local_dir()]
        .into_iter()
        .flatten()
    {
        if !parents.contains(&parent) {
            migrate_directory(&parent)?;
            parents.push(parent);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrade_preserves_data_and_refuses_conflicting_installations() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data");
        std::fs::create_dir_all(&base).unwrap();
        let root = tempfile::tempdir_in(base).unwrap();
        let old = root.path().join(LEGACY_APPLICATION_ID);
        let new = root.path().join(APPLICATION_ID);
        std::fs::create_dir_all(old.join("secrets")).unwrap();
        std::fs::write(old.join("secrets/session.bin"), b"encrypted-fixture").unwrap();
        migrate_directory(root.path()).unwrap();
        migrate_directory(root.path()).unwrap();
        assert!(!old.exists());
        assert_eq!(std::fs::read(new.join("secrets/session.bin")).unwrap(), b"encrypted-fixture");
        std::fs::create_dir(&old).unwrap();
        std::fs::write(old.join("data-location.json"), b"custom-location").unwrap();
        assert!(migrate_directory(root.path()).is_err());
        assert_eq!(std::fs::read(old.join("data-location.json")).unwrap(), b"custom-location");
        assert!(same_application(LEGACY_APPLICATION_ID, APPLICATION_ID));
        assert!(!same_application(APPLICATION_ID, "test.other.launcher"));
        assert_eq!(upgrade_location(old, &new), new);
        let custom = root.path().join("custom").join(LEGACY_APPLICATION_ID);
        assert_eq!(upgrade_location(custom.clone(), &new), custom);
    }
}
