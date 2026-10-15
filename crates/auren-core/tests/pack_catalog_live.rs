//! Opt-in checks against public APIs; never use the player's actual launcher state.
use auren_core::{model::Search, platform_packs::PackOptions, Engine};
use std::path::Path;

#[tokio::test]
#[ignore = "Contacts public ATLauncher, FTB, Technic and Solder APIs"]
async fn public_catalogs_and_install_manifests_need_no_player_account() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/live-pack-catalogs");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    for (source, query, project) in [
        ("atlauncher", "All The Forge", "AllTheForge6"),
        ("ftb", "Evolution", "125"),
        ("technic", "The 1.12.2 Pack", "the-1122-pack"),
    ] {
        let results = e
            .search(Search {
                source: source.into(),
                query: query.into(),
                kind: "modpack".into(),
                minecraft: None,
                loader: None,
                offset: 0,
                sort: "downloads".into(),
                category: None,
            })
            .await
            .unwrap();
        assert!(
            !results.projects.is_empty(),
            "{source} search returned no packs"
        );
        assert!(results
            .projects
            .iter()
            .all(|p| p.source == source && p.kind == "modpack"));
        let detail = e.project_detail(source, project, None, None).await.unwrap();
        let version = detail.versions.first().expect("No public versions");
        let requirements = e
            .pack_requirements(source, project, &version.id, &PackOptions::default())
            .await
            .unwrap();
        assert!(requirements.file_count > 0);
        println!(
            "{source}: {} results, {} versions, {} files, {} browser downloads",
            results.total,
            detail.versions.len(),
            requirements.file_count,
            requirements.manual_files.len()
        );
        // One small real component exercises download transport and checksums without
        // downloading multi-gigabyte packs or using a player's installed instances.
        let (url, algorithm, checksum) = match source {
            "atlauncher" => {
                let raw = e
                    .json(&format!(
                        "{}packs/{project}/versions/{}/Configs.json",
                        auren_core::pack_catalog::ATL_CDN,
                        version.id
                    ))
                    .await
                    .unwrap();
                let file = raw["mods"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|f| {
                        f["download"] == "server"
                            && f["md5"].is_string()
                            && f["filesize"].as_u64().is_some_and(|n| n > 0 && n < 150_000)
                    })
                    .min_by_key(|f| f["filesize"].as_u64().unwrap())
                    .unwrap();
                (
                    format!(
                        "{}{}",
                        auren_core::pack_catalog::ATL_CDN,
                        file["url"].as_str().unwrap()
                    ),
                    "md5",
                    file["md5"].as_str().unwrap().to_string(),
                )
            }
            "ftb" => {
                let raw = e
                    .json(&format!(
                        "{}/modpack/{project}/{}",
                        auren_core::pack_catalog::FTB,
                        version.id
                    ))
                    .await
                    .unwrap();
                let file = raw["files"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|f| {
                        f["url"].is_string()
                            && f["size"].as_u64().is_some_and(|n| n > 0 && n < 1000)
                    })
                    .unwrap();
                (
                    file["url"].as_str().unwrap().into(),
                    "sha1",
                    file["sha1"].as_str().unwrap().into(),
                )
            }
            _ => {
                let raw = e
                    .json(&format!(
                        "https://solder.technicpack.net/api/modpack/{project}/{}",
                        version.id
                    ))
                    .await
                    .unwrap();
                let file = raw["mods"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|f| f["filesize"].as_u64().is_some_and(|n| n > 0 && n < 150_000))
                    .min_by_key(|f| f["filesize"].as_u64().unwrap())
                    .unwrap();
                (
                    file["url"].as_str().unwrap().into(),
                    "md5",
                    file["md5"].as_str().unwrap().into(),
                )
            }
        };
        let task = e
            .task(uuid::Uuid::new_v4().to_string(), None)
            .await
            .unwrap();
        let file = dir.path().join(format!("{source}-component"));
        let result = e
            .download(&url, &file, Some((algorithm, &checksum)), &task)
            .await;
        e.finish(&task, &result).await;
        result.unwrap();
        println!(
            "{source}: downloaded and verified {} bytes ({algorithm})",
            std::fs::metadata(file).unwrap().len()
        );
    }
    assert!(e.snapshot().await.database.accounts.is_empty());
}
