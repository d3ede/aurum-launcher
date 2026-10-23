use crate::{model::*, Engine};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

pub const MODRINTH: &str = "https://api.modrinth.com/v2";
impl Engine {
    pub async fn cf(&self, path: &str) -> Result<Value> {
        self.curseforge_request(path).await
    }
    pub async fn search(&self, query: Search) -> Result<SearchResult> {
        if crate::pack_catalog::is_pack_source(&query.source) {
            return self.search_pack_catalog(query).await;
        }
        if !["mod", "modpack", "shader", "resourcepack"].contains(&query.kind.as_str()) {
            bail!("Неизвестный тип проекта")
        }
        if query.source == "modrinth" {
            let sort = match query.sort.as_str() {
                "" | "downloads" => "downloads",
                "relevance" => "relevance",
                "updated" => "updated",
                "newest" => "newest",
                _ => bail!("Неизвестная сортировка"),
            };
            let mut facets = vec![vec![format!("project_type:{}", query.kind)]];
            if let Some(category) = query.category.filter(|v| !v.is_empty()) {
                facets.push(vec![format!("categories:{category}")]);
            }
            if let Some(v) = query.minecraft.filter(|v| !v.is_empty()) {
                facets.push(vec![format!("versions:{v}")]);
            }
            if let Some(loader) = query.loader.filter(|v| !v.is_empty() && v != "vanilla") {
                facets.push(vec![format!("categories:{loader}")]);
            }
            let result: Value = self
                .http
                .get(format!("{MODRINTH}/search"))
                .query(&[
                    ("query", query.query),
                    ("facets", serde_json::to_string(&facets)?),
                    ("limit", "24".into()),
                    ("offset", query.offset.to_string()),
                    ("index", sort.into()),
                ])
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            Ok(SearchResult {
                total: result["total_hits"].as_u64().unwrap_or(0),
                projects: result["hits"]
                    .as_array()
                    .context("Нет результатов Modrinth")?
                    .iter()
                    .map(|v| mr_project(v, true))
                    .collect(),
            })
        } else if query.source == "curseforge" {
            let sort = match query.sort.as_str() {
                "" | "downloads" => "6",
                "relevance" => "2",
                "updated" => "3",
                "newest" => "11",
                _ => bail!("Неизвестная сортировка"),
            };
            let class = class_id(&query.kind)?;
            let mut url = crate::aurum_api::curseforge_url("/mods/search")?;
            {
                let mut p = url.query_pairs_mut();
                p.append_pair("gameId", "432")
                    .append_pair("classId", &class.to_string())
                    .append_pair("searchFilter", &query.query)
                    .append_pair("pageSize", "24")
                    .append_pair("index", &query.offset.to_string())
                    .append_pair("sortField", sort)
                    .append_pair("sortOrder", "desc");
                if let Some(mc) = query.minecraft {
                    p.append_pair("gameVersion", &mc);
                }
                if let Some(category) = query.category.filter(|v| !v.is_empty()) {
                    p.append_pair("categoryId", &category.parse::<u64>()?.to_string());
                }
                if let Some(loader) = query.loader {
                    if let Some(n) = loader_id(&loader) {
                        p.append_pair("modLoaderType", &n.to_string());
                    }
                }
            }
            let result = self
                .cf(&format!("/mods/search?{}", url.query().unwrap_or("")))
                .await?;
            Ok(SearchResult {
                total: result["pagination"]["totalCount"].as_u64().unwrap_or(0),
                projects: result["data"]
                    .as_array()
                    .context("Нет результатов CurseForge")?
                    .iter()
                    .map(cf_project)
                    .collect(),
            })
        } else {
            bail!("Неизвестный источник")
        }
    }
    pub async fn catalog_categories(&self, source: &str, kind: &str) -> Result<Value> {
        if crate::pack_catalog::is_pack_source(source) {
            return Ok(json!([]));
        }
        let mut categories: Vec<Value> = if source == "modrinth" {
            let raw = self.json(&format!("{MODRINTH}/tag/category")).await?;
            raw.as_array()
                .context("Нет категорий")?
                .iter()
                .filter(|v| v["project_type"] == kind && v["header"] != "loaders")
                .map(|v| json!({"id":v["name"],"name":v["name"]}))
                .collect()
        } else if source == "curseforge" {
            let raw = self
                .cf(&format!(
                    "/categories?gameId=432&classId={}",
                    class_id(kind)?
                ))
                .await?;
            raw["data"]
                .as_array()
                .context("Нет категорий")?
                .iter()
                .map(|v| json!({"id":v["id"].to_string(),"name":v["name"]}))
                .collect()
        } else {
            bail!("Неизвестный источник")
        };
        categories.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        Ok(json!(categories))
    }
    pub async fn project_detail(
        &self,
        source: &str,
        id: &str,
        mc: Option<&str>,
        loader: Option<&str>,
    ) -> Result<ProjectDetail> {
        crate::store::validate_version(id)?;
        if crate::pack_catalog::is_pack_source(source) {
            return self.pack_catalog_detail(source, id, mc).await;
        }
        if source == "modrinth" {
            let raw = self.json(&format!("{MODRINTH}/project/{id}")).await?;
            let versions = self.mr_versions(id, mc, loader).await?;
            Ok(ProjectDetail {
                project: mr_project(&raw, false),
                body: raw["body"].as_str().unwrap_or("").into(),
                gallery: raw["gallery"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(mr_gallery_image_url)
                            .map(String::from)
                            .collect()
                    })
                    .unwrap_or_default(),
                versions: versions.iter().map(mr_version).collect(),
                url: format!("https://modrinth.com/project/{id}"),
            })
        } else if source == "curseforge" {
            let raw = self.cf(&format!("/mods/{id}")).await?;
            let body = self.cf(&format!("/mods/{id}/description")).await?;
            let versions = self.cf_versions(id, mc, loader).await?;
            let project = cf_project(&raw["data"]);
            // HTML is displayed as text, never injected into the trusted webview.
            let description = regex::Regex::new(r"<[^>]*>")?
                .replace_all(body["data"].as_str().unwrap_or(""), " ")
                .into_owned();
            Ok(ProjectDetail {
                project,
                body: description,
                gallery: raw["data"]["screenshots"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v["url"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                versions: versions.iter().map(cf_version).collect(),
                url: raw["data"]["links"]["websiteUrl"]
                    .as_str()
                    .unwrap_or("https://www.curseforge.com/minecraft")
                    .into(),
            })
        } else {
            bail!("Неизвестный источник")
        }
    }
    pub async fn mr_versions(
        &self,
        id: &str,
        mc: Option<&str>,
        loader: Option<&str>,
    ) -> Result<Vec<Value>> {
        let mut url = reqwest::Url::parse(&format!("{MODRINTH}/project/{id}/version"))?;
        {
            let mut p = url.query_pairs_mut();
            if let Some(mc) = mc {
                p.append_pair("game_versions", &json!([mc]).to_string());
            }
            if let Some(l) = loader.filter(|l| *l != "vanilla") {
                p.append_pair("loaders", &json!([l]).to_string());
            }
        }
        Ok(self
            .http
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }
    pub async fn cf_versions(
        &self,
        id: &str,
        mc: Option<&str>,
        loader: Option<&str>,
    ) -> Result<Vec<Value>> {
        let mut url = crate::aurum_api::curseforge_url(&format!("/mods/{id}/files"))?;
        {
            let mut p = url.query_pairs_mut();
            p.append_pair("pageSize", "50");
            if let Some(mc) = mc {
                p.append_pair("gameVersion", mc);
            }
            if let Some(n) = loader.and_then(loader_id) {
                p.append_pair("modLoaderType", &n.to_string());
            }
        }
        let path = format!("/mods/{id}/files?{}", url.query().unwrap_or(""));
        let raw = self.cf(&path).await?;
        Ok(raw["data"].as_array().context("Нет файлов")?.clone())
    }
}
fn class_id(kind: &str) -> Result<u32> {
    match kind {
        "mod" => Ok(6),
        "modpack" => Ok(4471),
        "resourcepack" => Ok(12),
        "shader" => Ok(6552),
        _ => bail!("Неизвестный тип"),
    }
}
pub fn loader_id(l: &str) -> Option<u32> {
    match l {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}
pub fn mr_project(v: &Value, search: bool) -> Project {
    Project {
        id: v[if search { "project_id" } else { "id" }]
            .as_str()
            .unwrap_or("")
            .into(),
        source: "modrinth".into(),
        title: v["title"].as_str().unwrap_or("").into(),
        description: v["description"].as_str().unwrap_or("").into(),
        author: v["author"].as_str().unwrap_or("").into(),
        icon: v["icon_url"].as_str().map(String::from),
        downloads: v["downloads"].as_u64().unwrap_or(0),
        kind: v["project_type"].as_str().unwrap_or("mod").into(),
    }
}
pub fn cf_project(v: &Value) -> Project {
    Project {
        id: v["id"].to_string(),
        source: "curseforge".into(),
        title: v["name"].as_str().unwrap_or("").into(),
        description: v["summary"].as_str().unwrap_or("").into(),
        author: v["authors"][0]["name"].as_str().unwrap_or("").into(),
        icon: v["logo"]["url"].as_str().map(String::from),
        downloads: v["downloadCount"].as_f64().unwrap_or(0.) as u64,
        kind: match v["classId"].as_u64().unwrap_or(6) {
            4471 => "modpack",
            12 => "resourcepack",
            6552 => "shader",
            _ => "mod",
        }
        .into(),
    }
}
pub fn mr_version(v: &Value) -> ProjectVersion {
    ProjectVersion {
        id: v["id"].as_str().unwrap_or("").into(),
        name: v["name"].as_str().unwrap_or("").into(),
        game_versions: strings(&v["game_versions"]),
        loaders: strings(&v["loaders"]),
    }
}
pub fn cf_version(v: &Value) -> ProjectVersion {
    ProjectVersion {
        id: v["id"].to_string(),
        name: v["displayName"].as_str().unwrap_or("").into(),
        game_versions: strings(&v["gameVersions"])
            .into_iter()
            .filter(|v| v.starts_with(|c: char| c.is_ascii_digit()))
            .collect(),
        loaders: strings(&v["gameVersions"])
            .into_iter()
            .filter(|v| ["Forge", "Fabric", "Quilt", "NeoForge"].contains(&v.as_str()))
            .map(|s| s.to_lowercase())
            .collect(),
    }
}
fn mr_gallery_image_url(image: &Value) -> Option<&str> {
    // Modrinth's `url` can be a 350px thumbnail; display the author's original.
    image["raw_url"]
        .as_str()
        .filter(|url| !url.trim().is_empty())
        .or_else(|| image["url"].as_str())
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::mr_gallery_image_url;
    use serde_json::json;

    #[test]
    fn gallery_prefers_original_over_compressed_thumbnail() {
        let image = json!({
            "url": "https://cdn.modrinth.com/data/project/images/preview_350.webp",
            "raw_url": "https://cdn.modrinth.com/data/project/images/original.png"
        });
        assert_eq!(mr_gallery_image_url(&image), image["raw_url"].as_str());
    }

    #[test]
    fn gallery_keeps_legacy_images_without_an_original() {
        for original in [json!(null), json!(""), json!(" ")] {
            let image = json!({"url": "https://example.test/legacy.png", "raw_url": original});
            assert_eq!(
                mr_gallery_image_url(&image),
                Some("https://example.test/legacy.png")
            );
        }
        assert_eq!(
            mr_gallery_image_url(&json!({"url": "https://example.test/legacy.png"})),
            Some("https://example.test/legacy.png")
        );
        assert_eq!(mr_gallery_image_url(&json!({})), None);
    }
}
