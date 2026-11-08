use super::compatible;
use crate::{
    catalog::{cf_version, mr_version},
    model::*,
};
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
    fetch_version: F,
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
    reusable_installed_dependency(
        profile,
        instance,
        installed,
        "modrinth",
        project,
        fetch_version,
    )
    .await
}

pub(super) async fn reusable_installed_dependency<F, Fut>(
    profile: &Profile,
    instance: &Path,
    installed: &[Content],
    source: &str,
    project: &str,
    mut fetch_version: F,
) -> Result<Option<(String, String)>>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    for item in installed.iter().filter(|item| {
        item.enabled
            && item.kind == "mod"
            && item.source == source
            && item.project_id == project
            && !item.version_id.is_empty()
    }) {
        let path = crate::safe_join(&instance.join("mods"), &item.filename)?;
        if !path.is_file() {
            continue;
        }
        let raw = fetch_version(item.version_id.clone()).await?;
        let (version, actual_project) = match source {
            "modrinth" => (
                mr_version(&raw),
                raw["project_id"].as_str().unwrap_or_default().to_string(),
            ),
            "curseforge" => (cf_version(&raw), raw["modId"].to_string()),
            _ => continue,
        };
        if actual_project != project
            || version.id != item.version_id
            || !compatible(&version, profile, "mod")
        {
            continue;
        }
        let files = if source == "modrinth" {
            raw["files"]
                .as_array()
                .context("Нет файлов версии")?
                .iter()
                .collect::<Vec<_>>()
        } else {
            vec![&raw]
        };
        for file in files {
            let (filename, hash) = if source == "modrinth" {
                (file["filename"].as_str(), file["hashes"]["sha1"].as_str())
            } else {
                (
                    file["fileName"].as_str(),
                    file["hashes"]
                        .as_array()
                        .and_then(|hashes| hashes.iter().find(|h| h["algo"] == 1))
                        .and_then(|h| h["value"].as_str()),
                )
            };
            if filename != Some(item.filename.as_str()) {
                continue;
            }
            let Some(hash) = hash.filter(|s| !s.is_empty()) else {
                continue;
            };
            if crate::net::verify(&path, Some(("sha1", hash))).await? {
                return Ok(Some((project.into(), item.version_id.clone())));
            }
        }
    }
    Ok(None)
}

pub(super) fn unavailable_dependency(
    source: &str,
    parent: &str,
    project: &str,
    title: Option<&str>,
    profile: &Profile,
) -> anyhow::Error {
    let dependency = title
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(project);
    let (catalog, url) = if source == "curseforge" {
        (
            "CurseForge",
            format!("https://www.curseforge.com/projects/{project}"),
        )
    } else {
        (
            "Modrinth",
            format!("https://modrinth.com/project/{project}"),
        )
    };
    let loader = match profile.loader {
        Loader::Forge => "Forge",
        Loader::Fabric => "Fabric",
        Loader::Neoforge => "NeoForge",
        Loader::Quilt => "Quilt",
        Loader::Vanilla => "Vanilla",
    };
    anyhow::anyhow!("Не удалось установить «{parent}»: нужна зависимость «{dependency}», но в {catalog} нет версии для Minecraft {} / {loader}.\nВыберите другую версию аддона или проверьте требования зависимости: {url}", profile.minecraft)
}

#[cfg(test)]
mod tests;
