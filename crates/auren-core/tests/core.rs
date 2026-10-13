use auren_core::{
    minecraft::{allowed, expand_args, maven_path, redact},
    model::*,
    safe_join,
    store::validate_jvm,
    Engine, Task,
};
use serde_json::json;
use std::io::Write;
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
fn task() -> Task {
    Task {
        id: uuid::Uuid::new_v4().to_string(),
        profile_id: None,
        cancel: Arc::new(AtomicBool::new(false)),
        emit: Arc::new(|_| {}),
    }
}
#[test]
fn archive_paths_cannot_escape() {
    for s in [
        "../secret",
        "a/../../secret",
        "/absolute",
        "C:/Windows/a",
        "a\\..\\b",
        "a:stream",
        "",
        "./a",
    ] {
        assert!(safe_join(Path::new("root"), s).is_err(), "{s}");
    }
    assert_eq!(
        safe_join(Path::new("root"), "mods/example.jar").unwrap(),
        Path::new("root/mods/example.jar")
    );
}
#[test]
fn maven_classifier_and_extension() {
    assert_eq!(
        maven_path("org.test:example:1.0:natives-windows").unwrap(),
        "org/test/example/1.0/example-1.0-natives-windows.jar"
    );
    assert_eq!(
        maven_path("org.test:example:1.0@zip").unwrap(),
        "org/test/example/1.0/example-1.0.zip"
    );
    assert!(maven_path("../secret").is_err());
}
#[test]
fn loader_merge_preserves_universal_and_client_classifiers(){
    let mut base=json!({"libraries":[{"name":"com.example:lib:1"}],"arguments":{"jvm":[],"game":[]}});
    auren_core::minecraft::merge(&mut base,json!({"libraries":[{"name":"com.example:lib:2"},{"name":"net.minecraftforge:forge:1.21.1-52:universal"},{"name":"net.minecraftforge:forge:1.21.1-52:client"}]}));
    assert_eq!(base["libraries"].as_array().unwrap().len(),3);
    assert_eq!(base["libraries"][0]["name"],"com.example:lib:2");
}
#[test]
fn ordered_rules_and_features() {
    let rules = json!({"rules":[{"action":"allow"},{"action":"disallow","features":{"is_demo_user":true}}]});
    assert!(allowed(&rules, &HashMap::new()));
    assert!(!allowed(
        &rules,
        &HashMap::from([("is_demo_user".into(), true)])
    ));
    assert!(!allowed(&json!({"rules":[]}), &HashMap::new()));
}
#[test]
fn arguments_are_not_split_or_shell_interpolated() {
    let vars = HashMap::from([("classpath".into(), "C:/path with spaces/a.jar".into())]);
    let args=expand_args(&[json!("-cp"),json!("${classpath}"),json!({"rules":[{"action":"allow","features":{"has_custom_resolution":true}}],"value":["--width","1280"]})],&vars,&HashMap::new()).unwrap();
    assert_eq!(args, vec!["-cp", "C:/path with spaces/a.jar"]);
    assert!(expand_args(&[json!("${unknown}")], &vars, &HashMap::new()).is_err());
}
#[test]
fn jvm_memory_and_entrypoint_are_controlled() {
    for s in [
        "-Xmx8G",
        "-jar game.jar",
        "-cp anything",
        "--class-path x",
        "not-a-flag",
        "\"unterminated",
    ] {
        assert!(validate_jvm(s).is_err(), "{s}")
    }
    assert!(validate_jvm("-XX:+UseG1GC -Dname='hello world'").is_ok());
}
#[test]
fn access_tokens_never_reach_logs() {
    let actual = redact(
        "accessToken=secret-value Authorization: Bearer TOKEN abc123",
        "abc123",
    );
    assert!(!actual.contains("secret-value"));
    assert!(!actual.contains("abc123"));
}
#[test]
fn cancellation_is_explicit() {
    let t = task();
    assert!(t.check().is_ok());
    t.cancel.store(true, Ordering::Relaxed);
    assert!(t.check().is_err());
}
#[tokio::test]
async fn profile_persistence_and_world_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let p = e
        .create_profile("Test".into(), "1.21.1".into(), Loader::Vanilla, None, 0)
        .await
        .unwrap();
    std::fs::create_dir_all(e.instance(&p.id).unwrap().join("saves")).unwrap();
    std::fs::write(e.instance(&p.id).unwrap().join("saves/world.dat"), b"world").unwrap();
    let another = e
        .create_profile("Second".into(), "1.21.1".into(), Loader::Vanilla, None, 1)
        .await
        .unwrap();
    assert_ne!(e.instance(&p.id).unwrap(), e.instance(&another.id).unwrap());
    let restored = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    assert_eq!(restored.snapshot().await.database.profiles.len(), 2);
    restored.delete_profile(&p.id).await.unwrap();
    assert!(walkdir::WalkDir::new(dir.path().join("trash"))
        .into_iter()
        .flatten()
        .any(|e| e.file_name() == "world.dat"));
    assert_eq!(restored.snapshot().await.database.profiles.len(), 1);
}
#[tokio::test]
async fn offline_account_determinism_and_validation() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let a = e.add_offline("Steve".into()).await.unwrap();
    assert_eq!(a.uuid, "5627dd98e6be3c21b8a8e92344183641");
    assert!(e.add_offline("Steve".into()).await.is_err());
    assert!(e.add_offline("Имя".into()).await.is_err());
    e.delete_account(a.id).await.unwrap();
    assert!(e.snapshot().await.database.selected_account.is_none());
}
#[tokio::test]
async fn content_toggle_remove_and_local_discovery() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let p = e
        .create_profile(
            "Test".into(),
            "1.21.1".into(),
            Loader::Fabric,
            Some("0.16.0".into()),
            0,
        )
        .await
        .unwrap();
    let path = e.instance(&p.id).unwrap().join("mods");
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join("local.jar"), b"fake jar fixture").unwrap();
    let list = e.list_content(&p.id).await.unwrap();
    assert_eq!(list.len(), 1);
    e.manage_content(&p.id, &list[0].id, "toggle")
        .await
        .unwrap();
    assert!(path.join("local.jar.disabled").exists());
    assert!(!e.list_content(&p.id).await.unwrap()[0].enabled);
    e.manage_content(&p.id, &list[0].id, "remove")
        .await
        .unwrap();
    assert!(e.list_content(&p.id).await.unwrap().is_empty());
}
#[tokio::test]
async fn archives_roll_back_and_reject_traversal() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
    let path = dir.path().join("bad.mrpack");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("modrinth.index.json", options).unwrap();
    zip.write_all(json!({"formatVersion":1,"game":"minecraft","name":"Bad","dependencies":{"minecraft":"1.21.1"},"files":[]}).to_string().as_bytes()).unwrap();
    zip.start_file("overrides/../../escaped.txt", options)
        .unwrap();
    zip.write_all(b"escape").unwrap();
    zip.finish().unwrap();
    assert!(e.import_pack(&path, &task()).await.is_err());
    assert!(e.snapshot().await.database.profiles.is_empty());
    assert!(!dir.path().join("escaped.txt").exists());
}
#[tokio::test]
async fn mrpack_creates_isolated_profile_with_overrides() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
    let path = dir.path().join("ok.mrpack");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("modrinth.index.json", options).unwrap();
    zip.write_all(json!({"formatVersion":1,"game":"minecraft","name":"Pack","dependencies":{"minecraft":"1.21.1","fabric-loader":"0.16.0"},"files":[]}).to_string().as_bytes()).unwrap();
    zip.start_file("overrides/config/test.json", options)
        .unwrap();
    zip.write_all(b"server").unwrap();
    zip.start_file("client-overrides/config/test.json", options)
        .unwrap();
    zip.write_all(b"client").unwrap();
    zip.finish().unwrap();
    let id = e.import_pack(&path, &task()).await.unwrap();
    assert_eq!(e.profile(&id).await.unwrap().loader, Loader::Fabric);
    assert_eq!(
        std::fs::read(e.instance(&id).unwrap().join("config/test.json")).unwrap(),
        b"client"
    );
}
#[tokio::test]
async fn hashes_are_checked() {
    let file = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(file.path(), b"hello").unwrap();
    assert!(auren_core::net::verify(
        file.path(),
        Some(("sha1", "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"))
    )
    .await
    .unwrap());
    assert!(!auren_core::net::verify(file.path(), Some(("sha1", "bad")))
        .await
        .unwrap());
}
#[tokio::test]
async fn corrupted_database_is_never_reset() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("state.json"), b"broken").unwrap();
    assert!(Engine::new(dir.path().into(), |_| {}).await.is_err());
    assert_eq!(
        std::fs::read(dir.path().join("state.json")).unwrap(),
        b"broken"
    );
}
#[tokio::test]
async fn operation_ids_cannot_be_reused() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let t = e.task(id.clone(), None).await.unwrap();
    assert!(e.task(id.clone(), None).await.is_err());
    assert!(e.delete_profile("invalid").await.is_err());
    e.cancel(&id).await.unwrap();
    assert!(t.check().is_err());
    e.finish(&t, &Ok(())).await;
    assert!(e.task(id, None).await.is_ok());
}
