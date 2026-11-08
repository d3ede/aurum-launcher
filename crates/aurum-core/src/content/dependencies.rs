use super::compatible;
use crate::{catalog::mr_version, model::*};
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{future::Future, path::Path};

/// Reuse an installed mod for a project dependency, or for a pin targeting a
/// different Minecraft/loader. Valid exact pins remain authoritative.
pub(super) async fn reusable_modrinth_dependency<F, Fut>(
    profile: &Profile,
    instance: &Path,
    installed: &[Content],
    dependency: &Value,
    pinned: Option<&Value>,
    mut fetch_version: F,
) -> Result<Option<(String, String)>>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    let project = dependency["project_id"]
        .as_str()
        .or_else(|| pinned.and_then(|v| v["project_id"].as_str()));
    let Some(project) = project else {
        return Ok(None);
    };
    if let Some(pinned) = pinned {
        if pinned["project_id"].as_str() != Some(project) {
            bail!("Версия относится к другому проекту");
        }
        if compatible(&mr_version(pinned), profile, "mod") {
            return Ok(None);
        }
    }
    for item in installed.iter().filter(|item| {
        item.enabled
            && item.kind == "mod"
            && item.source == "modrinth"
            && item.project_id == project
            && !item.version_id.is_empty()
    }) {
        let path = crate::safe_join(&instance.join("mods"), &item.filename)?;
        if !path.is_file() {
            continue;
        }
        let raw = fetch_version(item.version_id.clone()).await?;
        if raw["project_id"].as_str() != Some(project)
            || raw["id"].as_str() != Some(item.version_id.as_str())
            || !compatible(&mr_version(&raw), profile, "mod")
        {
            continue;
        }
        let files = raw["files"].as_array().context("Нет файлов версии")?;
        for file in files {
            if file["filename"].as_str() != Some(item.filename.as_str()) {
                continue;
            }
            let Some(hash) = file["hashes"]["sha1"].as_str().filter(|s| !s.is_empty()) else {
                continue;
            };
            if crate::net::verify(&path, Some(("sha1", hash))).await? {
                return Ok(Some((project.into(), item.version_id.clone())));
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests;
