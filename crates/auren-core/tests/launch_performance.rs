use auren_core::{minecraft::hide, model::Loader, Engine};
use serde_json::json;
use std::{io::Write, path::Path, time::Instant};

#[test]
#[ignore = "manual startup log processing benchmark"]
#[allow(
    clippy::regex_creation_in_loops,
    reason = "Measures the pre-optimization baseline"
)]
fn measure_startup_log_redaction() {
    let lines: Vec<_> = (0..2000)
        .map(|index| {
            format!("[Render thread/INFO]: Loading resource {index} access_token=fixture-token")
        })
        .collect();
    let started = Instant::now();
    let mut expected = Vec::new();
    for line in &lines {
        let value = line.replace("fixture-token", "[REDACTED]");
        let pattern = regex::Regex::new(
            r"(?i)(access[_-]?token|refresh[_-]?token|authorization)([=: ]+)(?:Bearer\s+)?(\S+)",
        )
        .unwrap();
        expected.push(pattern.replace_all(&value, "$1$2[REDACTED]").into_owned());
    }
    println!(
        "2000 startup log lines, legacy per-line compilation: {:.2} ms",
        started.elapsed().as_secs_f64() * 1000.0
    );
    let started = Instant::now();
    for (line, expected) in lines.iter().zip(expected) {
        let redacted = auren_core::minecraft::redact(line, "fixture-token");
        assert!(!redacted.contains("fixture-token"));
        assert_eq!(redacted, expected);
        std::hint::black_box(redacted);
    }
    println!(
        "2000 startup log lines: {:.2} ms",
        started.elapsed().as_secs_f64() * 1000.0
    );
}

#[tokio::test]
#[ignore = "requires AURUM_PROCESS_TEST_JAVA pointing to a JDK; launches only an isolated fixture"]
async fn measure_launch_preparation() {
    let java = std::env::var_os("AURUM_PROCESS_TEST_JAVA").expect("Set AURUM_PROCESS_TEST_JAVA");
    let directory =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/launch-performance");
    std::fs::create_dir_all(&directory).unwrap();
    let root = tempfile::tempdir_in(directory).unwrap();
    let source = root.path().join("LaunchFixture.java");
    std::fs::write(&source, "class LaunchFixture { public static void main(String[] args) throws Exception { Thread.sleep(600000); } }").unwrap();
    let compiler =
        Path::new(&java).with_file_name(if cfg!(windows) { "javac.exe" } else { "javac" });
    let mut command = tokio::process::Command::new(compiler);
    command.arg(&source);
    hide(&mut command);
    assert!(command.status().await.unwrap().success());
    let engine = Engine::new(root.path().join("data"), |_| {}).await.unwrap();
    engine.add_offline("LaunchFixture".into()).await.unwrap();
    let profile = engine
        .create_profile(
            "Launch fixture".into(),
            "1.21.1".into(),
            Loader::Vanilla,
            None,
            0,
        )
        .await
        .unwrap();
    engine.db.lock().await.profiles[0].installed_version = Some("1.21.1".into());
    engine.db.lock().await.settings.java_path = Path::new(&java).to_string_lossy().into();
    let instance = engine.profile_directory(&profile.id).await.unwrap();
    std::fs::create_dir_all(instance.join("client")).unwrap();
    let mut client =
        zip::ZipWriter::new(std::fs::File::create(instance.join("client/1.21.1.jar")).unwrap());
    client
        .start_file(
            "LaunchFixture.class",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    client
        .write_all(&std::fs::read(source.with_extension("class")).unwrap())
        .unwrap();
    client.finish().unwrap();
    std::fs::create_dir_all(engine.root.join("libraries")).unwrap();
    let mut natives = zip::ZipWriter::new(
        std::fs::File::create(engine.root.join("libraries/fixture.jar")).unwrap(),
    );
    natives
        .start_file(
            "fixture.dll",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
    natives.write_all(&vec![42; 4 * 1024 * 1024]).unwrap();
    natives.finish().unwrap();
    std::fs::write(instance.join("launch.json"), serde_json::to_vec(&json!({
        "id": "1.21.1", "mainClass": "LaunchFixture", "javaVersion": {"majorVersion": 21},
        "assetIndex": {"id": "fixture"}, "arguments": {"jvm": ["-cp", "${classpath}"], "game": []},
        "libraries": [{"natives": {"windows": "fixture", "linux": "fixture", "osx": "fixture"}, "downloads": {"classifiers": {"fixture": {"path": "fixture.jar"}}}}]
    })).unwrap()).unwrap();
    let mut samples = vec![];
    for attempt in 0..8 {
        let started = Instant::now();
        engine.launch(&profile.id).await.unwrap();
        let elapsed = started.elapsed();
        println!(
            "launch preparation attempt {attempt}: {:.2} ms",
            elapsed.as_secs_f64() * 1000.0
        );
        samples.push(elapsed);
        engine.stop(&profile.id).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while engine.running.lock().await.contains_key(&profile.id) {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
    }
    samples.remove(0);
    samples.sort();
    println!(
        "warm launch preparation median: {:.2} ms",
        samples[samples.len() / 2].as_secs_f64() * 1000.0
    );
}
