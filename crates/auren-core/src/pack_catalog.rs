//! Public platform protocols, independently implemented from documented APIs.
use crate::{model::*, Engine};
use anyhow::{bail, Context, Result};
use futures_util::{stream, FutureExt, StreamExt, TryStreamExt};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

pub const ATL: &str = "https://api.atlauncher.com/v1";
pub const ATL_CDN: &str = "https://download.nodecdn.net/containers/atl/";
pub const FTB: &str = "https://api.feed-the-beast.com/v1/modpacks/public";
pub const TECHNIC: &str = "https://api.technicpack.net";

pub fn is_pack_source(source: &str) -> bool {
    matches!(source, "atlauncher" | "ftb" | "technic")
}

/// No platform credentials are needed for public catalog or download requests.
/// A 401/403 is not interpreted as a Microsoft account requirement.
impl Engine {
    pub(crate) async fn catalog_json(&self, url: &str) -> Result<Value> {
        if let Some((time, value)) = self.catalog_cache.lock().await.get(url) {
            if time.elapsed() < Duration::from_secs(300) {
                return Ok(value.clone());
            }
        }
        let response = self
            .http
            .get(url)
            .send()
            .await
            .context("Cannot reach the modpack catalog")?;
        if matches!(response.status().as_u16(), 401 | 403) {
            bail!("The provider denied access (HTTP {}). Open the project website to check its availability. Signing in to Minecraft does not unlock private platform downloads.", response.status().as_u16());
        }
        let value: Value = response.error_for_status()?.json().await?;
        if value["error"] == true || value["status"] == "error" {
            bail!(
                "Catalog: {}",
                value["message"].as_str().unwrap_or("Project unavailable")
            );
        }
        let mut cache = self.catalog_cache.lock().await;
        // Bound long sessions; expire old search responses without writing player data.
        cache.retain(|_, (time, _)| time.elapsed() < Duration::from_secs(300));
        if cache.len() >= 512 {
            cache.clear();
        }
        cache.insert(url.into(), (Instant::now(), value.clone()));
        Ok(value)
    }

    pub(crate) async fn atl_index(&self) -> Result<Vec<Value>> {
        let raw = self.catalog_json(&format!("{ATL}/packs/full/all")).await?;
        Ok(raw["data"]
            .as_array()
            .context("Invalid ATLauncher catalog")?
            .iter()
            .filter(|p| {
                p["type"] == "public"
                    && p["system"] != true
                    && p["versions"].as_array().is_some_and(|a| !a.is_empty())
            })
            .cloned()
            .collect())
    }

    async fn ftb_index(&self) -> Result<Vec<Value>> {
        let _index = self.catalog_index_lock.lock().await;
        const KEY: &str = "ftb:complete-index";
        if let Some((time, value)) = self.catalog_cache.lock().await.get(KEY) {
            if time.elapsed() < Duration::from_secs(300) {
                return Ok(value.as_array().context("Invalid cached catalog")?.clone());
            }
        }
        let raw = self.catalog_json(&format!("{FTB}/modpack/all")).await?;
        let ids = raw["packs"].as_array().context("Invalid FTB catalog")?;
        if ids.len() > 2000 {
            bail!("FTB catalog exceeds the supported size");
        }
        let requests: Vec<_> = ids
            .iter()
            .map(|id| {
                async move {
                    let id = id.as_u64().context("Invalid FTB project ID")?;
                    self.catalog_json(&format!("{FTB}/modpack/{id}")).await
                }
                .boxed()
            })
            .collect();
        let packs: Vec<Value> = stream::iter(requests)
            .buffer_unordered(6)
            .try_collect()
            .await?;
        let packs: Vec<Value> = packs
            .into_iter()
            .filter(|p| {
                p["private"] != true
                    && p["versions"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|v| v["private"] != true))
            })
            .collect();
        self.catalog_cache
            .lock()
            .await
            .insert(KEY.into(), (Instant::now(), json!(packs)));
        Ok(packs)
    }

    pub async fn search_pack_catalog(&self, query: Search) -> Result<SearchResult> {
        if query.kind != "modpack" {
            bail!("This source contains modpacks only");
        }
        if query.offset > 100_000 || query.query.len() > 300 {
            bail!("Invalid catalog query");
        }
        if query.source == "technic" {
            // Platform search returns a bounded list, not a paginated total. Paginate that
            // real list locally instead of inventing unsupported pages or counts.
            let mut url = reqwest::Url::parse(&format!(
                "{TECHNIC}/{}",
                if query.query.trim().is_empty() {
                    "trending"
                } else {
                    "search"
                }
            ))?;
            url.query_pairs_mut().append_pair("build", "aurum");
            if !query.query.trim().is_empty() {
                url.query_pairs_mut().append_pair("q", query.query.trim());
            }
            let raw = self.catalog_json(url.as_str()).await?;
            let projects: Vec<_> = raw["modpacks"]
                .as_array()
                .context("Invalid Technic results")?
                .iter()
                .filter(|v| v["slug"] != "vanilla")
                .map(|v| platform_project("technic", v))
                .collect();
            return Ok(SearchResult {
                total: projects.len() as u64,
                projects: projects
                    .into_iter()
                    .skip(query.offset as usize)
                    .take(24)
                    .collect(),
            });
        }
        let mut packs = match query.source.as_str() {
            "atlauncher" => self.atl_index().await?,
            "ftb" => self.ftb_index().await?,
            _ => bail!("Unknown modpack source"),
        };
        let needle = query.query.trim().to_lowercase();
        packs.retain(|p| {
            let matches_text = format!("{} {}", text(p, "name"), text(p, "description"))
                .to_lowercase()
                .contains(&needle);
            let matches_mc = query
                .minecraft
                .as_deref()
                .filter(|s| !s.is_empty())
                .is_none_or(|mc| {
                    p["versions"].as_array().is_some_and(|a| {
                        a.iter().any(|v| {
                            v["private"] != true
                                && if query.source == "atlauncher" {
                                    v["minecraft"] == mc
                                } else {
                                    v["targets"].as_array().is_some_and(|a| {
                                        a.iter()
                                            .any(|t| t["name"] == "minecraft" && t["version"] == mc)
                                    })
                                }
                        })
                    })
                });
            matches_text && matches_mc
        });
        match query.sort.as_str() {
            "name" | "relevance" => packs.sort_by_key(|p| text(p, "name").to_lowercase()),
            "newest" | "updated" if query.source == "atlauncher" => packs.sort_by_key(|p| {
                std::cmp::Reverse(p["versions"][0]["published"].as_u64().unwrap_or(0))
            }),
            "downloads" if query.source == "ftb" => {
                packs.sort_by_key(|p| std::cmp::Reverse(p["installs"].as_u64().unwrap_or(0)))
            }
            "updated" | "newest" if query.source == "ftb" => {
                let key = if query.sort == "updated" {
                    "updated"
                } else {
                    "released"
                };
                packs.sort_by_key(|p| std::cmp::Reverse(p[key].as_u64().unwrap_or(0)));
            }
            _ => packs.sort_by_key(|p| text(p, "name").to_lowercase()),
        }
        Ok(SearchResult {
            total: packs.len() as u64,
            projects: packs
                .iter()
                .skip(query.offset as usize)
                .take(24)
                .map(|p| platform_project(&query.source, p))
                .collect(),
        })
    }

    pub(crate) async fn technic_pack(&self, id: &str) -> Result<Value> {
        crate::store::validate_version(id)?;
        self.catalog_json(&format!("{TECHNIC}/modpack/{id}?build=aurum"))
            .await
    }

    pub async fn pack_catalog_detail(
        &self,
        source: &str,
        id: &str,
        mc: Option<&str>,
    ) -> Result<ProjectDetail> {
        crate::store::validate_version(id)?;
        let (raw, versions, url) = match source {
            "atlauncher" => {
                let index = self.atl_index().await?;
                let raw = index
                    .into_iter()
                    .find(|p| p["safeName"] == id)
                    .context("ATLauncher pack not found")?;
                let versions = raw["versions"]
                    .as_array()
                    .context("Missing ATLauncher versions")?
                    .iter()
                    .filter(|v| mc.is_none_or(|mc| v["minecraft"] == mc))
                    .map(|v| ProjectVersion {
                        id: text(v, "version").into(),
                        name: text(v, "version").into(),
                        game_versions: vec![text(v, "minecraft").into()],
                        loaders: vec![],
                    })
                    .collect();
                (raw, versions, format!("https://atlauncher.com/pack/{id}"))
            }
            "ftb" => {
                let id: u64 = id.parse()?;
                let raw = self.catalog_json(&format!("{FTB}/modpack/{id}")).await?;
                let mut versions: Vec<_> = raw["versions"]
                    .as_array()
                    .context("Missing FTB versions")?
                    .iter()
                    .filter(|v| v["private"] != true)
                    .map(ftb_version)
                    .filter(|v| mc.is_none_or(|mc| v.game_versions.iter().any(|s| s == mc)))
                    .collect();
                versions.reverse(); // FTB publishes oldest first.
                let slug = text(&raw, "slug");
                let url = format!("https://www.feed-the-beast.com/modpacks/{id}-{slug}");
                (raw, versions, url)
            }
            "technic" => {
                let raw = self.technic_pack(id).await?;
                let versions =
                    if let Some(solder) = raw["solder"].as_str().filter(|s| !s.is_empty()) {
                        let url = solder_url(solder, id, None)?;
                        let pack = self.catalog_json(&url).await?;
                        let recommended = pack["recommended"]
                            .as_str()
                            .or(pack["latest"].as_str())
                            .unwrap_or("");
                        let mut builds: Vec<_> = pack["builds"]
                            .as_array()
                            .context("Missing Solder builds")?
                            .iter()
                            .filter_map(Value::as_str)
                            .collect();
                        builds.reverse();
                        builds.sort_by_key(|s| *s != recommended);
                        builds
                            .into_iter()
                            .map(|v| ProjectVersion {
                                id: v.into(),
                                name: v.into(),
                                game_versions: vec![],
                                loaders: vec![],
                            })
                            .collect()
                    } else if raw["url"].as_str().is_some_and(|s| !s.is_empty()) {
                        vec![ProjectVersion {
                            id: text(&raw, "version").into(),
                            name: text(&raw, "version").into(),
                            game_versions: vec![text(&raw, "minecraft").into()],
                            loaders: vec![],
                        }]
                    } else {
                        vec![]
                    };
                let url = raw["platformUrl"]
                    .as_str()
                    .unwrap_or("https://www.technicpack.net/modpacks")
                    .into();
                (raw, versions, url)
            }
            _ => bail!("Unknown modpack source"),
        };
        let project = platform_project(source, &raw);
        let gallery = if source == "ftb" {
            raw["art"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter(|v| v["type"] != "square")
                        .filter_map(|v| v["url"].as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default()
        } else if source == "technic" {
            [
                raw["background"]["url"].as_str(),
                raw["logo"]["url"].as_str(),
            ]
            .into_iter()
            .flatten()
            .map(String::from)
            .collect()
        } else {
            vec![]
        };
        Ok(ProjectDetail {
            body: text(&raw, "description").into(),
            project,
            gallery,
            versions,
            url,
        })
    }
}

pub(crate) fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub(crate) fn solder_url(base: &str, id: &str, build: Option<&str>) -> Result<String> {
    crate::store::validate_version(id)?;
    let mut url = reqwest::Url::parse(base)?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("Solder must provide a public HTTPS API URL");
    }
    url.set_query(None);
    url.set_fragment(None);
    let path = format!("{}/modpack/{id}", url.path().trim_end_matches('/'));
    url.set_path(&path);
    if let Some(build) = build {
        crate::store::validate_version(build)?;
        url.path_segments_mut()
            .map_err(|_| anyhow::anyhow!("Invalid Solder URL"))?
            .push(build);
    }
    Ok(url.into())
}

pub fn platform_project(source: &str, v: &Value) -> Project {
    let (id, title, description, author, icon, downloads) = match source {
        "atlauncher" => {
            let id = text(v, "safeName");
            (
                id.to_string(),
                text(v, "name"),
                text(v, "description"),
                "",
                Some(format!(
                    "{ATL_CDN}launcher/images/{}.png",
                    id.to_ascii_lowercase()
                )),
                0,
            )
        }
        "ftb" => (
            v["id"].to_string(),
            text(v, "name"),
            text(v, "synopsis"),
            text(&v["authors"][0], "name"),
            v["art"]
                .as_array()
                .and_then(|a| a.iter().find(|a| a["type"] == "square"))
                .and_then(|v| v["url"].as_str())
                .map(String::from),
            v["installs"].as_u64().unwrap_or(0),
        ),
        _ => (
            v["slug"].as_str().unwrap_or(text(v, "name")).into(),
            v["displayName"].as_str().unwrap_or(text(v, "name")),
            text(v, "description"),
            text(v, "user"),
            v["iconUrl"]
                .as_str()
                .or(v["icon"]["url"].as_str())
                .map(String::from),
            v["installs"].as_u64().unwrap_or(0),
        ),
    };
    Project {
        id,
        source: source.into(),
        title: title.into(),
        description: description.into(),
        author: author.into(),
        icon,
        downloads,
        kind: "modpack".into(),
    }
}

pub fn ftb_version(v: &Value) -> ProjectVersion {
    let targets = v["targets"].as_array().cloned().unwrap_or_default();
    ProjectVersion {
        id: v["id"].to_string(),
        name: text(v, "name").into(),
        game_versions: targets
            .iter()
            .filter(|t| t["name"] == "minecraft")
            .map(|t| text(t, "version").into())
            .collect(),
        loaders: targets
            .iter()
            .filter(|t| t["type"] == "modloader")
            .map(|t| text(t, "name").into())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn public_atl_filter_search_mc_pagination_and_private_packs() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../.test-data/pack-catalog-tests");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
        let mut packs:Vec<_>=(0..26).map(|n|json!({"safeName":format!("Pack{n}"),"name":format!("Adventure {n:02}"),"type":"public","versions":[{"version":"1.0","minecraft":"1.20.1"}]})).collect();
        packs.push(json!({"safeName":"Private","name":"Private","type":"private","versions":[{"version":"1.0"}]}));
        e.catalog_cache.lock().await.insert(
            format!("{ATL}/packs/full/all"),
            (Instant::now(), json!({"data":packs})),
        );
        let mut q = Search {
            query: "ADVENTURE".into(),
            source: "atlauncher".into(),
            kind: "modpack".into(),
            minecraft: Some("1.20.1".into()),
            loader: None,
            offset: 24,
            sort: "name".into(),
            category: None,
        };
        let result = e.search(q.clone()).await.unwrap();
        assert_eq!(result.total, 26);
        assert_eq!(result.projects.len(), 2);
        assert_eq!(result.projects[0].title, "Adventure 24");
        q.minecraft = Some("1.21.1".into());
        assert_eq!(e.search(q.clone()).await.unwrap().total, 0);
        q.kind = "mod".into();
        assert!(e.search(q).await.is_err());
    }
}
