#![cfg(all(windows, feature = "social-lab"))]
use anyhow::{bail, Context, Result};
use aurum_core::{model::Loader, Engine, Task};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};
use tokio::io::AsyncReadExt;

async fn copy(source: &Path, destination: &Path) -> Result<()> {
    tokio::fs::create_dir_all(destination.parent().context("Missing destination parent")?).await?;
    tokio::fs::copy(source, destination).await?;
    Ok(())
}
fn varint(bytes: &[u8], offset: &mut usize) -> Result<u32> {
    let mut value = 0;
    for shift in (0..35).step_by(7) {
        let b = *bytes.get(*offset).context("Incomplete VarInt")?;
        *offset += 1;
        value |= ((b & 127) as u32) << shift;
        if b & 128 == 0 {
            return Ok(value);
        }
    }
    bail!("Oversized VarInt")
}
async fn packet(stream: &mut tokio::net::TcpStream) -> Result<Vec<u8>> {
    let mut prefix = vec![];
    loop {
        let b = stream.read_u8().await?;
        prefix.push(b);
        if b & 128 == 0 {
            break;
        }
        if prefix.len() >= 5 {
            bail!("Bad frame");
        }
    }
    let length = varint(&prefix, &mut 0)? as usize;
    if length > 4096 {
        bail!("Handshake exceeds limit");
    }
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).await?;
    Ok(bytes)
}

#[tokio::test]
#[ignore = "requires explicit official Minecraft cache/meta/client/JDK paths; launches a real client only in .test-data"]
async fn real_minecraft_automatically_opens_the_native_lan_connection() -> Result<()> {
    let env = |name| {
        std::env::var_os(name)
            .map(PathBuf::from)
            .with_context(|| format!("Set {name}"))
    };
    let cache = env("AURUM_LAN_FIXTURE_CACHE")?;
    let meta_path = env("AURUM_LAN_FIXTURE_META")?;
    let client = env("AURUM_LAN_FIXTURE_CLIENT")?;
    let java = env("AURUM_LAN_FIXTURE_JAVA")?;
    let meta: serde_json::Value = serde_json::from_slice(&tokio::fs::read(meta_path).await?)?;
    let version = std::env::var("AURUM_LAN_FIXTURE_VERSION")?;
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/lan-autojoin");
    tokio::fs::create_dir_all(&fixture).await?;
    let directory = tempfile::tempdir_in(fixture)?;
    let root = directory.path().join("data");
    let engine = Engine::new(root.clone(), |_| {}).await?;
    engine.add_offline("AurumLanProbe".into()).await?;
    {
        let mut db = engine.db.lock().await;
        db.settings.java_path = java.to_string_lossy().into();
        db.settings.ram_mb = 2048;
        db.settings.resolution_width = 854;
        db.settings.resolution_height = 480;
    }
    let profile = engine
        .create_profile(
            "LAN autoconnect probe".into(),
            version.clone(),
            Loader::Vanilla,
            None,
            0,
        )
        .await?;
    engine
        .db
        .lock()
        .await
        .profiles
        .iter_mut()
        .find(|p| p.id == profile.id)
        .unwrap()
        .installed_version = Some(version.clone());
    let instance = engine.profile_directory(&profile.id).await?;
    copy(
        &client,
        &instance
            .join("client")
            .join(format!("{}.jar", meta["id"].as_str().unwrap())),
    )
    .await?;
    tokio::fs::write(instance.join("launch.json"), serde_json::to_vec(&meta)?).await?;
    tokio::fs::write(instance.join("options.txt"), "onboardAccessibility:false\njoinedFirstServer:true\nskipMultiplayerWarning:true\ntelemetryOptInExtra:false\nfullscreen:false\nmaxFps:60\nrenderDistance:2\n").await?;
    for library in meta["libraries"].as_array().context("Missing libraries")? {
        if !aurum_core::minecraft::library_allowed(library, &HashMap::new()) {
            continue;
        }
        if let Some(path) = library["downloads"]["artifact"]["path"].as_str() {
            copy(
                &cache.join("libraries").join(path),
                &root.join("libraries").join(path),
            )
            .await?;
        } else if library.get("downloads").is_none() {
            let path = aurum_core::minecraft::maven_path(
                library["name"]
                    .as_str()
                    .context("Missing library coordinate")?,
            )?;
            copy(
                &cache.join("libraries").join(&path),
                &root.join("libraries").join(path),
            )
            .await?;
        }
        if let Some(classifier) = library["natives"]["windows"].as_str() {
            let classifier = classifier.replace("${arch}", "64");
            if let Some(path) = library["downloads"]["classifiers"][classifier]["path"].as_str() {
                copy(
                    &cache.join("libraries").join(path),
                    &root.join("libraries").join(path),
                )
                .await?;
            }
        }
    }
    let index = meta["assetIndex"]["id"]
        .as_str()
        .context("Missing asset index")?;
    let path = PathBuf::from("assets/indexes").join(format!("{index}.json"));
    copy(&cache.join(&path), &root.join(path)).await?;
    let assets: serde_json::Value = serde_json::from_slice(
        &tokio::fs::read(root.join(format!("assets/indexes/{index}.json"))).await?,
    )?;
    for (name, asset) in assets["objects"].as_object().context("Missing objects")? {
        if name.ends_with(".ogg") {
            continue;
        } // Missing optional audio never modifies the source cache.
        let hash = asset["hash"].as_str().context("Missing object hash")?;
        let path = PathBuf::from("assets/objects").join(&hash[..2]).join(hash);
        copy(&cache.join(&path), &root.join(path)).await?;
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let task = Task {
        id: uuid::Uuid::new_v4().to_string(),
        profile_id: Some(profile.id.clone()),
        cancel: Arc::new(AtomicBool::new(false)),
        emit: Arc::new(|_| {}),
    };
    let result: Result<()> = async {
        if !engine.launch_lan_fixture(&profile.id, &format!("127.0.0.1:{port}"), &task).await? { bail!("Automatic native LAN launch was not enabled"); }
        if version == "26.3" { verify_actual_lan_entry(&java, &root, &instance, &meta).await?; }
        let (mut client, _) = tokio::time::timeout(Duration::from_secs(180), listener.accept()).await.context("Real Minecraft never connected automatically")??;
        let bytes = tokio::time::timeout(Duration::from_secs(10), packet(&mut client)).await??;
        let mut offset = 0;
        assert_eq!(varint(&bytes, &mut offset)?, 0);
        assert!(varint(&bytes, &mut offset)? > 0);
        let host_len = varint(&bytes, &mut offset)? as usize;
        let host = std::str::from_utf8(bytes.get(offset..offset+host_len).context("Missing hostname")?)?; offset += host_len;
        assert_eq!(host, "127.0.0.1");
        assert_eq!(u16::from_be_bytes([bytes[offset],bytes[offset+1]]), port); offset += 2;
        assert_eq!(varint(&bytes, &mut offset)?, 2, "The client must enter login, not merely ping the LAN list");
        let login = tokio::time::timeout(Duration::from_secs(10), packet(&mut client)).await??;
        assert_eq!(varint(&login, &mut 0)?, 0);
        println!("PASS: the actual Minecraft client automatically sent LAN login to the owned loopback fixture, without menu interaction");
        Ok(())
    }.await;
    let _ = engine.stop(&profile.id).await;
    for _ in 0..100 {
        if !engine.running.lock().await.contains_key(&profile.id) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if result.is_err() {
        let state = tokio::fs::read_to_string(instance.join(".aurum/social/agent-state"))
            .await
            .unwrap_or_default();
        eprintln!("Agent state: {}", state.trim());
        if let Ok(log) = tokio::fs::read_to_string(instance.join("aurum-latest.log")).await {
            for line in log
                .lines()
                .rev()
                .take(18)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
            {
                eprintln!("{line}");
            }
        }
    }
    result
}

async fn verify_actual_lan_entry(
    java: &Path,
    root: &Path,
    instance: &Path,
    meta: &serde_json::Value,
) -> Result<()> {
    let source = instance.join("AurumLanTypeProbe.java");
    tokio::fs::write(&source, r#"public class AurumLanTypeProbe {
      public static void main(String[] args) throws Exception {
        net.minecraft.SharedConstants.tryDetectVersion();
        Object entry = app.aurum.social.LanJoinAgent.lanEntry(net.minecraft.client.multiplayer.ServerData.class,"Aurum","127.0.0.1:25565");
        if (!((net.minecraft.client.multiplayer.ServerData) entry).isLan()) throw new AssertionError("Lost native LAN semantics");
        Object address = app.aurum.social.LanJoinAgent.parseAddress(net.minecraft.client.multiplayer.resolver.ServerAddress.class,"127.0.0.1:25565");
        if (((net.minecraft.client.multiplayer.resolver.ServerAddress)address).getPort()!=25565) throw new AssertionError("Wrong bridge port");
        System.out.println("PASS: agent constructs actual Minecraft ServerData with isLan() = true");
      }
    }"#).await?;
    let mut paths = vec![
        instance.to_path_buf(),
        instance
            .join("client")
            .join(format!("{}.jar", meta["id"].as_str().unwrap())),
    ];
    for directory in [root.join("libraries"), instance.join(".aurum/social")] {
        for entry in walkdir::WalkDir::new(directory).follow_links(false) {
            let entry = entry?;
            if entry.file_type().is_file() && entry.path().extension().is_some_and(|e| e == "jar") {
                paths.push(entry.into_path());
            }
        }
    }
    let classpath = std::env::join_paths(paths)?;
    let mut compile = tokio::process::Command::new(java.with_file_name("javac.exe"));
    compile.arg("-classpath").arg(&classpath).arg(&source);
    aurum_core::minecraft::hide(&mut compile);
    if !compile.status().await?.success() {
        bail!("Actual Minecraft LAN entry probe did not compile");
    }
    let mut probe = tokio::process::Command::new(java);
    probe
        .arg("-classpath")
        .arg(classpath)
        .arg("AurumLanTypeProbe")
        .current_dir(instance);
    aurum_core::minecraft::hide(&mut probe);
    if !probe.status().await?.success() {
        bail!("Agent lost Minecraft LAN semantics");
    }
    Ok(())
}
