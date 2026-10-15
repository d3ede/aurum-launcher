use auren_core::{modrinth_skins::scan, skins::default_texture, Engine};
use rusqlite::{params, Connection};
use std::path::Path;

fn sandbox() -> tempfile::TempDir {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data");
    std::fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}

fn source(root: &Path) -> Connection {
    std::fs::create_dir_all(root).unwrap();
    let db = Connection::open(root.join("app.db")).unwrap();
    db.execute_batch(
        "CREATE TABLE custom_minecraft_skins (
            minecraft_user_uuid TEXT, texture_key TEXT, variant TEXT, cape_id TEXT);
         CREATE TABLE custom_minecraft_skin_textures (texture_key TEXT PRIMARY KEY, texture BLOB);
         CREATE TABLE minecraft_users (access_token TEXT);
         INSERT INTO minecraft_users VALUES ('private-test-token-never-import');",
    )
    .unwrap();
    db
}

fn add(db: &Connection, key: &str, variant: &str, bytes: &[u8]) {
    db.execute(
        "INSERT OR IGNORE INTO custom_minecraft_skin_textures VALUES (?1, ?2)",
        params![key, bytes],
    )
    .unwrap();
    db.execute(
        "INSERT INTO custom_minecraft_skins VALUES ('user', ?1, ?2, NULL)",
        params![key, variant],
    )
    .unwrap();
}

#[tokio::test]
async fn imports_both_models_and_repeats_without_changing_source_or_selection() {
    let dir = sandbox();
    let root = dir.path().join("Modrinth");
    let db = source(&root);
    let png = default_texture("default:ari", "alex").unwrap();
    add(&db, "skin", "SLIM", &png);
    add(&db, "skin", "CLASSIC", &png);
    // A second account and a cape choice must not duplicate the same skin/model.
    db.execute_batch(
        "INSERT INTO custom_minecraft_skins VALUES ('other-user', 'skin', 'SLIM', 'owned-cape');",
    )
    .unwrap();
    drop(db);
    let source_before = std::fs::read(root.join("app.db")).unwrap();
    let engine = Engine::new(dir.path().join("Aurum"), |_| {}).await.unwrap();
    let account = engine.add_offline("Player".into()).await.unwrap();
    let original = engine
        .save_library_skin(
            None,
            "Original".into(),
            "steve".into(),
            default_texture("default:zuri", "steve").unwrap(),
            None,
        )
        .await
        .unwrap();
    engine
        .apply_library_skin(&account.id, &original.id, "steve", None)
        .await
        .unwrap();
    let selected = engine.skin_library().await.unwrap().selections;
    let report = engine
        .import_modrinth_skins(vec![root.clone(), root.clone(), root.join("profiles")])
        .await
        .unwrap();
    assert_eq!(
        (report.imported, report.duplicates, report.invalid),
        (2, 1, 0)
    );
    assert!(report.warnings.is_empty());
    let library = engine.skin_library().await.unwrap();
    assert_eq!(library.skins.len(), 3);
    assert!(library.skins.iter().any(|s| s.model == "alex"));
    assert_eq!(
        library.selections[&account.id].skin_id,
        selected[&account.id].skin_id
    );
    assert!(library.skins.iter().all(|s| s.cape_id.is_none()));
    assert_eq!(std::fs::read(root.join("app.db")).unwrap(), source_before);
    let saved = std::fs::read(engine.root.join("skin-library.json")).unwrap();
    assert!(!String::from_utf8_lossy(&saved).contains("private-test-token"));
    let report = engine.import_modrinth_skins(vec![root]).await.unwrap();
    assert_eq!((report.imported, report.duplicates), (0, 3));
    assert_eq!(
        std::fs::read(engine.root.join("skin-library.json")).unwrap(),
        saved
    );
    let restarted = Engine::new(engine.root.clone(), |_| {}).await.unwrap();
    assert_eq!(restarted.skin_library().await.unwrap().skins.len(), 3);
}

#[tokio::test]
async fn skips_invalid_missing_oversized_and_unknown_entries_but_imports_valid_skin() {
    let dir = sandbox();
    let root = dir.path().join("Modrinth");
    let db = source(&root);
    let png = default_texture("default:steve", "steve").unwrap();
    add(&db, "valid", "CLASSIC", &png);
    add(&db, "broken", "CLASSIC", b"not PNG");
    add(&db, "unknown", "UNKNOWN", &png);
    add(&db, "big", "SLIM", &vec![0; 1_000_001]);
    db.execute_batch(
        "INSERT INTO custom_minecraft_skins VALUES ('user', 'missing', 'SLIM', NULL);",
    )
    .unwrap();
    let engine = Engine::new(dir.path().join("Aurum"), |_| {}).await.unwrap();
    let report = engine.import_modrinth_skins(vec![root]).await.unwrap();
    assert_eq!((report.imported, report.invalid), (1, 4));
    assert_eq!(engine.skin_library().await.unwrap().skins.len(), 1);
}

#[test]
fn reads_committed_wal_rows_while_modrinth_is_open_and_ignores_uncommitted_rows() {
    let dir = sandbox();
    let root = dir.path().join("Modrinth");
    let db = source(&root);
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    let png = default_texture("default:efe", "alex").unwrap();
    add(&db, "committed", "SLIM", &png);
    let before = std::fs::read(root.join("app.db-wal")).unwrap();
    db.execute_batch("BEGIN IMMEDIATE").unwrap();
    add(&db, "uncommitted", "CLASSIC", &png);
    let result = scan(std::slice::from_ref(&root));
    assert!(result.warnings.is_empty());
    assert_eq!(result.skins.len(), 1);
    assert_eq!(result.skins[0].model, "alex");
    assert_eq!(std::fs::read(root.join("app.db-wal")).unwrap(), before);
    db.execute_batch("ROLLBACK").unwrap();
}

#[tokio::test]
async fn reports_unreadable_sources_and_continues_with_other_databases() {
    let dir = sandbox();
    let broken = dir.path().join("broken");
    std::fs::create_dir_all(&broken).unwrap();
    std::fs::write(broken.join("app.db"), b"broken sqlite").unwrap();
    let valid = dir.path().join("valid");
    let db = source(&valid);
    add(
        &db,
        "one",
        "CLASSIC",
        &default_texture("default:steve", "steve").unwrap(),
    );
    let other = dir.path().join("other");
    let db2 = source(&other);
    add(
        &db2,
        "same",
        "CLASSIC",
        &default_texture("default:steve", "steve").unwrap(),
    );
    let engine = Engine::new(dir.path().join("Aurum"), |_| {}).await.unwrap();
    let report = engine
        .import_modrinth_skins(vec![broken, valid, other])
        .await
        .unwrap();
    assert_eq!((report.imported, report.duplicates), (1, 1));
    assert_eq!(report.warnings.len(), 1);
}

#[tokio::test]
async fn empty_and_legacy_sources_do_not_create_or_replace_a_library() {
    let dir = sandbox();
    let legacy = dir.path().join("legacy");
    std::fs::create_dir_all(&legacy).unwrap();
    Connection::open(legacy.join("app.db"))
        .unwrap()
        .execute_batch("CREATE TABLE settings (id TEXT);")
        .unwrap();
    let engine = Engine::new(dir.path().join("Aurum"), |_| {}).await.unwrap();
    let report = engine
        .import_modrinth_skins(vec![legacy, dir.path().join("missing")])
        .await
        .unwrap();
    assert_eq!(report.imported + report.invalid + report.duplicates, 0);
    assert!(report.warnings.is_empty());
    assert!(!engine.root.join("skin-library.json").exists());
}

#[tokio::test]
async fn corrupt_destination_library_is_preserved() {
    let dir = sandbox();
    let source_root = dir.path().join("Modrinth");
    let db = source(&source_root);
    add(
        &db,
        "one",
        "CLASSIC",
        &default_texture("default:steve", "steve").unwrap(),
    );
    let engine = Engine::new(dir.path().join("Aurum"), |_| {}).await.unwrap();
    std::fs::write(engine.root.join("skin-library.json"), b"broken library").unwrap();
    assert!(engine
        .import_modrinth_skins(vec![source_root])
        .await
        .is_err());
    assert_eq!(
        std::fs::read(engine.root.join("skin-library.json")).unwrap(),
        b"broken library"
    );
}
