use auren_core::{model::Loader, modrinth_import::scan, Engine, Task};
use rusqlite::Connection;
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

fn write(root: &Path, file: &str, bytes: &[u8]) {
    let path = root.join(file);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}
fn task(cancel: Arc<AtomicBool>) -> Task {
    Task {
        id: uuid::Uuid::new_v4().to_string(),
        profile_id: None,
        cancel,
        emit: Arc::new(|_| {}),
    }
}
fn legacy(root: &Path, folder: &str, name: &str, loader: &str) -> PathBuf {
    let source = root.join("profiles").join(folder);
    write(&source, "profile.json", serde_json::to_string(&json!({
        "metadata":{"name":name,"game_version":"1.21.1","loader":loader,"loader_version":{"id":"1.21.1-52.0.28"}},
        "memory":{"maximum":6144},"java":{"extra_arguments":["-XX:+UseG1GC","-Dlabel=hello world"]}
    })).unwrap().as_bytes());
    write(&source, "mods/example.jar", b"mod");
    write(&source, "mods/disabled.jar.disabled", b"off");
    write(&source, "saves/My world/level.dat", b"world");
    write(&source, "saves/My world/session.lock", b"old lock");
    write(&source, "options.txt", b"renderDistance:12");
    write(&source, "config/example.toml", b"setting=true");
    write(&source, "journeymap/data/waypoints.json", b"waypoints");
    write(&source, "screenshots/example.png", b"screenshot");
    write(&source, "logs/latest.log", b"do not copy");
    source
}
fn modern(root: &Path, data: &Path) {
    std::fs::create_dir_all(root).unwrap();
    let db = Connection::open(root.join("app.db")).unwrap();
    db.execute_batch("CREATE TABLE settings (custom_dir TEXT, mc_memory_max INTEGER, extra_launch_args BLOB);
        CREATE TABLE instances (id TEXT,path TEXT,name TEXT,icon_path TEXT,applied_content_set_id TEXT);
        CREATE TABLE instance_content_sets (id TEXT,instance_id TEXT,game_version TEXT,loader TEXT,loader_version TEXT);
        CREATE TABLE instance_launch_overrides (instance_id TEXT,overrides BLOB);
        CREATE TABLE processes (instance_id TEXT);").unwrap();
    db.execute(
        "INSERT INTO settings VALUES (?1,4096,jsonb('[]'))",
        [data.to_string_lossy().as_ref()],
    )
    .unwrap();
    db.execute_batch("INSERT INTO instances VALUES ('i1','Modern','Modern profile',NULL,'c1');
        INSERT INTO instance_content_sets VALUES ('c1','i1','1.21.1','fabric','0.16.14');
        INSERT INTO instance_launch_overrides VALUES ('i1',jsonb('{\"memory\":{\"maximum\":8192},\"extra_launch_args\":[\"-XX:+UseG1GC\"]}'));").unwrap();
    write(
        &data.join("profiles/Modern"),
        "options.txt",
        b"modern options",
    );
}

#[tokio::test]
async fn multi_import_copies_worlds_settings_disabled_mods_and_custom_folders() {
    let root = tempfile::tempdir().unwrap();
    let src = root.path().join("Modrinth");
    legacy(&src, "one", "Forge world", "forge");
    legacy(&src, "two", "Vanilla world", "vanilla");
    let report = scan(std::slice::from_ref(&src));
    assert_eq!(report.profiles.len(), 2);
    assert_eq!(report.profiles[0].mods, 2);
    assert_eq!(report.profiles[0].worlds, 1);
    assert_eq!(
        report.profiles[0].loader_version.as_deref(),
        Some("52.0.28")
    );
    let engine = Engine::new(root.path().join("Aurum"), |_| {})
        .await
        .unwrap();
    let selected: Vec<_> = report.profiles.iter().map(|p| p.id.clone()).collect();
    let result = engine
        .import_modrinth(
            vec![src.clone()],
            selected.clone(),
            &task(Arc::new(AtomicBool::new(false))),
        )
        .await
        .unwrap();
    assert_eq!(result.imported.len(), 2);
    assert_eq!(result.imported_sources, selected);
    assert!(result.failed.is_empty());
    for p in result.imported {
        let dest = engine.instance(&p.id).unwrap();
        assert_eq!(
            std::fs::read(dest.join("mods/disabled.jar.disabled")).unwrap(),
            b"off"
        );
        assert_eq!(
            std::fs::read(dest.join("saves/My world/level.dat")).unwrap(),
            b"world"
        );
        assert_eq!(
            std::fs::read(dest.join("options.txt")).unwrap(),
            b"renderDistance:12"
        );
        assert_eq!(
            std::fs::read(dest.join("journeymap/data/waypoints.json")).unwrap(),
            b"waypoints"
        );
        assert!(!dest.join("profile.json").exists());
        assert!(!dest.join("logs").exists());
        assert!(!dest.join("saves/My world/session.lock").exists());
        assert_eq!(p.ram_mb, Some(6144));
        assert!(p.jvm_args.contains("UseG1GC"));
        assert_eq!(shlex::split(&p.jvm_args).unwrap()[1], "-Dlabel=hello world");
        assert!(p.installed_version.is_none());
    }
    assert!(src
        .join("profiles/one/saves/My world/session.lock")
        .exists());
    let reloaded = Engine::new(engine.root.clone(), |_| {}).await.unwrap();
    assert_eq!(reloaded.snapshot().await.database.profiles.len(), 2);
}

#[tokio::test]
async fn bulk_configs_and_large_files_are_copied_completely() {
    let root = tempfile::tempdir().unwrap();
    let source_root = root.path().join("Modrinth");
    let source = legacy(&source_root, "bulk", "Bulk", "vanilla");
    for index in 0..1000 {
        write(
            &source,
            &format!("config/bulk/{index}.json"),
            b"{\"enabled\":true}",
        );
    }
    let large = vec![0x5a; 128 * 1024 * 1024];
    write(&source, "config/axiom/blueprints/example.bin", &large);
    let events = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = events.clone();
    let mut copy_task = task(Arc::new(AtomicBool::new(false)));
    copy_task.emit = Arc::new(move |_| {
        counter.fetch_add(1, Ordering::Relaxed);
    });
    let engine = Engine::new(root.path().join("Aurum"), |_| {})
        .await
        .unwrap();
    let selected = scan(std::slice::from_ref(&source_root)).profiles[0]
        .id
        .clone();
    let started = std::time::Instant::now();
    let result = engine
        .import_modrinth(vec![source_root], vec![selected], &copy_task)
        .await
        .unwrap();
    println!(
        "bulk import: {:?}, {} progress events",
        started.elapsed(),
        events.load(Ordering::Relaxed)
    );
    assert!(result.failed.is_empty(), "{:?}", result.failed);
    assert_eq!(result.imported.len(), 1);
    let dest = engine.instance(&result.imported[0].id).unwrap();
    for index in 0..1000 {
        assert_eq!(
            std::fs::read(dest.join(format!("config/bulk/{index}.json"))).unwrap(),
            b"{\"enabled\":true}"
        );
    }
    assert_eq!(
        std::fs::read(dest.join("config/axiom/blueprints/example.bin")).unwrap(),
        large
    );
    assert_eq!(
        std::fs::read(source.join("config/axiom/blueprints/example.bin")).unwrap(),
        large
    );
}

#[tokio::test]
async fn cancellation_during_file_copy_discards_staging_and_keeps_original() {
    let root = tempfile::tempdir().unwrap();
    let source_root = root.path().join("Modrinth");
    let source = legacy(&source_root, "cancel", "Cancel", "vanilla");
    let bytes = vec![0x37; 8 * 1024 * 1024];
    write(&source, "mods/large.jar", &bytes);
    let selected = scan(std::slice::from_ref(&source_root)).profiles[0]
        .id
        .clone();
    let cancel = Arc::new(AtomicBool::new(false));
    let mut copy_task = task(cancel.clone());
    copy_task.emit = Arc::new(move |event| {
        if event.done > 0 {
            cancel.store(true, Ordering::Relaxed);
        }
    });
    let engine = Engine::new(root.path().join("Aurum"), |_| {})
        .await
        .unwrap();
    let result = engine
        .import_modrinth(vec![source_root], vec![selected], &copy_task)
        .await
        .unwrap();
    assert!(result.cancelled);
    assert!(result.imported.is_empty());
    assert!(engine.snapshot().await.database.profiles.is_empty());
    assert_eq!(
        std::fs::read_dir(engine.root.join("staging"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(std::fs::read(source.join("mods/large.jar")).unwrap(), bytes);
}

#[tokio::test]
async fn source_writes_during_copy_are_rejected_before_publishing() {
    let root = tempfile::tempdir().unwrap();
    let source_root = root.path().join("Modrinth");
    let source = legacy(&source_root, "changed", "Changed", "vanilla");
    let selected = scan(std::slice::from_ref(&source_root)).profiles[0]
        .id
        .clone();
    let changed_file = source.join("options.txt");
    let changed = Arc::new(AtomicBool::new(false));
    let mut copy_task = task(Arc::new(AtomicBool::new(false)));
    copy_task.emit = Arc::new(move |event| {
        if event.done > 0 && !changed.swap(true, Ordering::Relaxed) {
            std::fs::write(&changed_file, b"source changed while copying").unwrap();
        }
    });
    let engine = Engine::new(root.path().join("Aurum"), |_| {})
        .await
        .unwrap();
    let result = engine
        .import_modrinth(vec![source_root], vec![selected], &copy_task)
        .await
        .unwrap();
    assert!(result.imported.is_empty());
    assert_eq!(result.failed.len(), 1);
    assert!(result.failed[0].message.contains("изменились"));
    assert!(engine.snapshot().await.database.profiles.is_empty());
    assert_eq!(
        std::fs::read_dir(engine.root.join("staging"))
            .unwrap()
            .count(),
        0
    );
}

#[tokio::test]
async fn modern_jsonb_database_finds_custom_directory_and_is_not_modified() {
    let root = tempfile::tempdir().unwrap();
    let settings = root.path().join("ModrinthApp");
    let data = root.path().join("Custom data");
    modern(&settings, &data);
    let before = std::fs::read(settings.join("app.db")).unwrap();
    let report = scan(&[settings.clone(), data.join("profiles")]);
    assert_eq!(report.profiles.len(), 1);
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);
    assert_eq!(report.profiles[0].loader, Loader::Fabric);
    let engine = Engine::new(root.path().join("Aurum"), |_| {})
        .await
        .unwrap();
    let result = engine
        .import_modrinth(
            vec![settings.clone()],
            vec![report.profiles[0].id.clone()],
            &task(Arc::new(AtomicBool::new(false))),
        )
        .await
        .unwrap();
    assert_eq!(result.imported.len(), 1);
    assert_eq!(result.imported[0].ram_mb, Some(8192));
    assert_eq!(std::fs::read(settings.join("app.db")).unwrap(), before);
    assert_eq!(
        std::fs::read(data.join("profiles/Modern/options.txt")).unwrap(),
        b"modern options"
    );
}

#[test]
fn classic_sqlite_profiles_and_global_launch_settings() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "profiles/Classic/options.txt", b"options");
    let db = Connection::open(root.path().join("app.db")).unwrap();
    db.execute_batch("CREATE TABLE settings (custom_dir TEXT,mc_memory_max INTEGER,extra_launch_args BLOB);
        INSERT INTO settings VALUES (NULL,3072,jsonb('[\"-XX:+UseG1GC\"]'));
        CREATE TABLE profiles (path TEXT,name TEXT,game_version TEXT,mod_loader TEXT,mod_loader_version TEXT,icon_path TEXT,override_mc_memory_max INTEGER,override_extra_launch_args BLOB);
        INSERT INTO profiles VALUES ('Classic','Classic profile','1.20.1','quilt','0.26.0',NULL,NULL,jsonb('null'));
        CREATE TABLE processes (profile_path TEXT);").unwrap();
    drop(db);
    let report = scan(&[root.path().into()]);
    assert_eq!(report.profiles.len(), 1);
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);
    assert_eq!(report.profiles[0].loader, Loader::Quilt);
}

#[tokio::test]
async fn cancellation_keeps_committed_profiles_and_cleans_partial_copy() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("Modrinth");
    legacy(&source, "one", "A first", "vanilla");
    legacy(&source, "two", "B second", "vanilla");
    let report = scan(std::slice::from_ref(&source));
    let cancel = Arc::new(AtomicBool::new(false));
    let mut task = task(cancel.clone());
    task.emit = Arc::new(move |e| {
        if e.message.starts_with("Сборка 2 из") {
            cancel.store(true, Ordering::Relaxed);
        }
    });
    let engine = Engine::new(root.path().join("Aurum"), |_| {})
        .await
        .unwrap();
    let result = engine
        .import_modrinth(
            vec![source],
            report.profiles.iter().map(|p| p.id.clone()).collect(),
            &task,
        )
        .await
        .unwrap();
    assert!(result.cancelled);
    assert_eq!(result.imported.len(), 1);
    assert_eq!(engine.snapshot().await.database.profiles.len(), 1);
    assert_eq!(
        std::fs::read_dir(engine.root.join("staging"))
            .unwrap()
            .count(),
        0
    );
}

#[tokio::test]
async fn revalidates_selected_metadata_and_does_not_accept_arbitrary_paths() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("Modrinth");
    legacy(&source, "one", "One", "vanilla");
    let engine = Engine::new(root.path().join("Aurum"), |_| {})
        .await
        .unwrap();
    let result = engine
        .import_modrinth(
            vec![source],
            vec![root.path().to_string_lossy().into()],
            &task(Arc::new(AtomicBool::new(false))),
        )
        .await
        .unwrap();
    assert!(result.imported.is_empty());
    assert_eq!(result.failed.len(), 1);
    assert!(engine.snapshot().await.database.profiles.is_empty());
}

#[test]
fn running_or_unsupported_profiles_are_visible_but_unavailable() {
    let root = tempfile::tempdir().unwrap();
    modern(root.path(), root.path());
    let db = Connection::open(root.path().join("app.db")).unwrap();
    db.execute("INSERT INTO processes VALUES ('i1')", [])
        .unwrap();
    drop(db);
    let report = scan(&[root.path().into()]);
    assert!(report.profiles[0]
        .issue
        .as_deref()
        .unwrap()
        .contains("Закройте Minecraft"));
    legacy(root.path(), "Other", "Other", "unsupported");
    let report = scan(&[root.path().into()]);
    assert_eq!(report.profiles.len(), 2);
    assert!(report
        .profiles
        .iter()
        .find(|p| p.name == "Other")
        .unwrap()
        .issue
        .is_some());
}

#[test]
fn malformed_metadata_and_traversal_do_not_hide_valid_profiles() {
    let root = tempfile::tempdir().unwrap();
    modern(root.path(), root.path());
    let db = Connection::open(root.path().join("app.db")).unwrap();
    db.execute_batch("INSERT INTO instances VALUES ('bad','../outside','Bad',NULL,'c1')")
        .unwrap();
    drop(db);
    write(
        root.path(),
        "profiles/Broken/profile.json",
        br#"{"metadata":"broken"}"#,
    );
    let report = scan(&[root.path().into()]);
    assert_eq!(report.profiles.len(), 1);
    assert_eq!(report.warnings.len(), 2);
}

#[cfg(windows)]
#[test]
fn legacy_active_world_is_not_importable() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = tempfile::tempdir().unwrap();
    let source = legacy(root.path(), "one", "Playing", "vanilla");
    let _lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(source.join("saves/My world/session.lock"))
        .unwrap();
    let report = scan(&[root.path().into()]);
    assert!(report.profiles[0]
        .issue
        .as_deref()
        .unwrap()
        .contains("Закройте Minecraft"));
}

#[tokio::test]
async fn one_invalid_profile_does_not_prevent_other_selected_imports() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("Modrinth");
    legacy(&source, "one", "One", "unsupported");
    legacy(&source, "two", "Two", "vanilla");
    let report = scan(std::slice::from_ref(&source));
    let engine = Engine::new(root.path().join("Aurum"), |_| {})
        .await
        .unwrap();
    let result = engine
        .import_modrinth(
            vec![source],
            report.profiles.iter().map(|p| p.id.clone()).collect(),
            &task(Arc::new(AtomicBool::new(false))),
        )
        .await
        .unwrap();
    assert_eq!(result.imported.len(), 1);
    assert_eq!(result.failed.len(), 1);
    assert_eq!(result.imported[0].name, "Two");
}
