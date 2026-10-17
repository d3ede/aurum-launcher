#![cfg(windows)]

use auren_core::{hosting::inspect, Engine};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{io::Write, path::Path, time::Duration};

fn jar(path: &Path) {
    let mut archive = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    archive
        .start_file(
            "META-INF/MANIFEST.MF",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    archive
        .write_all(b"Main-Class: net.minecraft.server.Main\n")
        .unwrap();
    archive.finish().unwrap();
}

async fn until(mut predicate: impl AsyncFnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(30), async {
        while !predicate().await {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "runs only isolated PowerShell process-tree fixtures; never Minecraft or user scripts"]
async fn script_network_owns_descendants_after_parent_exit_and_never_kills_external_process() {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data");
    std::fs::create_dir_all(&workspace).unwrap();
    let fixture = tempfile::Builder::new()
        .prefix("network space & % ' ")
        .tempdir_in(workspace)
        .unwrap();
    let root = fixture.path();
    for (name, core) in [("hub", "paper"), ("proxy", "velocity")] {
        let folder = root.join(name);
        std::fs::create_dir(&folder).unwrap();
        jar(&folder.join(format!("{core}.jar")));
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        std::fs::write(
            folder.join(if core == "velocity" {
                "velocity.toml"
            } else {
                "server.properties"
            }),
            if core == "velocity" {
                format!("bind = \"127.0.0.1:{port}\"\n")
            } else {
                format!("server-port={port}\n")
            },
        )
        .unwrap();
    }
    let worker = STANDARD.encode("Set-Content -LiteralPath (Join-Path $env:AURUM_NETWORK_CWD 'worker.pid') -Value $PID; Start-Sleep -Seconds 90".encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>());
    std::fs::write(root.join("launch.ps1"), format!("Start-Process -FilePath ($PSHOME + '\\powershell.exe') -ArgumentList @('-NoProfile', '-EncodedCommand', '{worker}') -WindowStyle Hidden | Out-Null\nWrite-Output 'Fixture starter returned'\n")).unwrap();
    std::fs::write(
        root.join("start.bat"),
        "@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0launch.ps1\"\r\n",
    )
    .unwrap();
    let mut external_command = tokio::process::Command::new("powershell.exe");
    external_command
        .args(["-NoProfile", "-Command", "Start-Sleep -Seconds 90"])
        .kill_on_drop(true);
    auren_core::minecraft::hide(&mut external_command);
    let mut external = external_command.spawn().unwrap();
    let engine = Engine::new(root.join("data"), |_| {}).await.unwrap();
    let scan = inspect(root).unwrap();
    let profiles = engine
        .hosting_import(
            root.into(),
            scan.candidates
                .into_iter()
                .map(|candidate| candidate.id)
                .collect(),
        )
        .await
        .unwrap();
    let id = &profiles[0].id;
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), None)
        .await
        .unwrap();
    let trust = engine.hosting_script_trust(id).await.unwrap();
    engine.hosting_trust_script(id, &trust.hash).await.unwrap();
    engine.hosting_start(id, &task).await.unwrap();
    let result = async {
        until(async || root.join("worker.pid").exists()).await;
        until(async || {
            engine
                .hosting_console(id, 0)
                .await
                .unwrap()
                .lines
                .iter()
                .any(|line| line.message.contains("Fixture starter returned"))
        })
        .await;
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert!(engine.hosting_running().contains(id));
        assert!(engine.hosting_start(id, &task).await.is_err());
        assert!(engine.hosting_control(id, "command", "stop").await.is_err());
        engine.hosting_control(id, "kill", "").await.unwrap();
        until(async || !engine.hosting_running().contains(id)).await;
        assert!(external.try_wait().unwrap().is_none());
        let pid: u32 = std::fs::read_to_string(root.join("worker.pid"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let mut system = sysinfo::System::new();
        system.refresh_processes(
            sysinfo::ProcessesToUpdate::Some(&[sysinfo::Pid::from_u32(pid)]),
            true,
        );
        assert!(system.process(sysinfo::Pid::from_u32(pid)).is_none());
        engine.hosting_start(id, &task).await.unwrap();
        engine.hosting_control(id, "kill", "").await.unwrap();
        until(async || engine.hosting_running().is_empty()).await;
        std::fs::write(root.join("launch.ps1"), "Write-Output 'Waiting for console input'\n$line = [Console]::ReadLine()\nif ($null -eq $line) { Write-Output 'UNEXPECTED_EOF' } else { Write-Output ('Graceful command: ' + $line) }\n").unwrap();
        engine.hosting_start(id, &task).await.unwrap();
        until(async || {
            engine
                .hosting_console(id, 0)
                .await
                .unwrap()
                .lines
                .iter()
                .any(|line| line.message.contains("Waiting for console input"))
        })
        .await;
        tokio::time::sleep(Duration::from_secs(4)).await;
        let console = engine.hosting_console(id, 0).await.unwrap();
        assert!(
            engine.hosting_running().contains(id),
            "Aurum must keep script stdin open while the network is running"
        );
        assert!(!console
            .lines
            .iter()
            .any(|line| line.message.contains("UNEXPECTED_EOF")));
        engine.hosting_control(id, "stop", "").await.unwrap();
        until(async || engine.hosting_running().is_empty()).await;
        assert!(engine
            .hosting_console(id, 0)
            .await
            .unwrap()
            .lines
            .iter()
            .any(|line| line.message.contains("Graceful command: stop")));
    };
    result.await;
    let _ = external.kill().await;
}

#[tokio::test]
#[ignore = "requires AURUM_PROCESS_TEST_JAVA; runs isolated Java stdin fixtures only"]
async fn direct_network_starts_backends_before_proxy_and_stops_restarts_as_one() {
    use auren_core::hosting::HostingUpdate;
    let java = std::path::PathBuf::from(
        std::env::var_os("AURUM_PROCESS_TEST_JAVA").expect("Set AURUM_PROCESS_TEST_JAVA"),
    );
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data");
    std::fs::create_dir_all(&workspace).unwrap();
    let fixture = tempfile::tempdir_in(workspace).unwrap();
    let root = fixture.path();
    std::fs::write(root.join("NetworkFixture.java"), r#"
import java.io.*;
import java.nio.file.*;
public class NetworkFixture {
  public static void main(String[] arguments) throws Exception {
    String name = Path.of(System.getProperty("user.dir")).getFileName().toString();
    Files.writeString(Path.of(System.getProperty("fixture.order")), name + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    System.out.println("Done (0.1s)! Isolated network fixture");
    BufferedReader input = new BufferedReader(new InputStreamReader(System.in));
    for (String line; (line = input.readLine()) != null;) {
      System.out.println("Received: " + line);
      if (line.equals("stop") || line.equals("shutdown")) return;
    }
  }
}
"#).unwrap();
    for (tool, args) in [
        ("javac.exe", vec!["NetworkFixture.java"]),
        (
            "jar.exe",
            vec![
                "--create",
                "--file",
                "fixture.jar",
                "--main-class",
                "NetworkFixture",
                "NetworkFixture.class",
            ],
        ),
    ] {
        let mut command = tokio::process::Command::new(java.parent().unwrap().join(tool));
        command.current_dir(root).args(args);
        auren_core::minecraft::hide(&mut command);
        assert!(command.output().await.unwrap().status.success());
    }
    for (name, core) in [("hub", "paper"), ("proxy", "velocity")] {
        let folder = root.join(name);
        std::fs::create_dir(&folder).unwrap();
        std::fs::copy(root.join("fixture.jar"), folder.join(format!("{core}.jar"))).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        std::fs::write(
            folder.join(if core == "velocity" {
                "velocity.toml"
            } else {
                "server.properties"
            }),
            if core == "velocity" {
                format!("bind = \"127.0.0.1:{port}\"\n")
            } else {
                format!("server-port={port}\n")
            },
        )
        .unwrap();
        std::fs::write(folder.join("eula.txt"), "eula=true\n").unwrap();
    }
    let engine = Engine::new(root.join("data"), |_| {}).await.unwrap();
    let scan = inspect(root).unwrap();
    let added = engine
        .hosting_import(
            root.into(),
            scan.candidates
                .iter()
                .filter(|candidate| candidate.directory != ".")
                .map(|candidate| candidate.id.clone())
                .collect(),
        )
        .await
        .unwrap();
    assert_eq!(added.len(), 1);
    let id = &added[0].id;
    for profile in engine
        .hosting_profiles()
        .await
        .unwrap()
        .into_iter()
        .filter(|profile| profile.network.is_none())
    {
        engine
            .hosting_update(
                &profile.id,
                HostingUpdate {
                    name: profile.name.clone(),
                    description: profile.description.clone(),
                    java_major: 25,
                    java_path: java.to_string_lossy().into_owned(),
                    ram_mb: 512,
                    jvm_args: format!(
                        "-Dfixture.order=\"{}\"",
                        root.join("order.txt").to_string_lossy().replace('\\', "/")
                    ),
                    icon: profile.icon.clone(),
                    settings: engine.hosting_settings(&profile.id).await.unwrap(),
                },
            )
            .await
            .unwrap();
    }
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), None)
        .await
        .unwrap();
    engine.hosting_start(id, &task).await.unwrap();
    until(async || engine.hosting_console(id, 0).await.unwrap().live.status == "running").await;
    assert_eq!(
        std::fs::read_to_string(root.join("order.txt")).unwrap(),
        "hub\nproxy\n"
    );
    engine
        .hosting_control(id, "command", "glist")
        .await
        .unwrap();
    until(async || {
        engine
            .hosting_console(id, 0)
            .await
            .unwrap()
            .lines
            .iter()
            .any(|line| line.message.contains("[proxy] Received: glist"))
    })
    .await;
    engine.hosting_restart(id, &task).await.unwrap();
    engine.hosting_control(id, "stop", "").await.unwrap();
    until(async || engine.hosting_running().is_empty()).await;
    assert_eq!(
        std::fs::read_to_string(root.join("order.txt")).unwrap(),
        "hub\nproxy\nhub\nproxy\n"
    );
    assert_eq!(
        engine
            .hosting_profiles()
            .await
            .unwrap()
            .iter()
            .find(|profile| &profile.id == id)
            .unwrap()
            .launches,
        2
    );
}
