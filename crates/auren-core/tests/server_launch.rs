use auren_core::{minecraft::hide, model::Loader, Engine};
use serde_json::json;
use std::{io::Write, path::Path, time::Duration};

#[tokio::test]
#[ignore = "requires AURUM_PROCESS_TEST_JAVA; starts only isolated argument-capture fixtures"]
async fn modern_and_legacy_server_launches_use_the_right_arguments() {
    let java = std::env::var_os("AURUM_PROCESS_TEST_JAVA")
        .expect("Set AURUM_PROCESS_TEST_JAVA to a JDK 21+");
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/server-launch");
    std::fs::create_dir_all(&directory).unwrap();
    let root = tempfile::tempdir_in(directory).unwrap();
    let source = root.path().join("ServerLaunchFixture.java");
    std::fs::write(&source, r#"class ServerLaunchFixture {
        public static void main(String[] args) throws Exception {
            java.nio.file.Files.writeString(java.nio.file.Path.of("captured-directory.txt"), System.getProperty("user.dir"));
            java.nio.file.Files.writeString(java.nio.file.Path.of("captured-args.txt"), String.join("\n", args));
            Thread.sleep(600000);
        }
    }"#).unwrap();
    let compiler =
        Path::new(&java).with_file_name(if cfg!(windows) { "javac.exe" } else { "javac" });
    let mut command = tokio::process::Command::new(compiler);
    command.arg(&source);
    hide(&mut command);
    assert!(command.status().await.unwrap().success());
    let engine = Engine::new(root.path().join("data"), |_| {}).await.unwrap();
    engine.add_offline("ServerFixture".into()).await.unwrap();
    engine.db.lock().await.settings.java_path = Path::new(&java).to_string_lossy().into();
    for (index, (version, target)) in [
        ("1.21.11", Some("example.org:25566")),
        ("1.21.11", None),
        ("1.19.4", Some("[::1]:25566")),
    ]
    .into_iter()
    .enumerate()
    {
        let profile = engine
            .create_profile(
                format!("Fixture {index}"),
                version.into(),
                Loader::Vanilla,
                None,
                0,
            )
            .await
            .unwrap();
        engine
            .db
            .lock()
            .await
            .profiles
            .iter_mut()
            .find(|entry| entry.id == profile.id)
            .unwrap()
            .installed_version = Some(version.into());
        let instance = engine.profile_directory(&profile.id).await.unwrap();
        let minimap = instance.join("config/xaero/minimap/profiles/default.cfg");
        std::fs::create_dir_all(minimap.parent().unwrap()).unwrap();
        let minimap_settings = b"profile_name = Default\ndisplay_minimap = false\n";
        let game_settings = b"lang:ru_ru\nfov:0.5\n";
        std::fs::write(&minimap, minimap_settings).unwrap();
        std::fs::write(instance.join("options.txt"), game_settings).unwrap();
        std::fs::create_dir_all(instance.join("client")).unwrap();
        let mut client = zip::ZipWriter::new(
            std::fs::File::create(instance.join("client").join(format!("{version}.jar"))).unwrap(),
        );
        client
            .start_file(
                "ServerLaunchFixture.class",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        client
            .write_all(&std::fs::read(source.with_extension("class")).unwrap())
            .unwrap();
        client.finish().unwrap();
        let game = if version == "1.21.11" {
            json!([
                "--gameDir", "${game_directory}",
                {"rules":[{"action":"allow","features":{"has_quick_plays_support":true}}],"value":["--quickPlayPath","${quickPlayPath}"]},
                {"rules":[{"action":"allow","features":{"is_quick_play_multiplayer":true}}],"value":["--quickPlayMultiplayer","${quickPlayMultiplayer}"]}
            ])
        } else {
            json!(["--gameDir", "${game_directory}"])
        };
        std::fs::write(instance.join("launch.json"), serde_json::to_vec(&json!({"id":version,"mainClass":"ServerLaunchFixture","libraries":[],"assetIndex":{"id":"fixture"},"javaVersion":{"majorVersion":21},"arguments":{"jvm":["-cp","${classpath}"],"game":game}})).unwrap()).unwrap();
        if let Some(address) = target {
            engine.launch_to_server(&profile.id, address).await.unwrap();
        } else {
            engine.launch(&profile.id).await.unwrap();
        }
        let captured = instance.join("captured-args.txt");
        let ready = tokio::time::timeout(Duration::from_secs(10), async {
            while !captured.exists() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await;
        engine.stop(&profile.id).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while engine.running.lock().await.contains_key(&profile.id) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        ready.unwrap();
        let text = std::fs::read_to_string(captured).unwrap();
        let mut arguments: Vec<_> = text.lines().collect();
        assert_eq!(arguments.remove(0), "--gameDir");
        assert_eq!(Path::new(arguments.remove(0)), instance);
        let working_directory =
            std::fs::read_to_string(instance.join("captured-directory.txt")).unwrap();
        assert_eq!(
            std::fs::canonicalize(working_directory).unwrap(),
            std::fs::canonicalize(&instance).unwrap()
        );
        assert_eq!(std::fs::read(&minimap).unwrap(), minimap_settings);
        assert_eq!(
            std::fs::read(instance.join("options.txt")).unwrap(),
            game_settings
        );
        if version == "1.21.11" {
            assert_eq!(
                arguments
                    .iter()
                    .filter(|argument| **argument == "--quickPlayPath")
                    .count(),
                1
            );
            assert_eq!(
                arguments
                    .iter()
                    .filter(|argument| **argument == "--quickPlayMultiplayer")
                    .count(),
                usize::from(target.is_some())
            );
            assert!(!arguments.contains(&"--server"));
            if target.is_some() {
                assert!(arguments.contains(&"example.org:25566"));
            }
        } else {
            assert_eq!(arguments, ["--server", "::1", "--port", "25566"]);
        }
    }
    let history = engine.recent_servers().await.unwrap();
    assert_eq!(history.len(), 2);
}
