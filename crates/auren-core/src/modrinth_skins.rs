//! Read saved Modrinth skins, never Minecraft's unrelated texture cache or credentials.
use crate::{
    modrinth_import::open_database,
    skins::{encode_texture, validate_texture},
};
use anyhow::Result;
use serde::Serialize;
use std::{collections::HashSet, path::PathBuf};

pub struct ImportedSkin {
    pub model: String,
    pub texture: String,
}

#[derive(Default, Serialize)]
pub struct ModrinthSkinImportResult {
    pub imported: usize,
    pub duplicates: usize,
    pub invalid: usize,
    /// Paths whose databases could not be read; the UI supplies a localized explanation.
    pub warnings: Vec<String>,
}

#[derive(Default)]
pub struct ModrinthSkinScan {
    pub skins: Vec<ImportedSkin>,
    pub invalid: usize,
    pub warnings: Vec<String>,
}

pub fn scan(roots: &[PathBuf]) -> ModrinthSkinScan {
    let mut scan = ModrinthSkinScan::default();
    let mut seen = HashSet::new();
    for root in roots {
        let root = if root.file_name().is_some_and(|n| n == "profiles") {
            root.parent().unwrap_or(root).to_path_buf()
        } else {
            root.clone()
        };
        let database = root.join("app.db");
        if !database.is_file() {
            continue;
        }
        let canonical = database.canonicalize().unwrap_or(database.clone());
        if !seen.insert(canonical) {
            continue;
        }
        // Keep each database's snapshot together. A failed query must not leak partial rows.
        let read = || -> Result<ModrinthSkinScan> {
            let db = open_database(&root)?;
            let has_skins: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_minecraft_skins')",
                [],
                |r| r.get(0),
            )?;
            if !has_skins {
                return Ok(ModrinthSkinScan::default());
            }
            let mut statement = db.prepare(
                "SELECT s.variant, CASE WHEN length(t.texture) <= 1000000 THEN t.texture END
                 FROM custom_minecraft_skins s
                 LEFT JOIN custom_minecraft_skin_textures t ON t.texture_key = s.texture_key
                 ORDER BY s.texture_key, s.variant",
            )?;
            let mut rows = statement.query([])?;
            let mut result = ModrinthSkinScan::default();
            while let Some(row) = rows.next()? {
                let parsed = || -> Result<ImportedSkin> {
                    let variant: String = row.get(0)?;
                    let model = match variant.as_str() {
                        "CLASSIC" => "steve",
                        "SLIM" => "alex",
                        _ => anyhow::bail!("Unknown skin model"),
                    };
                    let bytes: Vec<u8> = row.get(1)?;
                    Ok(ImportedSkin {
                        model: model.into(),
                        texture: encode_texture(&validate_texture(&bytes, false)?),
                    })
                };
                match parsed() {
                    Ok(skin) => result.skins.push(skin),
                    Err(_) => result.invalid += 1,
                }
            }
            Ok(result)
        };
        match read() {
            Ok(result) => {
                scan.skins.extend(result.skins);
                scan.invalid += result.invalid;
            }
            Err(_) => scan.warnings.push(database.to_string_lossy().into_owned()),
        }
    }
    scan
}
