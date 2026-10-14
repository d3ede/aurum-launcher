use crate::{
    catalog::{cf_version, mr_version, MODRINTH},
    content::compatible,
    model::*,
    store::persist,
    Engine, Task,
};
use anyhow::{Context, Result};
use base64::Engine as _;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::{
    collections::HashMap,
    io::Read,
    path::Path,
    time::{Duration, UNIX_EPOCH},
};

pub fn catalog_info(source: &str, raw: &Value, version: &ProjectVersion) -> ContentInfo {
    ContentInfo {
        version_name: raw[if source == "modrinth" {
            "version_number"
        } else {
            "displayName"
        }]
        .as_str()
        .unwrap_or(&version.name)
        .into(),
        date_published: raw[if source == "modrinth" {
            "date_published"
        } else {
            "fileDate"
        }]
        .as_str()
        .unwrap_or("")
        .into(),
        ..Default::default()
    }
}

fn zip_bytes(
    archive: &mut zip::ZipArchive<std::fs::File>,
    name: &str,
    limit: u64,
) -> Option<Vec<u8>> {
    let entry = archive.by_name(name).ok()?;
    if entry.size() > limit {
        return None;
    }
    let mut bytes = Vec::new();
    entry.take(limit + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= limit).then_some(bytes)
}

fn zip_text(archive: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    String::from_utf8(zip_bytes(archive, name, 256 * 1024)?).ok()
}

fn zip_icon(archive: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let bytes = zip_bytes(archive, name, 1024 * 1024)?;
    let image = image::ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .ok()?;
    let format = image.format()?;
    if !matches!(
        format,
        image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP
    ) {
        return None;
    }
    let (w, h) = image.into_dimensions().ok()?;
    if w == 0 || h == 0 || w > 2048 || h > 2048 {
        return None;
    }
    let mime = match format {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpeg",
        _ => "webp",
    };
    Some(format!(
        "data:image/{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn local_metadata(path: &Path, item: &mut Content) {
    let Ok(file) = std::fs::File::open(path) else {
        return;
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return;
    };
    let fabric = zip_text(&mut archive, "fabric.mod.json")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok());
    let quilt = zip_text(&mut archive, "quilt.mod.json")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok());
    let mut icon = None;
    if let Some(raw) = fabric {
        if item.source == "local" {
            item.name = raw["name"]
                .as_str()
                .or(raw["id"].as_str())
                .unwrap_or(&item.name)
                .into();
        }
        if item.info.version_name.is_empty() {
            item.info.version_name = raw["version"].as_str().unwrap_or("").into();
        }
        if item.info.author.is_empty() {
            item.info.author = raw["authors"][0]
                .as_str()
                .or(raw["authors"][0]["name"].as_str())
                .unwrap_or("")
                .into();
        }
        icon = raw["icon"].as_str().map(String::from).or_else(|| {
            raw["icon"]
                .as_object()
                .and_then(|o| o.values().find_map(|v| v.as_str().map(String::from)))
        });
    } else if let Some(raw) = quilt {
        let meta = &raw["quilt_loader"]["metadata"];
        if item.source == "local" {
            item.name = meta["name"].as_str().unwrap_or(&item.name).into();
        }
        if item.info.version_name.is_empty() {
            item.info.version_name = raw["quilt_loader"]["version"].as_str().unwrap_or("").into();
        }
        if item.info.author.is_empty() {
            item.info.author = meta["contributors"]
                .as_object()
                .and_then(|o| o.keys().next())
                .cloned()
                .unwrap_or_default();
        }
        icon = meta["icon"].as_str().map(String::from);
    } else if let Some(toml) = zip_text(&mut archive, "META-INF/neoforge.mods.toml")
        .or_else(|| zip_text(&mut archive, "META-INF/mods.toml"))
    {
        let value = |key: &str| {
            regex::Regex::new(&format!(r#"(?m)^\s*{key}\s*=\s*["']([^"'\r\n]+)["']"#))
                .ok()?
                .captures(&toml)?
                .get(1)
                .map(|v| v.as_str().to_string())
        };
        if item.source == "local" {
            if let Some(name) = value("displayName") {
                item.name = name;
            }
        }
        if item.info.version_name.is_empty() {
            item.info.version_name = value("version").unwrap_or_default();
            if item.info.version_name.contains("${") {
                item.info.version_name = zip_text(&mut archive, "META-INF/MANIFEST.MF")
                    .and_then(|s| {
                        s.lines().find_map(|l| {
                            l.strip_prefix("Implementation-Version: ")
                                .map(|v| v.trim().into())
                        })
                    })
                    .unwrap_or_default();
            }
        }
        if item.info.author.is_empty() {
            item.info.author = value("authors").unwrap_or_default();
        }
        icon = value("logoFile");
    }
    if item.info.icon.is_none() {
        item.info.icon = icon
            .and_then(|name| zip_icon(&mut archive, &name))
            .or_else(|| zip_icon(&mut archive, "pack.png"));
    }
}

fn file_sha1(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn describe_file(path: &Path, cache: &Path, mut item: Content) -> Result<Content> {
    let hash = file_sha1(path)?;
    // A file manually replaced under the same name must be identified again before updating it.
    if !item.info.sha1.is_empty() && item.info.sha1 != hash {
        item.source = "local".into();
        item.project_id.clear();
        item.version_id.clear();
        item.name = item.filename.clone();
        item.info = ContentInfo::default();
    }
    if let Ok(bytes) = std::fs::read(cache.join(format!("{hash}.json"))) {
        if let Ok(cached) = serde_json::from_slice::<Content>(&bytes) {
            if cached.info.sha1 == hash && cached.kind == item.kind {
                item.name = cached.name;
                item.source = cached.source;
                item.project_id = cached.project_id;
                item.version_id = cached.version_id;
                item.info = cached.info;
            }
        }
    }
    item.info.sha1 = hash;
    item.info.modified_at = std::fs::metadata(path)?
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    local_metadata(path, &mut item);
    Ok(item)
}

pub fn newer_version(item: &Content, raw: &Value, profile: &Profile) -> Option<ContentUpdate> {
    if raw["version_type"] == "alpha" || raw["releaseType"] == 3 {
        return None;
    }
    let version = if item.source == "modrinth" {
        mr_version(raw)
    } else {
        cf_version(raw)
    };
    if version.id.is_empty()
        || version.id == item.version_id
        || !compatible(&version, profile, &item.kind)
    {
        return None;
    }
    let project = if item.source == "modrinth" {
        raw["project_id"].as_str().unwrap_or("").to_string()
    } else {
        raw["modId"].to_string()
    };
    if project != item.project_id {
        return None;
    }
    let info = catalog_info(&item.source, raw, &version);
    if !item.info.date_published.is_empty()
        && (info.date_published.is_empty() || info.date_published <= item.info.date_published)
    {
        return None;
    }
    if item.source == "curseforge"
        && version.id.parse::<u64>().ok()? <= item.version_id.parse::<u64>().ok()?
    {
        return None;
    }
    Some(ContentUpdate {
        content_id: item.id.clone(),
        version_id: version.id,
        version_name: info.version_name,
    })
}

impl Engine {
    async fn content_post(&self, path: &str, body: Value) -> Result<Value> {
        Ok(self
            .http
            .post(format!("{MODRINTH}/{path}"))
            .timeout(Duration::from_secs(25))
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }
    async fn content_get(&self, path: &str, ids: &[String]) -> Result<Value> {
        Ok(self
            .http
            .get(format!("{MODRINTH}/{path}"))
            .timeout(Duration::from_secs(25))
            .query(&[("ids", serde_json::to_string(ids)?)])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }
    pub async fn remember_content(&self, id: &str, items: &[Content]) -> Result<()> {
        let instance = self.instance(id)?;
        let items = items.to_vec();
        // Background recognition must not resurrect deleted files or undo a concurrent toggle.
        let items = tokio::task::spawn_blocking(move || {
            items
                .into_iter()
                .filter_map(|mut item| {
                    let base = instance
                        .join(crate::content::folder(&item.kind).ok()?)
                        .join(&item.filename);
                    let disabled = base.with_file_name(format!("{}.disabled", item.filename));
                    let path = if base.is_file() {
                        item.enabled = true;
                        base
                    } else if disabled.is_file() {
                        item.enabled = false;
                        disabled
                    } else {
                        return None;
                    };
                    (file_sha1(&path).ok()? == item.info.sha1).then_some(item)
                })
                .collect::<Vec<_>>()
        })
        .await?;
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        let p = next
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .context("Сборка удалена")?;
        for item in items.iter().filter(|c| c.source != "local") {
            p.content
                .retain(|c| !(c.kind == item.kind && c.filename == item.filename));
            p.content.push(item.clone());
        }
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }

    pub async fn inspect_content(&self, id: &str) -> Result<ContentInspection> {
        let profile = self.profile(id).await?;
        let mut content = self.list_content(id).await?;
        let mut updates = vec![];
        let mut warnings = vec![];
        let hashes: Vec<String> = content
            .iter()
            .filter(|c| c.source != "curseforge")
            .map(|c| c.info.sha1.clone())
            .collect();
        if !hashes.is_empty() {
            let lookup = async {
                let mut versions = serde_json::Map::new();
                for chunk in hashes.chunks(100) {
                    let raw = self
                        .content_post(
                            "version_files",
                            json!({"hashes": chunk, "algorithm":"sha1"}),
                        )
                        .await?;
                    versions.extend(
                        raw.as_object()
                            .context("Некорректный ответ распознавания Modrinth")?
                            .clone(),
                    );
                }
                let ids: Vec<String> = versions
                    .values()
                    .filter_map(|v| v["project_id"].as_str().map(String::from))
                    .collect::<std::collections::BTreeSet<_>>()
                    .into_iter()
                    .collect();
                let mut projects = HashMap::new();
                for chunk in ids.chunks(100) {
                    let raw = self.content_get("projects", chunk).await?;
                    for v in raw.as_array().context("Нет проектов Modrinth")? {
                        if let Some(id) = v["id"].as_str() {
                            projects.insert(id.to_string(), v.clone());
                        }
                    }
                }
                let authors: Vec<String> = versions
                    .values()
                    .filter_map(|v| v["author_id"].as_str().map(String::from))
                    .collect::<std::collections::BTreeSet<_>>()
                    .into_iter()
                    .collect();
                let mut users = HashMap::new();
                for chunk in authors.chunks(100) {
                    if let Ok(raw) = self.content_get("users", chunk).await {
                        if let Some(values) = raw.as_array() {
                            for v in values {
                                if let Some(id) = v["id"].as_str() {
                                    users.insert(
                                        id.to_string(),
                                        v["username"].as_str().unwrap_or("").to_string(),
                                    );
                                }
                            }
                        }
                    }
                }
                for item in &mut content {
                    if item.source == "curseforge" {
                        continue;
                    }
                    let Some(raw) = versions.get(&item.info.sha1) else {
                        continue;
                    };
                    let Some(project_id) = raw["project_id"].as_str() else {
                        continue;
                    };
                    let Some(project) = projects.get(project_id) else {
                        continue;
                    };
                    if project["project_type"].as_str() != Some(item.kind.as_str()) {
                        continue;
                    }
                    let version = mr_version(raw);
                    if version.id.is_empty() {
                        continue;
                    }
                    item.name = project["title"].as_str().unwrap_or(&item.name).into();
                    item.source = "modrinth".into();
                    item.project_id = project_id.into();
                    item.version_id = version.id.clone();
                    let info = catalog_info("modrinth", raw, &version);
                    item.info.version_name = info.version_name;
                    item.info.date_published = info.date_published;
                    if let Some(icon) = project["icon_url"]
                        .as_str()
                        .filter(|s| s.starts_with("https://"))
                    {
                        item.info.icon = Some(icon.into());
                    }
                    if let Some(author) = raw["author_id"].as_str().and_then(|id| users.get(id)) {
                        item.info.author = author.clone();
                    }
                    item.info.project_url =
                        Some(format!("https://modrinth.com/project/{project_id}"));
                }
                Ok::<_, anyhow::Error>(())
            }
            .await;
            if let Err(e) = lookup {
                warnings.push(format!("Не удалось распознать часть файлов: {e}"));
            }
            for kind in ["mod", "shader", "resourcepack"] {
                let items: Vec<_> = content
                    .iter()
                    .filter(|c| c.source == "modrinth" && c.kind == kind)
                    .collect();
                let loaders = match kind {
                    "mod" => vec![profile.loader.key()],
                    "shader" => vec!["iris", "optifine"],
                    _ => vec!["minecraft"],
                };
                for chunk in items.chunks(100) {
                    let hashes: Vec<_> = chunk.iter().map(|c| &c.info.sha1).collect();
                    match self.content_post("version_files/update", json!({"hashes":hashes,"algorithm":"sha1","loaders":loaders,"game_versions":[profile.minecraft],"version_types":["release","beta"]})).await {
                        Ok(raw) => for item in chunk { if let Some(v) = raw.get(&item.info.sha1) { if let Some(update) = newer_version(item, v, &profile) { updates.push(update); } } },
                        Err(e) => warnings.push(format!("Не удалось проверить обновления Modrinth: {e}")),
                    }
                }
            }
        }
        for item in content.iter_mut().filter(|c| c.source == "curseforge") {
            let check = async {
                let project = self.cf(&format!("/mods/{}", item.project_id)).await?;
                let current = self
                    .cf(&format!(
                        "/mods/{}/files/{}",
                        item.project_id, item.version_id
                    ))
                    .await?;
                let p = crate::catalog::cf_project(&project["data"]);
                item.name = p.title;
                item.info.icon = p.icon;
                item.info.author = p.author;
                item.info.project_url = project["data"]["links"]["websiteUrl"]
                    .as_str()
                    .filter(|s| s.starts_with("https://"))
                    .map(String::from);
                let version = cf_version(&current["data"]);
                let info = catalog_info("curseforge", &current["data"], &version);
                item.info.version_name = info.version_name;
                item.info.date_published = info.date_published;
                let versions = self
                    .cf_versions(
                        &item.project_id,
                        Some(&profile.minecraft),
                        (item.kind == "mod").then_some(profile.loader.key()),
                    )
                    .await?;
                if let Some(update) = versions
                    .iter()
                    .find_map(|v| newer_version(item, v, &profile))
                {
                    updates.push(update);
                }
                Ok::<_, anyhow::Error>(())
            }
            .await;
            if let Err(e) = check {
                warnings.push(format!("{}: {e}", item.name));
            }
        }
        let cache = self.root.join("cache/content-metadata");
        tokio::fs::create_dir_all(&cache).await?;
        for item in &content {
            if item.source != "local" {
                tokio::fs::write(
                    cache.join(format!("{}.json", item.info.sha1)),
                    serde_json::to_vec(item)?,
                )
                .await?;
            }
        }
        self.remember_content(id, &content).await?;
        Ok(ContentInspection {
            content,
            updates,
            warnings,
        })
    }

    pub async fn update_all_content(
        &self,
        id: &str,
        content_ids: &[String],
        task: &Task,
    ) -> Result<ContentUpdateResult> {
        self.refresh_recovered().await;
        if self.running.lock().await.contains_key(id) {
            anyhow::bail!("Сначала остановите игру");
        }
        if self
            .operations
            .lock()
            .await
            .keys()
            .any(|operation| operation != &task.id)
        {
            anyhow::bail!("Дождитесь завершения текущей операции");
        }
        let mut result = ContentUpdateResult::default();
        let content = self.list_content(id).await?;
        let planned: Vec<_> = content
            .iter()
            .filter(|c| content_ids.contains(&c.id) && c.source != "local")
            .collect();
        for (i, item) in planned.iter().enumerate() {
            if task.check().is_err() {
                result.cancelled = true;
                break;
            }
            task.progress(
                "content",
                format!("Обновляем {} ({}/{})", item.name, i + 1, planned.len()),
                i as u64,
                planned.len() as u64,
            );
            // An earlier project's required dependency may already have replaced this local ID.
            let current = self.list_content(id).await?;
            let live = current.iter().find(|c| {
                c.source == item.source && c.project_id == item.project_id && c.kind == item.kind
            });
            let live_id = live.map_or(item.id.as_str(), |c| c.id.as_str());
            let changed_by_dependency = live.is_some_and(|c| c.version_id != item.version_id);
            match self.update_content(id, live_id, task).await {
                Ok(updated) => result.updated += usize::from(updated || changed_by_dependency),
                Err(_) if task.check().is_err() => {
                    result.cancelled = true;
                    break;
                }
                Err(e) => result.failed.push(ContentUpdateFailure {
                    name: item.name.clone(),
                    message: e.to_string(),
                }),
            }
        }
        Ok(result)
    }
}
