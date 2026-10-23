use auren_core::{model::*, Engine};
use serde_json::json;
use std::io::Write;

// Opt-in network smoke test. Uses only temporary profiles/data, never the user's library.
// cargo test -p auren-core --test curseforge_gateway -- --ignored --nocapture
#[tokio::test]
#[ignore = "contacts the deployed gateway and downloads a real CurseForge mod"]
async fn live_gateway_catalog_install_updates_and_pack_import() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let engine = Engine::new(dir.path().to_owned(), |_| {}).await?;
    assert!(engine.snapshot().await.curseforge_configured);
    for kind in ["mod", "modpack", "shader", "resourcepack"] {
        let categories = engine.catalog_categories("curseforge", kind).await?;
        assert!(categories.is_array());
        let found = engine
            .search(Search {
                query: String::new(),
                source: "curseforge".into(),
                kind: kind.into(),
                minecraft: None,
                loader: None,
                offset: 0,
                sort: "downloads".into(),
                category: None,
            })
            .await?;
        assert!(!found.projects.is_empty(), "{kind}");
        assert!(found
            .projects
            .iter()
            .all(|p| p.source == "curseforge" && p.kind == kind));
        println!("{kind}: categories and search OK");
    }
    let found = engine
        .search(Search {
            query: "FerriteCore".into(),
            source: "curseforge".into(),
            kind: "mod".into(),
            minecraft: Some("1.21.1".into()),
            loader: Some("fabric".into()),
            offset: 0,
            sort: "relevance".into(),
            category: None,
        })
        .await?;
    let project = found
        .projects
        .iter()
        .find(|p| p.title.to_lowercase().contains("ferritecore"))
        .ok_or_else(|| anyhow::anyhow!("FerriteCore fixture not found"))?;
    let detail = engine
        .project_detail("curseforge", &project.id, Some("1.21.1"), Some("fabric"))
        .await?;
    let version = detail
        .versions
        .first()
        .ok_or_else(|| anyhow::anyhow!("No compatible file"))?;
    let profile = engine
        .create_profile(
            "Gateway smoke".into(),
            "1.21.1".into(),
            Loader::Fabric,
            Some("0.16.14".into()),
            0,
        )
        .await?;
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), Some(profile.id.clone()))
        .await?;
    let installed = engine
        .install_content(&profile.id, "curseforge", &project.id, &version.id, &task)
        .await;
    engine.finish(&task, &installed).await;
    installed?;
    let content = engine.list_content(&profile.id).await?;
    let item = content
        .iter()
        .find(|c| c.project_id == project.id && c.source == "curseforge")
        .unwrap();
    assert!(engine
        .instance(&profile.id)?
        .join("mods")
        .join(&item.filename)
        .is_file());
    let inspected = engine.inspect_content(&profile.id).await?;
    assert!(inspected.warnings.is_empty(), "{:?}", inspected.warnings);
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), Some(profile.id.clone()))
        .await?;
    let update = engine.update_content(&profile.id, &item.id, &task).await;
    engine
        .finish(
            &task,
            &update
                .as_ref()
                .map(|_| ())
                .map_err(|e| anyhow::anyhow!("{e}")),
        )
        .await;
    update?;
    engine
        .manage_content(&profile.id, &item.id, "toggle")
        .await?;
    engine
        .manage_content(&profile.id, &item.id, "toggle")
        .await?;
    println!("project, file, dependency resolution, verified download, install, inspection and update OK");

    let archive = dir.path().join("gateway-pack.zip");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive)?);
    zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())?;
    zip.write_all(serde_json::to_string(&json!({
        "name":"Gateway pack", "manifestType":"minecraftModpack", "manifestVersion":1,
        "minecraft":{"version":"1.21.1","modLoaders":[{"id":"fabric-0.16.14","primary":true}]},
        "files":[{"projectID":project.id.parse::<u64>()?,"fileID":version.id.parse::<u64>()?,"required":true}],
        "overrides":"overrides"
    }))?.as_bytes())?;
    zip.finish()?;
    let task = engine.task(uuid::Uuid::new_v4().to_string(), None).await?;
    let imported = engine.import_pack(&archive, &task).await;
    engine
        .finish(
            &task,
            &imported
                .as_ref()
                .map(|_| ())
                .map_err(|e| anyhow::anyhow!("{e}")),
        )
        .await;
    let imported = imported?;
    let imported_profile = engine.profile(&imported).await?;
    assert!(imported_profile.manual_downloads.is_empty());
    let mods = engine.instance(&imported)?.join("mods");
    assert!(std::fs::read_dir(mods)?.next().is_some());
    engine
        .manage_content(&profile.id, &item.id, "remove")
        .await?;
    println!("CurseForge ZIP import and content removal OK; all data temporary");
    Ok(())
}
