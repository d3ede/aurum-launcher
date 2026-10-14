use auren_core::{
    content_metadata::{describe_file, newer_version},
    model::*,
    Engine,
};
use serde_json::json;
use std::{io::Write, sync::atomic::Ordering};

fn item(filename: &str) -> Content {
    Content {
        id: format!("local:mod:{filename}"),
        source: "local".into(),
        project_id: String::new(),
        version_id: String::new(),
        name: filename.into(),
        filename: filename.into(),
        kind: "mod".into(),
        enabled: true,
        info: ContentInfo::default(),
    }
}
fn jar(path: &std::path::Path, entries: &[(&str, &[u8])]) {
    let mut archive = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    for (name, bytes) in entries {
        archive
            .start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        archive.write_all(bytes).unwrap();
    }
    archive.finish().unwrap();
}
async fn profile(engine: &Engine) -> Profile {
    engine
        .create_profile(
            "Metadata test".into(),
            "1.21.1".into(),
            Loader::Fabric,
            Some("0.16.14".into()),
            0,
        )
        .await
        .unwrap()
}

#[test]
fn legacy_records_load_without_metadata() {
    let content: Content = serde_json::from_value(json!({"id":"local:mod:test.jar","source":"local","projectId":"","versionId":"","name":"test.jar","filename":"test.jar","kind":"mod","enabled":false})).unwrap();
    assert!(content.info.version_name.is_empty());
    assert!(!content.enabled);
}

#[test]
fn fabric_quilt_and_forge_metadata_use_project_name_and_actual_version() {
    let dir = tempfile::tempdir().unwrap();
    let cases = [
        ("fabric.jar", vec![("fabric.mod.json", json!({"id":"cozy","name":"Cozy Tools","version":"2.4.0","authors":[{"name":"Cozy author"}]}).to_string().into_bytes())], "Cozy Tools", "2.4.0", "Cozy author"),
        ("quilt.jar", vec![("quilt.mod.json", json!({"quilt_loader":{"version":"3.1.0","metadata":{"name":"Quilt Tools","contributors":{"Quilt author":"Owner"}}}}).to_string().into_bytes())], "Quilt Tools", "3.1.0", "Quilt author"),
        ("forge.jar", vec![("META-INF/mods.toml", b"[[mods]]\nmodId=\"cozy\"\ndisplayName=\"Forge Tools\"\nversion=\"${file.jarVersion}\"\nauthors=\"Forge author\"\n".to_vec()), ("META-INF/MANIFEST.MF", b"Implementation-Version: 4.2.1\r\n".to_vec())], "Forge Tools", "4.2.1", "Forge author"),
    ];
    for (name, entries, title, version, author) in cases {
        let path = dir.path().join(name);
        let entries: Vec<_> = entries.iter().map(|(k, v)| (*k, v.as_slice())).collect();
        jar(&path, &entries);
        let content = describe_file(&path, &dir.path().join("cache"), item(name)).unwrap();
        assert_eq!(content.name, title);
        assert_eq!(content.info.version_name, version);
        assert_eq!(content.info.author, author);
        assert_eq!(content.info.sha1.len(), 40);
    }
}

#[test]
fn local_icons_are_bounded_and_only_image_data_is_exposed() {
    let dir = tempfile::tempdir().unwrap();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(16, 16)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let path = dir.path().join("icon.jar");
    jar(
        &path,
        &[
            (
                "fabric.mod.json",
                b"{\"name\":\"Icon Mod\",\"version\":\"1.0\",\"icon\":\"assets/icon.png\"}",
            ),
            ("assets/icon.png", png.get_ref()),
        ],
    );
    assert!(describe_file(&path, dir.path(), item("icon.jar"))
        .unwrap()
        .info
        .icon
        .unwrap()
        .starts_with("data:image/png;base64,"));
    jar(
        &path,
        &[("fabric.mod.json", b"{\"icon\":\"../../outside.png\"}")],
    );
    assert!(describe_file(&path, dir.path(), item("icon.jar"))
        .unwrap()
        .info
        .icon
        .is_none());
    jar(
        &path,
        &[
            ("fabric.mod.json", b"{\"icon\":\"big.png\"}"),
            ("big.png", &vec![0; 1024 * 1024 + 1]),
        ],
    );
    assert!(describe_file(&path, dir.path(), item("icon.jar"))
        .unwrap()
        .info
        .icon
        .is_none());
}

#[test]
fn cached_identity_is_bound_to_file_hash_and_external_replacements_become_local() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.jar");
    std::fs::write(&path, b"first version").unwrap();
    let mut known = describe_file(&path, dir.path(), item("test.jar")).unwrap();
    known.source = "modrinth".into();
    known.project_id = "project".into();
    known.version_id = "version".into();
    known.name = "Known project".into();
    known.info.version_name = "1.0".into();
    std::fs::write(
        dir.path().join(format!("{}.json", known.info.sha1)),
        serde_json::to_vec(&known).unwrap(),
    )
    .unwrap();
    let mut disabled = item("test.jar");
    disabled.enabled = false;
    let cached = describe_file(&path, dir.path(), disabled).unwrap();
    assert_eq!(cached.name, "Known project");
    assert!(!cached.enabled);
    std::fs::write(&path, b"manually replaced unrelated file").unwrap();
    let changed = describe_file(&path, dir.path(), known).unwrap();
    assert_eq!(changed.source, "local");
    assert!(changed.project_id.is_empty());
    assert!(changed.info.version_name.is_empty());
}

#[tokio::test]
async fn updates_require_matching_project_loader_game_and_a_newer_publication() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let p = profile(&engine).await;
    let mut current = item("mod.jar");
    current.source = "modrinth".into();
    current.project_id = "sodium".into();
    current.version_id = "old".into();
    current.info.date_published = "2025-01-01T00:00:00Z".into();
    let raw = json!({"id":"new","project_id":"sodium","name":"New release","version_number":"0.6.13","date_published":"2025-02-01T00:00:00Z","game_versions":["1.21.1"],"loaders":["fabric"]});
    assert_eq!(
        newer_version(&current, &raw, &p).unwrap().version_name,
        "0.6.13"
    );
    for (key, value) in [
        ("project_id", json!("other")),
        ("game_versions", json!(["1.20.1"])),
        ("loaders", json!(["forge"])),
        ("date_published", json!("2024-01-01T00:00:00Z")),
        ("id", json!("old")),
    ] {
        let mut invalid = raw.clone();
        invalid[key] = value;
        assert!(newer_version(&current, &invalid, &p).is_none(), "{key}");
    }
    current.source = "curseforge".into();
    current.project_id = "123".into();
    current.version_id = "10".into();
    current.info.date_published.clear();
    let old_cf =
        json!({"id":9,"modId":123,"displayName":"older","gameVersions":["1.21.1","Fabric"]});
    assert!(newer_version(&current, &old_cf, &p).is_none());
}

#[tokio::test]
async fn background_recognition_does_not_undo_toggles_or_restore_deleted_content() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let p = profile(&engine).await;
    let mods = engine.instance(&p.id).unwrap().join("mods");
    std::fs::create_dir_all(&mods).unwrap();
    std::fs::write(mods.join("test.jar"), b"test content").unwrap();
    let mut content = engine.list_content(&p.id).await.unwrap();
    content[0].source = "modrinth".into();
    content[0].project_id = "known".into();
    content[0].version_id = "old".into();
    engine.remember_content(&p.id, &content).await.unwrap();
    engine
        .manage_content(&p.id, &content[0].id, "toggle")
        .await
        .unwrap();
    engine.remember_content(&p.id, &content).await.unwrap();
    assert!(!engine.profile(&p.id).await.unwrap().content[0].enabled);
    engine
        .manage_content(&p.id, &content[0].id, "remove")
        .await
        .unwrap();
    engine.remember_content(&p.id, &content).await.unwrap();
    assert!(engine.profile(&p.id).await.unwrap().content.is_empty());
}

#[tokio::test]
async fn cancelling_bulk_updates_preserves_disabled_files_without_network_requests() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let p = profile(&engine).await;
    let mods = engine.instance(&p.id).unwrap().join("mods");
    std::fs::create_dir_all(&mods).unwrap();
    std::fs::write(mods.join("test.jar.disabled"), b"disabled content").unwrap();
    let mut content = engine.list_content(&p.id).await.unwrap();
    content[0].source = "modrinth".into();
    content[0].project_id = "known".into();
    content[0].version_id = "old".into();
    engine.remember_content(&p.id, &content).await.unwrap();
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), Some(p.id.clone()))
        .await
        .unwrap();
    engine.cancel(&task.id).await.unwrap();
    let result = engine
        .update_all_content(&p.id, &[content[0].id.clone()], &task)
        .await
        .unwrap();
    assert!(result.cancelled);
    assert_eq!(result.updated, 0);
    assert!(result.failed.is_empty());
    assert!(mods.join("test.jar.disabled").exists());
    assert!(task.cancel.load(Ordering::Relaxed));
}
