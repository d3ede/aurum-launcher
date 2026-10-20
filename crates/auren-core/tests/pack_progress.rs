use auren_core::{model::Event, Engine};
use serde_json::json;
use sha1::{Digest, Sha1};
use std::{
    io::Write,
    sync::{Arc, Mutex},
};

#[tokio::test]
async fn archive_import_reports_manifest_name_separately_from_file_progress() {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/pack-progress");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let events = Arc::new(Mutex::new(Vec::<Event>::new()));
    let captured = events.clone();
    let engine = Engine::new(dir.path().join("data"), move |event| {
        captured.lock().unwrap().push(event);
    })
    .await
    .unwrap();
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), None)
        .await
        .unwrap();
    let name = "Уютный мир · Edition";
    let bytes = b"cached mod fixture";
    let file_path = "mods/fixture.jar";
    let cached = engine
        .root
        .join("staging")
        .join(&task.id)
        .join("pack")
        .join(file_path);
    std::fs::create_dir_all(cached.parent().unwrap()).unwrap();
    std::fs::write(cached, bytes).unwrap();
    let path = dir.path().join("fixture.mrpack");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    zip.start_file(
        "modrinth.index.json",
        zip::write::SimpleFileOptions::default(),
    )
    .unwrap();
    zip.write_all(json!({
        "formatVersion": 1, "game": "minecraft", "name": name,
        "dependencies": { "minecraft": "1.21.1" },
        "files": [{ "path": file_path, "hashes": { "sha1": format!("{:x}", Sha1::digest(bytes)) },
            "downloads": ["https://cdn.modrinth.com/fixture.jar"] }]
    }).to_string().as_bytes()).unwrap();
    zip.finish().unwrap();

    let id = engine.import_pack(&path, &task).await.unwrap();
    assert_eq!(engine.profile(&id).await.unwrap().name, name);
    let events = events.lock().unwrap();
    let event = events
        .iter()
        .find(|event| event.phase == "pack" && event.done == 1)
        .unwrap();
    assert_eq!(event.pack_name.as_deref(), Some(name));
    assert_eq!(event.id, task.id);
    assert_eq!(event.total, 1);
    assert!(event.message.contains(file_path));
    assert_eq!(serde_json::to_value(event).unwrap()["packName"], name);
}
