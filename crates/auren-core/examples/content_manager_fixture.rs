// Downloads older real mod files into an owned profile, then verifies hash recognition and compatible updates.
use anyhow::{Context, Result};
use auren_core::{
    catalog::{mr_version, MODRINTH},
    model::Loader,
    Engine,
};
use serde_json::json;
use std::io::Write;

#[tokio::main]
async fn main() -> Result<()> {
    let root = std::env::current_dir()?
        .join(".test-data")
        .join(format!("content-manager-live-{}", auren_core::now()));
    let engine = Engine::new(root.clone(), |_| {}).await?;
    let p = engine
        .create_profile(
            "Content manager smoke".into(),
            "1.21.1".into(),
            Loader::Fabric,
            Some("0.16.14".into()),
            0,
        )
        .await?;
    let mods = engine.instance(&p.id)?.join("mods");
    tokio::fs::create_dir_all(&mods).await?;
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), Some(p.id.clone()))
        .await?;
    for (project, disabled) in [("AANobbMI", true), ("YL57xq9U", false)] {
        let versions = engine
            .mr_versions(project, Some("1.21.1"), Some("fabric"))
            .await?;
        let raw = versions
            .iter()
            .filter(|v| v["version_type"] == "release")
            .nth(1)
            .context("Need two compatible releases for smoke fixture")?;
        let files = raw["files"].as_array().context("No mod files")?;
        let file = files
            .iter()
            .find(|f| f["primary"] == true)
            .or(files.first())
            .context("Empty mod version")?;
        let filename = file["filename"].as_str().context("No filename")?;
        let destination = auren_core::safe_join(
            &mods,
            &format!("{filename}{}", if disabled { ".disabled" } else { "" }),
        )?;
        engine
            .download(
                file["url"].as_str().context("No URL")?,
                &destination,
                Some(("sha1", file["hashes"]["sha1"].as_str().context("No SHA1")?)),
                &task,
            )
            .await?;
        println!("Downloaded {} {}", project, mr_version(raw).name);
    }
    let local = mods.join("private-tool.jar");
    let mut jar = zip::ZipWriter::new(std::fs::File::create(&local)?);
    jar.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default())?;
    jar.write_all(br#"{"id":"private_tool","name":"Private utility","version":"2.4.0","authors":["Smoke test"]}"#)?;
    jar.finish()?;
    let before = engine.list_content(&p.id).await?;
    anyhow::ensure!(before.iter().all(|c| c.source == "local"));
    let inspected = engine.inspect_content(&p.id).await?;
    anyhow::ensure!(inspected.warnings.is_empty(), "{:?}", inspected.warnings);
    anyhow::ensure!(
        inspected.updates.len() == 2,
        "Expected updates for older Sodium and Iris: {:?}",
        inspected.updates
    );
    let sodium = inspected
        .content
        .iter()
        .find(|c| c.project_id == "AANobbMI")
        .context("Sodium not recognized")?;
    anyhow::ensure!(!sodium.enabled);
    anyhow::ensure!(sodium.info.icon.is_some() && !sodium.info.version_name.is_empty());
    anyhow::ensure!(inspected.content.iter().any(|c| c.name == "Private utility"
        && c.info.version_name == "2.4.0"
        && c.source == "local"));
    engine.finish(&task, &Ok(())).await;
    tokio::fs::write(
        ".test-data/content-manager-fixture.json",
        serde_json::to_vec_pretty(
            &json!({"root":root,"profileId":p.id,"updates":inspected.updates,"api":MODRINTH}),
        )?,
    )
    .await?;
    println!("CONTENT_MANAGER_FIXTURE_OK {}", root.display());
    Ok(())
}
