//! Real provider + isolated P2P integration. Never starts Java or executes a mod.
use super::*;
use aurum_social::{sandbox::Container, service::Service};
use std::sync::{atomic::AtomicBool, Arc};
pub async fn run(root: PathBuf) -> Result<()> {
    let root = root.join(uuid::Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&root).await?;
    let worker = std::env::current_exe()?.with_file_name("aurum-social-worker.exe");
    if !worker.is_file() {
        bail!("Build aurum-social-worker before running the core lab");
    }
    let runtime = root.join("runtime");
    tokio::fs::create_dir_all(&runtime).await?;
    let target = runtime.join("aurum-social-worker.exe");
    tokio::fs::copy(&worker, &target).await?;
    for name in ["Aurum.Social.LabA.v1", "Aurum.Social.LabB.v1"] {
        let container = Container::open(name)?;
        container.allow_runtime_read(&runtime)?;
        container.allow_runtime_read(&target)?;
    }
    let mut engine = Engine::new(root.join("data"), |_| {}).await?;
    engine.social = Arc::new(Service::laboratory(crate::layout::app_path(&engine.root, "social"), 1)?);
    let source = Service::laboratory(root.join("sender"), 0)?;
    source.set_privacy(aurum_social::store::Privacy {
        public_relays: false,
        ..Default::default()
    })?;
    engine.social.set_privacy(aurum_social::store::Privacy {
        public_relays: false,
        ..Default::default()
    })?;
    source.enable(target.clone(), "Provider lab sender".into(), true)?;
    engine
        .social
        .enable(target, "Provider lab receiver".into(), true)?;
    wait(|| {
        Ok(source.snapshot()?.contact_link.is_some()
            && engine.social.snapshot()?.contact_link.is_some())
    })
    .await?;
    let sender = source.snapshot()?.id.context("Missing sender ID")?;
    let receiver = engine
        .social
        .snapshot()?
        .id
        .context("Missing receiver ID")?;
    source.add(
        engine
            .social
            .snapshot()?
            .contact_link
            .context("Missing receiver ticket")?,
    )?;
    wait(|| {
        Ok(engine
            .social
            .snapshot()?
            .people
            .iter()
            .any(|p| p.id == sender && p.state == "incoming"))
    })
    .await?;
    engine.social.relationship(sender.clone(), "accept")?;
    wait(|| {
        Ok(source
            .snapshot()?
            .people
            .iter()
            .any(|p| p.id == receiver && p.state == "friend"))
    })
    .await?;
    // The fixed public project is Fabric API. Fetch an actual compatible version.
    let versions = engine
        .mr_versions("P7dR8mSH", Some("1.21.1"), Some("fabric"))
        .await?;
    let version = versions
        .first()
        .context("No compatible public Fabric API version")?;
    let file = version["files"]
        .as_array()
        .and_then(|files| {
            files
                .iter()
                .find(|f| f["primary"] == true)
                .or_else(|| files.first())
        })
        .context("Missing real provider file")?;
    let source_ref = Source {
        provider: "modrinth".into(),
        project_id: "P7dR8mSH".into(),
        version_id: version["id"]
            .as_str()
            .context("Missing real version ID")?
            .into(),
    };
    let filename = file["filename"]
        .as_str()
        .context("Missing real filename")?
        .to_owned();
    let bytes = file["size"].as_u64().context("Missing real size")?;
    if bytes > 20 * 1024 * 1024 {
        bail!("Public lab fixture exceeds the explicit 20 MiB download cap");
    }
    let item = PlanItem {
        path: format!("mods/{filename}"),
        name: "Fabric API".into(),
        bytes,
        sha256: None,
        sha1: file["hashes"]["sha1"]
            .as_str()
            .context("Missing provider SHA-1")?
            .into(),
        source: Some(source_ref.clone()),
        url: Some(file["url"].as_str().context("Missing real CDN URL")?.into()),
        page: String::new(),
        config: None,
        required: false,
    };
    let task = make_task(Arc::new(AtomicBool::new(false)), false);
    let file_path = root.join("provider-download.jar");
    download_bounded(item.url.as_deref().unwrap(), &file_path, &item, &task).await?;
    report(
        "Real Modrinth metadata, approved CDN and provider integrity hash",
        serde_json::json!({"provider":"modrinth","bytes":bytes,"executed":false}),
    );
    let original = engine
        .create_profile(
            "Source fixture".into(),
            "1.21.1".into(),
            Loader::Fabric,
            Some("0.16.9".into()),
            0,
        )
        .await?;
    let game = engine.instance(&original.id)?;
    tokio::fs::create_dir_all(game.join("mods")).await?;
    tokio::fs::create_dir_all(game.join("config")).await?;
    tokio::fs::create_dir_all(game.join("saves/world")).await?;
    tokio::fs::copy(&file_path, game.join(&item.path)).await?;
    tokio::fs::write(
        game.join("mods/manual-fixture.jar"),
        b"manual fixture; not an executable mod",
    )
    .await?;
    tokio::fs::write(game.join("config/plain.toml"), b"enabled=true").await?;
    tokio::fs::write(game.join("config/private.toml"), b"api_key=test-fixture").await?;
    tokio::fs::write(
        game.join("saves/world/level.dat"),
        b"world fixture must remain local",
    )
    .await?;
    {
        let mut db = engine.db.lock().await;
        let p = db
            .profiles
            .iter_mut()
            .find(|p| p.id == original.id)
            .unwrap();
        p.content.push(Content {
            id: "modrinth:P7dR8mSH".into(),
            source: "modrinth".into(),
            project_id: source_ref.project_id,
            version_id: source_ref.version_id,
            name: "Fabric API".into(),
            filename: filename.clone(),
            kind: "mod".into(),
            enabled: true,
            info: ContentInfo {
                sha1: item.sha1.clone(),
                ..Default::default()
            },
        });
        crate::store::persist(&engine.root, &db).await?;
    }
    let export = engine.social_export(&original.id, true, false).await?;
    if export
        .manifest
        .files
        .iter()
        .any(|f| f.path.starts_with("saves/") || f.path == "config/private.toml")
    {
        bail!("Private data escaped the export allowlist");
    }
    let tcp = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
    let address = tcp.local_addr()?;
    let listener = aurum_social::listeners::for_pid(std::process::id())?
        .into_iter()
        .find(|l| l.address == address)
        .context("Missing lab listener")?;
    let world = WorldSpec {
        name: export.manifest.name.clone(),
        minecraft: export.manifest.minecraft.clone(),
        loader: export.manifest.loader.clone(),
        loader_version: export.manifest.loader_version.clone(),
    };
    source.invite(&receiver, world, listener, Some(export.manifest))?;
    wait(|| {
        Ok(engine
            .social
            .snapshot()?
            .invitations
            .iter()
            .any(|i| i.manifest.is_some()))
    })
    .await?;
    let invitation = engine
        .social
        .snapshot()?
        .invitations
        .into_iter()
        .find(|i| i.manifest.is_some())
        .unwrap();
    let review = engine.social_plan(&invitation.offer.id).await?;
    let installed = engine.social_install(&review.id, &task, true).await?;
    if installed.profile_id == original.id || installed.missing != 1 {
        bail!("Install did not create an independent profile with its manual file requirement");
    }
    let installed_root = engine.instance(&installed.profile_id)?;
    if !verify_item(&installed_root.join(&item.path), &item).await? {
        bail!("Installed provider file failed integrity verification");
    }
    if installed_root.join("saves").exists() || installed_root.join("config/private.toml").exists()
    {
        bail!("Disallowed files were installed");
    }
    let cache = engine.root.join("cache/social-content");
    let cache_before = std::fs::read_dir(&cache)?.count();
    report(
        "Real P2P manifest, provider resolution, cache and separate staged profile",
        serde_json::json!({"profileWasSeparate":true,"manualFiles":installed.missing,"worldsCopied":false,"secretsCopied":false,"minecraftLaunched":false}),
    );
    // A new reviewed plan with an intentional cancellation after progress starts.
    tokio::time::sleep(Duration::from_secs(1)).await;
    let review2 = engine.social_plan(&invitation.offer.id).await?;
    let cancel = Arc::new(AtomicBool::new(false));
    let cancelled_task = make_task(cancel.clone(), true);
    let before = engine.db.lock().await.profiles.len();
    if engine
        .social_install(&review2.id, &cancelled_task, true)
        .await
        .is_ok()
    {
        bail!("Cancelled install unexpectedly succeeded");
    }
    if engine.db.lock().await.profiles.len() != before {
        bail!("Cancelled install published a profile");
    }
    let resumed = engine.social_install(&review2.id, &task, true).await?;
    if resumed.profile_id == original.id || std::fs::read_dir(&cache)?.count() != cache_before {
        bail!("Resume modified the original profile or did not reuse cache");
    }
    if tokio::fs::read(game.join("saves/world/level.dat")).await?
        != b"world fixture must remain local"
    {
        bail!("Original world changed");
    }
    report(
        "Cancellation, retained verified cache and journal recovery",
        serde_json::json!({"cancelledProfilePublished":false,"cacheReused":true,"sourceWorldUnchanged":true}),
    );
    source.disable()?;
    engine.social.disable()?;
    drop(tcp);
    report(
        "Independent brokers and network workers shut down",
        serde_json::json!({}),
    );
    Ok(())
}
async fn wait(condition: impl Fn() -> Result<bool>) -> Result<()> {
    let until = tokio::time::Instant::now() + Duration::from_secs(30);
    while tokio::time::Instant::now() < until {
        if condition()? {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    bail!("Timed out waiting for a real isolated peer transition")
}
fn make_task(cancel: Arc<AtomicBool>, cancel_on_progress: bool) -> Task {
    let flag = cancel.clone();
    Task {
        id: uuid::Uuid::new_v4().to_string(),
        profile_id: None,
        cancel,
        emit: Arc::new(move |event| {
            if cancel_on_progress && event.phase == "content" {
                flag.store(true, Ordering::Release);
            }
        }),
    }
}
fn report(test: &str, details: serde_json::Value) {
    println!(
        "{}",
        serde_json::json!({"test":test,"status":"PASS","details":details})
    );
}
