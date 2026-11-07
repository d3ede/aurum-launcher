use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Default, Serialize, Deserialize)]
struct DataRoots {
    identifier: String,
    roots: Vec<PathBuf>,
}
fn manifest() -> Result<PathBuf> {
    Ok(std::env::current_exe()?
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Нет папки программы"))?
        .join("aurum-data-roots.json"))
}
pub fn register(root: &Path, identifier: &str) -> Result<()> {
    let path = manifest()?;
    // Development/portable executables must not claim an installed user's data.
    if !path.parent().unwrap().join("uninstall.exe").is_file() {
        return Ok(());
    }
    let mut data: DataRoots = if path.exists() {
        serde_json::from_slice(&std::fs::read(&path)?)?
    } else {
        DataRoots {
            identifier: identifier.into(),
            roots: vec![],
        }
    };
    if data.identifier != identifier {
        bail!("Папка установки принадлежит другому приложению")
    }
    let root = dunce::canonicalize(root)?;
    auren_core::storage::register_owner(&root, identifier)?;
    // A migrated home is now the parent of Game Files, not an independent owned root.
    data.roots.retain(|previous| {
        previous.exists()
            && !(root.file_name().is_some_and(|name| name == auren_core::layout::GAMES)
                && root.parent() == Some(previous.as_path())
                && !previous.join(".aurum-data-owner").exists())
    });
    if !data.roots.contains(&root) {
        data.roots.push(root);
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec_pretty(&data)?)?;
    std::fs::rename(temp, path)?;
    Ok(())
}

pub fn command() -> Option<i32> {
    let args: Vec<_> = std::env::args().collect();
    let action = args.get(1)?.as_str();
    if ![
        "--uninstall-data-list",
        "--uninstall-data",
        "--register-data",
    ]
    .contains(&action)
    {
        return None;
    }
    let result = (|| -> Result<()> {
        let identifier = args
            .get(2)
            .ok_or_else(|| anyhow::anyhow!("Нет идентификатора"))?;
        if action == "--register-data" {
            let root = PathBuf::from(args.get(3).ok_or_else(|| anyhow::anyhow!("Нет папки"))?);
            let _: auren_core::model::Database =
                serde_json::from_slice(&std::fs::read(auren_core::layout::app_path(&root, "state.json"))?)?;
            return register(&root, identifier);
        }
        let path = manifest()?;
        let data: DataRoots = if path.exists() {
            serde_json::from_slice(&std::fs::read(&path)?)?
        } else {
            DataRoots {
                identifier: identifier.clone(),
                roots: vec![],
            }
        };
        if data.identifier != *identifier {
            bail!("Не совпадает установка")
        }
        if action == "--uninstall-data-list" {
            let output = args
                .get(3)
                .ok_or_else(|| anyhow::anyhow!("Нет файла списка"))?;
            let text = data
                .roots
                .iter()
                .map(|p| p.to_string_lossy())
                .collect::<Vec<_>>()
                .join("\r\n");
            let bytes: Vec<u8> = std::iter::once(0xfeffu16)
                .chain(text.encode_utf16())
                .flat_map(u16::to_le_bytes)
                .collect();
            std::fs::write(output, bytes)?;
        } else {
            let mut account_ids = std::collections::HashSet::new();
            if identifier == "app.auren.launcher" {
                for root in &data.roots {
                    if let Ok(bytes) = std::fs::read(auren_core::layout::app_path(root, "state.json")) {
                        if let Ok(db) =
                            serde_json::from_slice::<auren_core::model::Database>(&bytes)
                        {
                            account_ids.extend(
                                db.accounts
                                    .into_iter()
                                    .filter(|a| a.kind == "microsoft")
                                    .map(|a| a.id),
                            );
                        }
                    }
                }
            }
            for root in data.roots.iter().filter(|p| p.exists()) {
                auren_core::storage::remove_owned_data(root, identifier)?;
            }
            if identifier == "app.auren.launcher" {
                for id in account_ids {
                    let _ = auren_core::auth::delete_secret(&id);
                }
                let _ = auren_core::auth::delete_secret("curseforge");
            }
        }
        Ok(())
    })();
    Some(if result.is_ok() { 0 } else { 1 })
}
