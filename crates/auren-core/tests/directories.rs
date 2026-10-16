use auren_core::{default_data_directory, model::*, store, Engine};
use std::path::Path;

fn fixture() -> tempfile::TempDir {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/directories");
    std::fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}

async fn profile(engine: &Engine, name: &str) -> Profile {
    engine
        .create_profile(name.into(), "1.21.1".into(), Loader::Vanilla, None, 0)
        .await
        .unwrap()
}

async fn legacy_database(engine: &Engine) -> Database {
    let mut db = engine.snapshot().await.database;
    for profile in &db.profiles {
        std::fs::rename(
            engine.instance(&profile.id).unwrap(),
            engine.root.join("instances").join(&profile.id),
        )
        .unwrap();
    }
    db.instance_directories.clear();
    // Old versions did not serialize the directory mapping at all.
    let mut json = serde_json::to_value(&db).unwrap();
    json.as_object_mut().unwrap().remove("instanceDirectories");
    std::fs::write(
        engine.root.join("state.json"),
        serde_json::to_vec(&json).unwrap(),
    )
    .unwrap();
    db
}

#[tokio::test]
async fn names_are_readable_unique_and_safe_on_windows() {
    let root = fixture();
    let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
    for (name, expected) in [
        ("Моя сборка", "Моя сборка"),
        ("Моя сборка", "Моя сборка (2)"),
        ("моя сборка", "моя сборка (3)"),
        ("../bad\\name:*?", "_bad_name___"),
        ("CON.txt", "_CON.txt"),
        ("COM¹", "_COM¹"),
        ("...", "Profile"),
        ("End. ", "End"),
    ] {
        let p = profile(&engine, name).await;
        assert_eq!(
            engine.instance(&p.id).unwrap(),
            root.path().join("instances").join(expected)
        );
    }
    let occupied = root.path().join("instances/Occupied");
    std::fs::create_dir_all(&occupied).unwrap();
    std::fs::write(occupied.join("keep"), b"untracked files").unwrap();
    let p = profile(&engine, "Occupied").await;
    assert!(engine.instance(&p.id).unwrap().ends_with("Occupied (2)"));
    assert_eq!(
        std::fs::read(occupied.join("keep")).unwrap(),
        b"untracked files"
    );
    let restored = Engine::new(root.path().into(), |_| {}).await.unwrap();
    assert_eq!(
        engine.instance(&p.id).unwrap(),
        restored.instance(&p.id).unwrap()
    );
}

#[tokio::test]
async fn startup_migrates_legacy_worlds_and_preserves_all_root_data() {
    let root = fixture();
    let legacy = root.path().join("app.auren.launcher");
    let engine = Engine::new(legacy.clone(), |_| {}).await.unwrap();
    let p = profile(&engine, "Мир с модами").await;
    let second = profile(&engine, "Мир с модами").await;
    let data = engine.instance(&p.id).unwrap();
    for file in [
        "saves/My world/level.dat",
        "mods/mod.jar",
        "config/options.json",
        "screenshots/one.png",
        "options.txt",
    ] {
        let path = data.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, file.as_bytes()).unwrap();
    }
    for file in [
        "assets/objects/asset",
        "java/runtime/bin/java.exe",
        "skin-library.json",
        "trash/old-world/level.dat",
    ] {
        let path = legacy.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, file.as_bytes()).unwrap();
    }
    engine.add_offline("Player".into()).await.unwrap();
    let mut settings = engine.snapshot().await.database.settings;
    settings.ram_mb = 8192;
    engine.save_settings(settings).await.unwrap();
    let before = legacy_database(&engine).await;
    drop(engine);
    let target = default_data_directory(&legacy).unwrap();
    assert_eq!(target, root.path().join("Aurum Launcher"));
    assert!(!legacy.exists());
    let migrated = Engine::new(target.clone(), |_| {}).await.unwrap();
    let folder = migrated.instance(&p.id).unwrap();
    assert_eq!(folder, target.join("instances/Мир с модами"));
    assert!(migrated
        .instance(&second.id)
        .unwrap()
        .ends_with("Мир с модами (2)"));
    assert_eq!(
        std::fs::read(folder.join("saves/My world/level.dat")).unwrap(),
        b"saves/My world/level.dat"
    );
    assert_eq!(
        std::fs::read(folder.join("mods/mod.jar")).unwrap(),
        b"mods/mod.jar"
    );
    for file in [
        "assets/objects/asset",
        "java/runtime/bin/java.exe",
        "skin-library.json",
        "trash/old-world/level.dat",
    ] {
        assert_eq!(std::fs::read(target.join(file)).unwrap(), file.as_bytes());
    }
    let after = migrated.snapshot().await.database;
    assert_eq!(
        serde_json::to_value(&after.profiles).unwrap(),
        serde_json::to_value(&before.profiles).unwrap()
    );
    assert_eq!(after.accounts[0].id, before.accounts[0].id);
    assert_eq!(after.settings.ram_mb, 8192);
    assert_eq!(default_data_directory(&legacy).unwrap(), target);
    let again = Engine::new(target, |_| {}).await.unwrap();
    assert_eq!(again.instance(&p.id).unwrap(), folder);
}

#[tokio::test]
async fn custom_root_is_preserved_and_renames_move_worlds_without_changing_identity() {
    let root = fixture();
    let custom = root.path().join("Custom data");
    let engine = Engine::new(custom.clone(), |_| {}).await.unwrap();
    let mut p = profile(&engine, "Before").await;
    let old = engine.instance(&p.id).unwrap();
    std::fs::write(old.join("world"), b"world bytes").unwrap();
    let other = profile(&engine, "After").await;
    p.name = "After".into();
    // The frontend must not be able to supply or steal another instance's directory.
    engine.update_profile(p.clone()).await.unwrap();
    let renamed = engine.instance(&p.id).unwrap();
    assert_eq!(renamed, custom.join("instances/After (2)"));
    assert_eq!(
        std::fs::read(renamed.join("world")).unwrap(),
        b"world bytes"
    );
    assert!(!old.exists());
    assert_ne!(engine.instance(&other.id).unwrap(), renamed);
    let reopened = Engine::new(custom, |_| {}).await.unwrap();
    assert_eq!(reopened.instance(&p.id).unwrap(), renamed);
    p.name = "AFTER (2)".into();
    reopened.update_profile(p.clone()).await.unwrap();
    assert_eq!(
        reopened.instance(&p.id).unwrap().file_name().unwrap(),
        "AFTER (2)"
    );
    assert_eq!(
        std::fs::read(reopened.instance(&p.id).unwrap().join("world")).unwrap(),
        b"world bytes"
    );
    reopened.delete_profile(&p.id).await.unwrap();
    assert!(!renamed.exists());
    assert!(walkdir::WalkDir::new(reopened.root.join("trash"))
        .into_iter()
        .flatten()
        .any(|e| e.file_name() == "world"));
    assert!(reopened.instance(&other.id).unwrap().exists());
}

#[test]
fn standalone_skin_library_migrates_and_config_only_legacy_directory_is_ignored() {
    let root = fixture();
    let legacy = root.path().join("app.auren.launcher");
    std::fs::create_dir(&legacy).unwrap();
    std::fs::write(legacy.join("skin-library.json"), b"saved skin data").unwrap();
    let target = default_data_directory(&legacy).unwrap();
    assert_eq!(
        std::fs::read(target.join("skin-library.json")).unwrap(),
        b"saved skin data"
    );
    std::fs::create_dir(&legacy).unwrap();
    std::fs::write(
        legacy.join("data-location.json"),
        serde_json::to_vec(&target).unwrap(),
    )
    .unwrap();
    assert_eq!(default_data_directory(&legacy).unwrap(), target);
    assert!(legacy.join("data-location.json").exists());
}

#[tokio::test]
async fn interrupted_move_recovers_before_and_after_the_filesystem_rename() {
    for renamed in [false, true] {
        let root = fixture();
        let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
        let p = profile(&engine, "Recovered").await;
        let mut before = legacy_database(&engine).await;
        let source = root.path().join("instances").join(&p.id);
        std::fs::write(source.join("world"), b"valuable world").unwrap();
        let mut after = before.clone();
        after
            .instance_directories
            .insert(p.id.clone(), "Recovered".into());
        let journal = serde_json::json!({
            "source": format!("instances/{}", p.id), "target": "Recovered",
            "before": before, "after": after,
        });
        std::fs::write(
            root.path().join("instance-move.json"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        if renamed {
            std::fs::rename(&source, root.path().join("instances/Recovered")).unwrap();
        }
        let recovered = Engine::new(root.path().into(), |_| {}).await.unwrap();
        assert_eq!(
            std::fs::read(recovered.instance(&p.id).unwrap().join("world")).unwrap(),
            b"valuable world"
        );
        assert!(!source.exists());
        assert!(!root.path().join("instance-move.json").exists());
        before = recovered.snapshot().await.database;
        assert_eq!(before.instance_directories[&p.id], "Recovered");
    }
}

#[tokio::test]
async fn failed_state_save_leaves_a_recoverable_journal_and_blocks_stale_writes() {
    let root = fixture();
    let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
    let mut p = profile(&engine, "Original").await;
    std::fs::write(engine.instance(&p.id).unwrap().join("world"), b"world").unwrap();
    // Prevent the atomic state write after the directory has already moved.
    let obstacle = root.path().join("state.json.tmp");
    std::fs::create_dir(&obstacle).unwrap();
    p.name = "Renamed".into();
    assert!(engine.update_profile(p.clone()).await.is_err());
    assert!(root.path().join("instance-move.json").exists());
    assert!(engine.instance(&p.id).is_err());
    assert!(engine.save_settings(Settings::default()).await.is_err());
    std::fs::remove_dir(obstacle).unwrap();
    let restored = Engine::new(root.path().into(), |_| {}).await.unwrap();
    assert_eq!(restored.profile(&p.id).await.unwrap().name, "Renamed");
    assert_eq!(
        std::fs::read(restored.instance(&p.id).unwrap().join("world")).unwrap(),
        b"world"
    );
}

#[tokio::test]
async fn conflicting_roots_and_unsafe_mappings_never_overwrite_files() {
    let root = fixture();
    let legacy = root.path().join("app.auren.launcher");
    let engine = Engine::new(legacy.clone(), |_| {}).await.unwrap();
    let p = profile(&engine, "Keep").await;
    let target = root.path().join("Aurum Launcher");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("keep"), b"other installation").unwrap();
    assert!(default_data_directory(&legacy).is_err());
    assert!(legacy.join("state.json").exists());
    assert_eq!(
        std::fs::read(target.join("keep")).unwrap(),
        b"other installation"
    );
    let mut db = engine.snapshot().await.database;
    db.instance_directories
        .insert(p.id.clone(), "../outside".into());
    store::persist(&legacy, &db).await.unwrap();
    assert!(Engine::new(legacy.clone(), |_| {}).await.is_err());
    assert!(legacy.join("instances/Keep").exists());
    db.instance_directories.insert(p.id, "Keep".into());
    let mut duplicate = db.profiles[0].clone();
    duplicate.id = uuid::Uuid::new_v4().to_string();
    db.instance_directories
        .insert(duplicate.id.clone(), "keep".into());
    db.profiles.push(duplicate);
    store::persist(&legacy, &db).await.unwrap();
    assert!(Engine::new(legacy, |_| {}).await.is_err());
}
