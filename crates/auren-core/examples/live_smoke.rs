// Real downloads and Java processes. Uses only isolated .test-data; no production accounts.
use anyhow::{bail, Context, Result};
use auren_core::{catalog::mr_version, model::*, Engine};
#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("vanilla");
    let root = std::env::current_dir()?.join(".test-data/live");
    let e = Engine::new(root, |event| {
        if !["log","loader","libraries"].contains(&event.phase.as_str()) && (event.phase!="assets" || event.done%1000==0 || event.done==event.total) {
            println!(
                "{}: {} ({}/{})",
                event.phase, event.message, event.done, event.total
            );
        }
    })
    .await?;
    if e.snapshot().await.database.accounts.is_empty() {
        e.add_offline("AurenTest".into()).await?;
    }
    let loader = match mode {
        "vanilla" => Loader::Vanilla,
        "fabric" => Loader::Fabric,
        "forge" => Loader::Forge,
        "neoforge" => Loader::Neoforge,
        "quilt" => Loader::Quilt,
        _ => bail!("Unknown loader"),
    };
    let mc = "1.21.1";
    let versions = e.loader_versions(mc, loader.clone()).await?;
    let lv = versions.first().cloned();
    let p = if let Some(p) = e
        .snapshot()
        .await
        .database
        .profiles
        .into_iter()
        .find(|p| p.loader == loader)
    {
        p
    } else {
        e.create_profile(format!("Smoke {mode}"), mc.into(), loader.clone(), lv, 0)
            .await?
    };
    let t = e
        .task(uuid::Uuid::new_v4().to_string(), Some(p.id.clone()))
        .await?;
    let result = e.install(&p.id, &t).await;
    e.finish(&t, &result).await;
    result?;
    if loader == Loader::Fabric {
        let result = e
            .search(Search {
                query: "Sodium".into(),
                source: "modrinth".into(),
                kind: "mod".into(),
                minecraft: Some(mc.into()),
                loader: Some("fabric".into()),
                offset: 0,
            })
            .await?;
        assert!(!result.projects.is_empty());
        let project = result
            .projects
            .iter()
            .find(|p| p.title == "Sodium")
            .context("No Sodium result")?;
        let versions = e.mr_versions(&project.id, Some(mc), Some("fabric")).await?;
        let version = mr_version(versions.first().context("No compatible Sodium")?);
        let t = e
            .task(uuid::Uuid::new_v4().to_string(), Some(p.id.clone()))
            .await?;
        let result = e
            .install_content(&p.id, "modrinth", &project.id, &version.id, &t)
            .await;
        e.finish(&t, &result).await;
        result?;
        assert!(!e.list_content(&p.id).await?.is_empty());
    }
    e.launch(&p.id).await?;
    let log = e.instance(&p.id)?.join("auren-latest.log");
    let mut ready = false;
    for _ in 0..120 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let text = tokio::fs::read_to_string(&log).await.unwrap_or_default();
        if text.contains("OpenAL initialized")
            || text.contains("Created: 1024x1024")
            || text.contains("Sound engine started")
        {
            ready = true;
            break;
        }
        if !e.snapshot().await.running.contains(&p.id) {
            println!("{text}");
            bail!("Game exited before initialization")
        }
    }
    if !ready {
        let text = tokio::fs::read_to_string(&log).await.unwrap_or_default();
        println!("{text}");
        let _ = e.stop(&p.id).await;
        bail!("No initialization marker before timeout")
    }
    e.stop(&p.id).await?;
    for _ in 0..20 {
        if !e.snapshot().await.running.contains(&p.id) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    println!("PASS: {mode}: real installation, Java launch, game initialization and process stop");
    Ok(())
}
