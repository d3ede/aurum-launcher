use auren_core::{
    hosting::{inspect, HostingUpdate},
    Engine,
};
use std::{path::PathBuf, time::Duration};

#[tokio::test]
#[ignore = "requires AURUM_PROCESS_TEST_JAVA pointing to a JDK; runs only an isolated generic Java console fixture"]
async fn hosting_supervises_only_owned_java_and_handles_commands_restart_and_stop() {
    let java = PathBuf::from(
        std::env::var_os("AURUM_PROCESS_TEST_JAVA").expect("Set AURUM_PROCESS_TEST_JAVA"),
    );
    let binaries = java.parent().unwrap();
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.test-data");
    std::fs::create_dir_all(&workspace).unwrap();
    let fixture = tempfile::Builder::new()
        .prefix("hosting-java-")
        .tempdir_in(&workspace)
        .unwrap();
    let server = fixture.path().join("server");
    std::fs::create_dir(&server).unwrap();
    std::fs::write(
        server.join("ConsoleFixture.java"),
        r#"
import java.io.*;
public class ConsoleFixture {
  public static void main(String[] arguments) throws Exception {
    System.out.println("Done (0.1s)! Generic console fixture, not Minecraft");
    System.out.println("[12:00:00] [Server thread/INFO]: TestPlayer joined the game");
    BufferedReader input = new BufferedReader(new InputStreamReader(System.in));
    for (String line; (line = input.readLine()) != null;) {
      System.out.println("Received: " + line);
      if (line.equals("stop")) return;
      if (line.equals("crash")) System.exit(7);
    }
  }
}
"#,
    )
    .unwrap();
    for (tool, arguments) in [
        ("javac.exe", vec!["ConsoleFixture.java"]),
        (
            "jar.exe",
            vec![
                "--create",
                "--file",
                "paper-fixture.jar",
                "--main-class",
                "ConsoleFixture",
                "ConsoleFixture.class",
            ],
        ),
    ] {
        let mut command = tokio::process::Command::new(binaries.join(tool));
        command.current_dir(&server).args(arguments);
        auren_core::minecraft::hide(&mut command);
        assert!(command.output().await.unwrap().status.success());
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    std::fs::write(
        server.join("server.properties"),
        format!("server-ip=127.0.0.1\nserver-port={port}\nrcon.password=private-fixture\n"),
    )
    .unwrap();
    std::fs::write(server.join("eula.txt"), "eula=true\n").unwrap();
    let engine = Engine::new(fixture.path().join("data"), |_| {})
        .await
        .unwrap();
    let scan = inspect(&server).unwrap();
    let profile = engine
        .hosting_import(server, vec![scan.candidates[0].id.clone()])
        .await
        .unwrap()
        .remove(0);
    let settings = engine.hosting_settings(&profile.id).await.unwrap();
    let update = HostingUpdate {
        name: profile.name.clone(),
        description: String::new(),
        java_major: 25,
        java_path: java.to_string_lossy().into(),
        ram_mb: 512,
        jvm_args: String::new(),
        icon: profile.icon.clone(),
        settings,
    };
    engine
        .hosting_update(&profile.id, update.clone())
        .await
        .unwrap();
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), None)
        .await
        .unwrap();
    engine.hosting_start(&profile.id, &task).await.unwrap();
    assert!(engine.hosting_start(&profile.id, &task).await.is_err());
    assert!(engine.hosting_remove(&profile.id).await.is_err());
    assert!(engine.hosting_update(&profile.id, update).await.is_err());
    let result: anyhow::Result<()> = async {
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                if engine
                    .hosting_console(&profile.id, 0)
                    .await
                    .unwrap()
                    .live
                    .players
                    .contains(&"TestPlayer".into())
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await?;
        engine
            .hosting_player_action(&profile.id, "TestPlayer", "op", "")
            .await?;
        assert!(engine
            .hosting_player_action(&profile.id, "TestPlayer\nstop", "op", "")
            .await
            .is_err());
        assert!(engine
            .hosting_control(&profile.id, "command", "list\nstop")
            .await
            .is_err());
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(engine
            .hosting_console(&profile.id, 0)
            .await?
            .lines
            .iter()
            .any(|line| line.message == "Received: op TestPlayer"));
        engine.hosting_restart(&profile.id, &task).await?;
        engine.hosting_control(&profile.id, "stop", "").await?;
        tokio::time::timeout(Duration::from_secs(10), async {
            while !engine.hosting_running().is_empty() {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await?;
        assert_eq!(engine.hosting_profiles().await?[0].launches, 2);
        engine.hosting_start(&profile.id, &task).await?;
        engine.hosting_control(&profile.id, "kill", "").await?;
        tokio::time::timeout(Duration::from_secs(10), async {
            while !engine.hosting_running().is_empty() {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await?;
        Ok(())
    }
    .await;
    if !engine.hosting_running().is_empty() {
        let _ = engine.hosting_control(&profile.id, "kill", "").await;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    result.unwrap();
    assert!(engine.hosting_running().is_empty());
}

#[test]
#[ignore = "read-only diagnostic; requires AURUM_HOSTING_INSPECT_ROOT selected explicitly by the user"]
fn inspect_existing_folder_without_modifying_it() {
    let root = PathBuf::from(
        std::env::var_os("AURUM_HOSTING_INSPECT_ROOT").expect("Set AURUM_HOSTING_INSPECT_ROOT"),
    );
    let result = inspect(&root).unwrap();
    for candidate in &result.candidates {
        println!(
            "{}: {} {}, Java {}+, {}",
            candidate.name,
            candidate.core,
            candidate.version,
            candidate.java_major,
            candidate.directory
        );
    }
    assert!(!result.candidates.is_empty());
}
