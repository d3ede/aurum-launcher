use super::*;
use std::sync::{atomic::AtomicBool, Arc};

async fn fixture(loader: Loader) -> (tempfile::TempDir, Engine, Profile) {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/content-runtime");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let engine = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let loader_version = (loader != Loader::Vanilla).then(|| "0.16.14".into());
    let profile = engine
        .create_profile(
            "Runtime packs".into(),
            "1.21.1".into(),
            loader,
            loader_version,
            0,
        )
        .await
        .unwrap();
    engine
        .running
        .lock()
        .await
        .insert(profile.id.clone(), Arc::new(AtomicBool::new(false)));
    (dir, engine, profile)
}

#[tokio::test]
async fn packs_can_be_imported_toggled_and_removed_while_running() {
    for loader in [Loader::Vanilla, Loader::Fabric, Loader::Forge] {
        let (dir, engine, p) = fixture(loader).await;
        let source = dir.path().join("pack.zip");
        std::fs::write(&source, b"complete archive").unwrap();
        for kind in ["resourcepack", "shader"] {
            engine.import_content(&p.id, kind, &source).await.unwrap();
            let path = engine
                .instance(&p.id)
                .unwrap()
                .join(folder(kind).unwrap())
                .join("pack.zip");
            assert_eq!(std::fs::read(&path).unwrap(), b"complete archive");
            let items = engine.list_content(&p.id).await.unwrap();
            let item = items.iter().find(|c| c.kind == kind).unwrap();
            engine
                .manage_content(&p.id, &item.id, "toggle")
                .await
                .unwrap();
            assert!(!path.exists());
            assert!(path.with_file_name("pack.zip.disabled").exists());
            engine
                .manage_content(&p.id, &item.id, "toggle")
                .await
                .unwrap();
            assert!(path.exists());
            engine
                .manage_content(&p.id, &item.id, "remove")
                .await
                .unwrap();
            assert!(!path.exists());
        }
        assert!(engine.running.lock().await.contains_key(&p.id));
    }
}

#[tokio::test]
async fn running_mod_changes_and_mixed_dependency_plans_are_rejected() {
    let (dir, engine, p) = fixture(Loader::Fabric).await;
    let source = dir.path().join("mod.jar");
    std::fs::write(&source, b"mod").unwrap();
    assert!(engine
        .import_content(&p.id, "mod", &source)
        .await
        .unwrap_err()
        .to_string()
        .contains("остановите"));
    let mods = engine.instance(&p.id).unwrap().join("mods");
    std::fs::create_dir_all(&mods).unwrap();
    std::fs::write(mods.join("mod.jar"), b"mod").unwrap();
    let mut items = engine.list_content(&p.id).await.unwrap();
    let item = &mut items[0];
    for action in ["toggle", "remove"] {
        assert!(engine
            .manage_content(&p.id, &item.id, action)
            .await
            .is_err());
    }
    item.source = "modrinth".into();
    item.project_id = "mod".into();
    engine.remember_content(&p.id, &items).await.unwrap();
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), Some(p.id.clone()))
        .await
        .unwrap();
    assert!(engine
        .update_content(&p.id, &items[0].id, &task)
        .await
        .unwrap_err()
        .to_string()
        .contains("остановите"));
    assert!(engine
        .update_all_content(&p.id, &[items[0].id.clone()], &task)
        .await
        .is_err());
    assert!(engine
        .ensure_content_change(&p.id, &["resourcepack", "mod"], Some(&task.id))
        .await
        .is_err());
    assert!(engine
        .ensure_content_change(&p.id, &["shader", "resourcepack"], Some(&task.id))
        .await
        .is_ok());
    assert_eq!(std::fs::read(mods.join("mod.jar")).unwrap(), b"mod");
}

#[tokio::test]
async fn reloadable_content_still_respects_other_operations() {
    let (dir, engine, p) = fixture(Loader::Vanilla).await;
    let source = dir.path().join("pack.zip");
    std::fs::write(&source, b"pack").unwrap();
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), Some(p.id.clone()))
        .await
        .unwrap();
    assert!(engine
        .import_content(&p.id, "resourcepack", &source)
        .await
        .unwrap_err()
        .to_string()
        .contains("операции"));
    assert!(engine
        .ensure_content_change(&p.id, &["resourcepack"], Some(&task.id))
        .await
        .is_ok());
    assert!(engine
        .ensure_content_change(&p.id, &["unknown"], Some(&task.id))
        .await
        .is_err());
    let kinds = ["resourcepack"];
    let result = engine.ensure_content_change(&p.id, &kinds, None).await;
    engine.finish(&task, &result).await;
    engine
        .import_content(&p.id, "resourcepack", &source)
        .await
        .unwrap();
}
