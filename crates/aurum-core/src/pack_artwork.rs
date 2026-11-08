use crate::{model::Runtime, store::persist, Engine};
use anyhow::Result;
use serde_json::Value;
use std::time::Duration;

fn normalized_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn icon_urls(source: &str, raw: &Value) -> Vec<String> {
    let values = if source == "modrinth" {
        vec![&raw["icon_url"]]
    } else {
        vec![
            &raw["data"]["logo"]["url"],
            &raw["data"]["logo"]["thumbnailUrl"],
        ]
    };
    let mut urls = Vec::new();
    for value in values {
        if let Some(url) = value.as_str().filter(|u| !u.is_empty()) {
            if !urls.iter().any(|u| u == url) {
                urls.push(url.to_owned());
            }
        }
    }
    urls
}
fn unique_pack<'a>(
    projects: &'a [crate::model::Project],
    name: &str,
) -> Option<&'a crate::model::Project> {
    let key = normalized_name(name);
    let matches: Vec<_> = projects
        .iter()
        .filter(|p| p.kind == "modpack" && normalized_name(&p.title) == key)
        .collect();
    (matches.len() == 1).then(|| matches[0])
}

impl Engine {
    pub(crate) async fn catalog_pack_icon(
        &self,
        source: &str,
        project: &str,
        hint: Option<&str>,
    ) -> Option<String> {
        if let Some(hint) = hint {
            if let Some(icon) = self.download_pack_icon(hint).await {
                return Some(icon);
            }
        }
        let metadata = tokio::time::timeout(Duration::from_secs(5), async {
            if source == "modrinth" {
                self.json(&format!("{}/project/{project}", crate::catalog::MODRINTH))
                    .await
            } else {
                self.cf(&format!("/mods/{project}")).await
            }
        })
        .await
        .ok()?
        .ok()?;
        for url in icon_urls(source, &metadata) {
            if let Some(icon) = self.download_pack_icon(&url).await {
                return Some(icon);
            }
        }
        None
    }

    /// Exported CurseForge ZIP manifests normally omit the catalog's artwork.
    /// Recover only an unambiguous exact-title match and never overwrite a
    /// player's custom icon or colors, including edits made during the request.
    pub async fn repair_pack_icon(&self, id: &str) -> Result<bool> {
        let profile = self.profile(id).await?;
        if profile.engine != Runtime::Java
            || profile.icon.is_some()
            || profile.icon_style.is_some()
            || profile.name.starts_with("Minecraft ")
        {
            return Ok(false);
        }
        let found = tokio::time::timeout(Duration::from_secs(12), async {
            let result = self
                .search(crate::model::Search {
                    source: "curseforge".into(),
                    query: profile.name.trim_end_matches(['.', ' ']).into(),
                    kind: "modpack".into(),
                    minecraft: Some(profile.minecraft.clone()),
                    loader: None,
                    category: None,
                    sort: "relevance".into(),
                    offset: 0,
                })
                .await
                .ok()?;
            let project = unique_pack(&result.projects, &profile.name)?;
            self.catalog_pack_icon("curseforge", &project.id, project.icon.as_deref())
                .await
        })
        .await
        .ok()
        .flatten();
        let Some(icon) = found else { return Ok(false) };
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        let Some(current) = next.profiles.iter_mut().find(|p| p.id == id) else {
            return Ok(false);
        };
        if current.icon.is_some() || current.icon_style.is_some() || current.name != profile.name {
            return Ok(false);
        }
        current.icon = Some(icon);
        persist(&self.root, &next).await?;
        *db = next;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Project;
    #[tokio::test]
    async fn artwork_repair_never_replaces_a_custom_icon() {
        let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/pack-artwork-tests");
        std::fs::create_dir_all(&root).unwrap();let dir=tempfile::tempdir_in(root).unwrap();
        let engine=Engine::new(dir.path().into(),|_|{}).await.unwrap();
        let p=engine.create_profile("Custom pack".into(),"1.20.1".into(),crate::model::Loader::Vanilla,None,0).await.unwrap();
        engine.db.lock().await.profiles[0].icon=Some("custom image".into());
        assert!(!engine.repair_pack_icon(&p.id).await.unwrap());
        assert_eq!(engine.profile(&p.id).await.unwrap().icon.as_deref(),Some("custom image"));
    }
    #[test]
    fn prefers_full_curseforge_logo_and_ignores_empty_thumbnails() {
        assert_eq!(
            icon_urls(
                "curseforge",
                &serde_json::json!({"data":{"logo":{"url":"https://cdn.example/full.png","thumbnailUrl":""}}})
            ),
            vec!["https://cdn.example/full.png"]
        );
        assert_eq!(
            icon_urls(
                "curseforge",
                &serde_json::json!({"data":{"logo":{"url":"https://cdn.example/full.png","thumbnailUrl":"https://cdn.example/thumb.png"}}})
            ),
            vec![
                "https://cdn.example/full.png",
                "https://cdn.example/thumb.png"
            ]
        );
    }
    #[test]
    fn title_matching_ignores_punctuation_but_never_chooses_a_similar_or_ambiguous_pack() {
        let project = Project {
            id: "42".into(),
            source: "curseforge".into(),
            title: "Zombie REAP - Plague Against Your World".into(),
            description: String::new(),
            author: String::new(),
            icon: None,
            downloads: 0,
            kind: "modpack".into(),
        };
        assert!(unique_pack(
            std::slice::from_ref(&project),
            "Zombie REAP Plague Against Your World."
        )
        .is_some());
        assert!(unique_pack(std::slice::from_ref(&project), "Zombie REAP Lite").is_none());
        assert!(unique_pack(
            &[project.clone(), project],
            "Zombie REAP Plague Against Your World."
        )
        .is_none());
    }
}
