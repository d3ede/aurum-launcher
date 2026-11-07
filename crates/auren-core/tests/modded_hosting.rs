//! Explicit network smoke test; all server data stays in the repository's .test-data.
use anyhow::{bail, Result};
use auren_core::{hosting::HostingInstall, Engine};
use std::{path::PathBuf, time::Duration};

#[tokio::test]
#[ignore = "downloads official server distributions and starts isolated loopback servers"]
async fn official_modded_servers_install_start_and_stop() -> Result<()> {
    let root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/modded-hosting-smoke");
    tokio::fs::create_dir_all(&root).await?;
    let root = root.canonicalize()?;
    let engine = Engine::new(root.clone(), |event| {
        if !matches!(event.phase.as_str(), "log" | "hosting-changed") {
            println!("{}: {}", event.phase, event.message);
        }
    })
    .await?;
    for core in ["fabric", "forge", "neoforge"] {
        println!("SMOKE installing {core}");
        let profiles = engine.hosting_profiles().await?;
        let profile = if let Some(profile) = profiles
            .into_iter()
            .find(|p| p.core == core && p.version == "1.21.1")
        {
            profile
        } else {
            let task = engine.task(uuid::Uuid::new_v4().to_string(), None).await?;
            let profile = engine
                .hosting_install(
                    HostingInstall {
                        name: format!("Smoke {core}"),
                        core: core.into(),
                        version: "1.21.1".into(),
                        loader_version: None,
                        accept_eula: true,
                        experimental: false,
                        ram_mb: 1024,
                    },
                    &task,
                )
                .await?;
            engine.finish(&task, &Ok(())).await;
            profile
        };
        assert!(profile.root.starts_with(&root));
        assert!(profile.root.join("mods").is_dir());
        assert!(profile.root.join(&profile.entrypoint).is_file());
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        drop(listener);
        tokio::fs::write(profile.root.join("server.properties"), format!("server-ip=127.0.0.1\nserver-port={port}\nonline-mode=true\nmax-players=2\nview-distance=2\nsimulation-distance=2\nspawn-protection=0\nlevel-type=minecraft:flat\ngenerate-structures=false\n")).await?;
        let task = engine.task(uuid::Uuid::new_v4().to_string(), None).await?;
        engine.hosting_start(&profile.id, &task).await?;
        engine.finish(&task, &Ok(())).await;
        let readiness = tokio::time::timeout(Duration::from_secs(180), async {
            loop {
                let console = engine.hosting_console(&profile.id, 0).await?;
                if console.live.status == "running" {
                    return Ok::<_, anyhow::Error>(());
                }
                if console.live.status == "crashed" || console.live.status == "stopped" {
                    bail!(
                        "{core} exited before readiness: {}",
                        console
                            .lines
                            .iter()
                            .map(|line| line.message.as_str())
                            .collect::<Vec<_>>()
                            .join("\n")
                    );
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        })
        .await;
        let console = engine.hosting_console(&profile.id, 0).await?;
        if matches!(console.live.status.as_str(), "starting" | "running") {
            engine.hosting_control(&profile.id, "stop", "").await?;
        }
        let stopped = tokio::time::timeout(Duration::from_secs(45), async {
            while !matches!(
                engine
                    .hosting_console(&profile.id, 0)
                    .await?
                    .live
                    .status
                    .as_str(),
                "stopped" | "crashed"
            ) {
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            Ok::<_, anyhow::Error>(())
        })
        .await;
        if stopped.is_err() {
            let _ = engine.hosting_control(&profile.id, "kill", "").await;
        }
        match readiness {
            Ok(result) => result?,
            Err(_) => bail!(
                "{core} readiness timeout: {}",
                console
                    .lines
                    .iter()
                    .map(|line| line.message.as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
        }
        stopped??;
        println!("SMOKE {core}: installed, started, stopped");
    }
    Ok(())
}
