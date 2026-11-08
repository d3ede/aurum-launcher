use super::*;
use crate::model::Loader;
use std::sync::{atomic::AtomicBool, Arc};

fn preset(version: &str, options: &str) -> GameSettingsPreset {
    GameSettingsPreset {
        id: uuid::Uuid::new_v4().to_string(),
        name: "My settings".into(),
        source_version: version.into(),
        source_name: "Source".into(),
        options: options.into(),
        categories: vec![
            Category::Graphics,
            Category::Fov,
            Category::Controls,
            Category::Mouse,
            Category::Sound,
            Category::Interface,
        ],
    }
}

#[test]
fn only_selected_categories_change_and_unknown_pack_options_are_preserved() {
    let mut p=preset("1.21.1","version:3955\nfov:0.5\nmouseSensitivity:0.2\nrenderDistance:24\nresourcePacks:[\"missing\"]\nlastServer:private.example\nkey_mod.action:key.keyboard.x\nkey_key.forward:key.keyboard.r\nsoundCategory_music:0.3\n");
    p.categories = vec![Category::Fov, Category::Sound];
    let original="version:3400\r\nfov:0\r\nrenderDistance:8\r\nresourcePacks:[\"pack\"]\r\ncustom:value:with:colons\r\nkey_mod.action:key.keyboard.z\r\n";
    let (merged, report) = merge(&p, original, "1.20.1");
    let values = parse(&merged);
    assert_eq!(report.applied, 2);
    assert_eq!(values["fov"], "0.5");
    assert_eq!(values["soundCategory_music"], "0.3");
    assert_eq!(values["version"], "3400");
    assert_eq!(values["renderDistance"], "8");
    assert_eq!(values["resourcePacks"], "[\"pack\"]");
    assert_eq!(values["custom"], "value:with:colons");
    assert_eq!(values["key_mod.action"], "key.keyboard.z");
    assert!(!values.contains_key("lastServer"));
    assert!(!values.contains_key("mouseSensitivity"));
    assert!(merged.contains("\r\n"));
}

#[test]
fn adapts_legacy_keys_mouse_buttons_language_and_graphics_both_ways() {
    let old=preset("1.12.2","key_key.forward:17\nkey_key.attack:-100\nkey_key.use:-99\nkey_key.jump:57\nlang:ru_RU\nfancyGraphics:false\nao:2\n");
    let (merged, report) = merge(&old, "version:3955\nao:true\n", "1.21.1");
    let values = parse(&merged);
    assert!(report.skipped.is_empty());
    assert_eq!(values["key_key.forward"], "key.keyboard.w");
    assert_eq!(values["key_key.attack"], "key.mouse.left");
    assert_eq!(values["key_key.use"], "key.mouse.right");
    assert_eq!(values["graphicsMode"], "0");
    assert_eq!(values["lang"], "ru_ru");
    assert_eq!(values["ao"], "true");
    let new = preset("1.21.1", &merged);
    let (merged, _) = merge(&new, "ao:0\n", "1.10.2");
    let values = parse(&merged);
    assert_eq!(values["key_key.forward"], "17");
    assert_eq!(values["key_key.attack"], "-100");
    assert_eq!(values["key_key.jump"], "57");
    assert_eq!(values["fancyGraphics"], "false");
    assert_eq!(values["lang"], "ru_RU");
    assert_eq!(values["ao"], "2");
}

#[test]
fn unsupported_invalid_and_snapshot_fields_are_skipped_without_replacing_the_file() {
    let p=preset("1.21.1","fov:NaN\nmouseSensitivity:2\nrawMouseInput:true\nsimulationDistance:12\nkey_key.forward:key.keyboard.invalid\nkey_key.jump:key.keyboard.f25\nlang:ru_ru\n");
    let (merged, report) = merge(&p, "custom:keep\nfov:0.5\n", "1.12.2");
    assert_eq!(parse(&merged)["fov"], "0.5");
    assert!(report.skipped.contains(&"simulationDistance".into()));
    assert!(report.skipped.contains(&"rawMouseInput".into()));
    assert!(report.skipped.contains(&"key_key.forward".into()));
    assert!(report.skipped.contains(&"key_key.jump".into()));
    let original = "fov:0\nversion:9999\n";
    let (merged, report) = merge(&preset("1.21.1", "fov:0.5\n"), original, "26w45a");
    assert_eq!(merged, original);
    assert_eq!(report.applied, 0);
    assert_eq!(report.skipped, vec!["fov"]);
}

#[test]
fn newest_graphics_presets_keep_individual_values_and_target_metadata() {
    let p = preset(
        "1.21.1",
        "graphicsMode:2\nrenderDistance:20\nrenderClouds:fancy\n",
    );
    let (merged, report) = merge(
        &p,
        "version:9999\npreferredGraphicsBackend:vulkan\n",
        "26.3",
    );
    let values = parse(&merged);
    assert_eq!(values["graphicsPreset"], "custom");
    assert_eq!(values["renderDistance"], "20");
    assert!(!values.contains_key("graphicsMode"));
    assert_eq!(values["preferredGraphicsBackend"], "vulkan");
    assert_eq!(values["version"], "9999");
    assert!(report.skipped.contains(&"renderClouds".into()));
    let (merged, _) = merge(
        &preset("26.3", "graphicsPreset:custom\nfov:0.5\n"),
        "graphicsMode:0\n",
        "1.20.1",
    );
    assert_eq!(parse(&merged)["graphicsMode"], "0");
}

async fn fixture() -> (tempfile::TempDir, Engine, crate::model::Profile) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/game-settings-tests");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let engine = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let p = engine
        .create_profile("Source".into(), "1.21.1".into(), Loader::Vanilla, None, 0)
        .await
        .unwrap();
    (dir, engine, p)
}

#[tokio::test]
async fn import_is_a_copy_five_profile_limit_persists_and_updates_do_not_consume_slots() {
    let (dir, engine, p) = fixture().await;
    let options = engine.instance(&p.id).unwrap().join("options.txt");
    tokio::fs::write(&options, "fov:0.5\ncustom:unchanged\n")
        .await
        .unwrap();
    let mut saved = engine
        .capture_game_settings(&p.id, "My profile".into(), None)
        .await
        .unwrap();
    assert_eq!(saved.options, "fov:0.5\ncustom:unchanged\n");
    saved.options = "fov:1\n".into();
    engine.save_game_settings(saved.clone()).await.unwrap();
    assert_eq!(
        tokio::fs::read_to_string(&options).await.unwrap(),
        "fov:0.5\ncustom:unchanged\n"
    );
    for i in 1..5 {
        engine
            .save_game_settings(preset("1.21.1", &format!("fov:0.{i}\n")))
            .await
            .unwrap();
    }
    assert!(engine
        .save_game_settings(preset("1.21.1", "fov:0\n"))
        .await
        .is_err());
    engine
        .capture_game_settings(&p.id, "Updated".into(), Some(&saved.id))
        .await
        .unwrap();
    let reopened = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    assert_eq!(reopened.db.lock().await.game_settings_profiles.len(), 5);
    assert_eq!(
        reopened.game_settings_preset(&saved.id).await.unwrap().name,
        "Updated"
    );
    reopened.delete_game_settings(&saved.id).await.unwrap();
    assert_eq!(reopened.db.lock().await.game_settings_profiles.len(), 4);
}

#[tokio::test]
async fn application_is_once_only_preserves_original_backup_and_refuses_running_game() {
    let (_dir, engine, p) = fixture().await;
    let game = engine.instance(&p.id).unwrap();
    let original = "fov:0\ncustom:keep\n";
    tokio::fs::write(game.join("options.txt"), original)
        .await
        .unwrap();
    let preset = preset("1.21.1", "fov:0.5\n");
    engine
        .apply_game_settings(&p.id, &preset, None)
        .await
        .unwrap();
    engine
        .apply_game_settings(&p.id, &preset, None)
        .await
        .unwrap();
    assert_eq!(
        tokio::fs::read_to_string(game.join(BACKUP)).await.unwrap(),
        original
    );
    assert_eq!(
        parse(
            &tokio::fs::read_to_string(game.join("options.txt"))
                .await
                .unwrap()
        )["fov"],
        "0.5"
    );
    engine
        .running
        .lock()
        .await
        .insert(p.id.clone(), Arc::new(AtomicBool::new(false)));
    assert!(engine
        .apply_game_settings(&p.id, &preset, None)
        .await
        .is_err());
    assert!(engine
        .capture_game_settings(&p.id, "Running".into(), None)
        .await
        .is_err());
    assert!(engine.restore_game_settings(&p.id).await.is_err());
    engine.running.lock().await.remove(&p.id);
    engine.restore_game_settings(&p.id).await.unwrap();
    assert_eq!(
        tokio::fs::read_to_string(game.join("options.txt"))
            .await
            .unwrap(),
        original
    );
}

#[test]
fn legacy_database_has_an_empty_settings_library() {
    let db: crate::model::Database=serde_json::from_value(serde_json::json!({"profiles":[],"accounts":[],"selectedAccount":null,"settings":crate::model::Settings::default()})).unwrap();
    assert!(db.game_settings_profiles.is_empty());
}

#[test]
fn unversioned_files_use_legacy_bindings_so_minecraft_can_migrate_them() {
    let p = preset(
        "1.21.1",
        "key_key.forward:key.keyboard.w\nkey_key.attack:key.mouse.left\n",
    );
    let (merged, report) = merge(&p, "", "1.20.1");
    assert!(report.skipped.is_empty());
    assert_eq!(parse(&merged)["key_key.forward"], "17");
    assert_eq!(parse(&merged)["key_key.attack"], "-100");
}

#[tokio::test]
async fn new_options_files_use_the_target_client_data_version_not_the_source_version() {
    use std::io::Write;
    let (_dir, engine, p) = fixture().await;
    let client = engine.root.join("versions/1.21.1/1.21.1.jar");
    std::fs::create_dir_all(client.parent().unwrap()).unwrap();
    let mut zip = zip::ZipWriter::new(std::fs::File::create(client).unwrap());
    zip.start_file("version.json", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"{\"world_version\":3955}").unwrap();
    zip.finish().unwrap();
    let profile = preset("1.12.2", "version:1343\nkey_key.forward:17\nfov:0.5\n");
    engine
        .apply_game_settings(&p.id, &profile, None)
        .await
        .unwrap();
    let raw = tokio::fs::read_to_string(engine.instance(&p.id).unwrap().join("options.txt"))
        .await
        .unwrap();
    assert_eq!(parse(&raw)["version"], "3955");
    assert_eq!(parse(&raw)["key_key.forward"], "key.keyboard.w");
}
