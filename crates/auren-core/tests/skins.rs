use auren_core::{
    skins::{default_texture, validate_texture},
    Engine,
};
use image::{DynamicImage, ImageFormat};
fn texture(width: u32, height: u32) -> Vec<u8> {
    let mut out = std::io::Cursor::new(vec![]);
    DynamicImage::new_rgba8(width, height)
        .write_to(&mut out, ImageFormat::Png)
        .unwrap();
    out.into_inner()
}

#[tokio::test]
async fn account_avatars_follow_applied_skins_and_survive_restart() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/avatars");
    std::fs::create_dir_all(&root).unwrap();
    let directory = tempfile::tempdir_in(root).unwrap();
    let engine = Engine::new(directory.path().into(), |_| {}).await.unwrap();
    let account = engine.add_offline("AvatarTest".into()).await.unwrap();
    assert_eq!(
        engine.account_avatar(&account.id).await.unwrap(),
        auren_core::skins::encode_texture(&default_texture("default:steve", "steve").unwrap())
    );
    engine
        .apply_library_skin(&account.id, "default:zuri", "alex", None)
        .await
        .unwrap();
    let expected =
        auren_core::skins::encode_texture(&default_texture("default:zuri", "alex").unwrap());
    assert_eq!(engine.account_avatar(&account.id).await.unwrap(), expected);
    let restarted = Engine::new(directory.path().into(), |_| {}).await.unwrap();
    assert_eq!(
        restarted.account_avatar(&account.id).await.unwrap(),
        expected
    );
    engine
        .apply_library_skin(&account.id, "default:ari", "alex", None)
        .await
        .unwrap();
    assert_ne!(engine.account_avatar(&account.id).await.unwrap(), expected);
    assert!(engine.account_avatar("not-an-account").await.is_err());
}

#[tokio::test]
async fn microsoft_avatar_cache_works_without_network_or_stored_credentials() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/avatars");
    std::fs::create_dir_all(&root).unwrap();
    let directory = tempfile::tempdir_in(root).unwrap();
    let engine = Engine::new(directory.path().into(), |_| {}).await.unwrap();
    let account = engine.add_offline("AvatarCacheTest".into()).await.unwrap();
    engine
        .apply_library_skin(&account.id, "default:efe", "alex", None)
        .await
        .unwrap();
    let expected =
        auren_core::skins::encode_texture(&default_texture("default:efe", "alex").unwrap());
    engine.db.lock().await.accounts[0].kind = "microsoft".into();
    engine.db.lock().await.accounts[0].has_skin = false;
    assert_eq!(engine.account_avatar(&account.id).await.unwrap(), expected);
}

#[test]
fn all_nine_default_characters_have_both_models() {
    for name in [
        "steve", "alex", "ari", "efe", "kai", "makena", "noor", "sunny", "zuri",
    ] {
        for model in ["steve", "alex"] {
            let bytes = default_texture(&format!("default:{name}"), model).unwrap();
            assert!(validate_texture(&bytes, false).is_ok());
        }
    }
    assert!(default_texture("default:../secret", "steve").is_err());
    assert!(default_texture("default:steve", "unknown").is_err());
}
#[test]
fn image_formats_and_dimensions_are_validated_before_decoding() {
    assert!(validate_texture(&texture(64, 64), false).is_ok());
    assert!(validate_texture(&texture(64, 32), false).is_ok());
    assert!(validate_texture(&texture(64, 32), true).is_ok());
    assert!(validate_texture(&texture(64, 64), true).is_err());
    assert!(validate_texture(&texture(128, 128), false).is_err());
    assert!(validate_texture(b"not a PNG", false).is_err());
    assert!(validate_texture(&vec![0; 1_000_001], false).is_err());
}
#[tokio::test]
async fn library_retains_multiple_skins_capes_models_and_selection_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let account = e.add_offline("SkinTest".into()).await.unwrap();
    let cape = e
        .save_library_cape("My cape".into(), texture(64, 32))
        .await
        .unwrap();
    let first = e
        .save_library_skin(
            None,
            "One".into(),
            "steve".into(),
            default_texture("default:steve", "steve").unwrap(),
            Some(cape.id.clone()),
        )
        .await
        .unwrap();
    let second = e
        .save_library_skin(
            None,
            "Two".into(),
            "alex".into(),
            default_texture("default:efe", "alex").unwrap(),
            None,
        )
        .await
        .unwrap();
    e.apply_library_skin(&account.id, &first.id, &first.model, first.cape_id.clone())
        .await
        .unwrap();
    let engine = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let lib = engine.skin_library().await.unwrap();
    assert_eq!(lib.skins.len(), 2);
    assert_eq!(lib.capes.len(), 1);
    assert_eq!(lib.selections[&account.id].skin_id, first.id);
    assert_eq!(lib.selections[&account.id].cape_id, Some(cape.id.clone()));
    assert!(engine
        .account_appearance(&account.id)
        .await
        .unwrap()
        .texture
        .starts_with("data:image/png;base64,"));
    engine
        .apply_library_skin(&account.id, &second.id, &second.model, None)
        .await
        .unwrap();
    assert_eq!(
        engine.skin_library().await.unwrap().selections[&account.id].skin_id,
        second.id
    );
    assert_eq!(
        engine.snapshot().await.database.accounts[0].skin_model,
        "alex"
    );
}
#[tokio::test]
async fn editing_deleting_and_invalid_inputs_preserve_other_saved_skins() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let png = texture(64, 64);
    let a = e
        .save_library_skin(None, "A".into(), "steve".into(), png.clone(), None)
        .await
        .unwrap();
    let b = e
        .save_library_skin(None, "B".into(), "alex".into(), png.clone(), None)
        .await
        .unwrap();
    e.save_library_skin(
        Some(a.id.clone()),
        "Updated".into(),
        "alex".into(),
        png.clone(),
        None,
    )
    .await
    .unwrap();
    assert!(e
        .save_library_skin(None, "Bad".into(), "steve".into(), b"broken".to_vec(), None)
        .await
        .is_err());
    assert!(e
        .save_library_skin(
            None,
            "Bad cape".into(),
            "steve".into(),
            png,
            Some("../outside".into())
        )
        .await
        .is_err());
    assert_eq!(e.skin_library().await.unwrap().skins.len(), 2);
    e.delete_library_item(&a.id, false).await.unwrap();
    let library = e.skin_library().await.unwrap();
    assert_eq!(library.skins.len(), 1);
    assert_eq!(library.skins[0].id, b.id);
}
#[tokio::test]
async fn legacy_account_skin_is_preserved_and_library_is_independent_of_account_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let account = e.add_offline("LegacySkin".into()).await.unwrap();
    let path = dir.path().join("upload.png");
    std::fs::write(&path, texture(64, 32)).unwrap();
    e.set_skin(&account.id, &path, "steve").await.unwrap();
    let before = e.skin(&account.id).await.unwrap();
    let skin = e
        .save_library_skin(None, "Saved".into(), "steve".into(), before.clone(), None)
        .await
        .unwrap();
    assert_eq!(e.skin(&account.id).await.unwrap(), before);
    e.delete_account(account.id).await.unwrap();
    assert_eq!(e.skin_library().await.unwrap().skins[0].id, skin.id);
}
#[tokio::test]
async fn defaults_can_be_applied_and_unowned_capes_are_rejected_without_changing_skin() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let account = e.add_offline("CapeCheck".into()).await.unwrap();
    e.apply_library_skin(&account.id, "default:zuri", "alex", None)
        .await
        .unwrap();
    let bytes = e.skin(&account.id).await.unwrap();
    assert!(e
        .apply_library_skin(
            &account.id,
            "default:steve",
            "steve",
            Some(format!("owned:{}", uuid::Uuid::new_v4()))
        )
        .await
        .is_err());
    assert_eq!(e.skin(&account.id).await.unwrap(), bytes);
}
#[tokio::test]
async fn corrupted_library_is_not_silently_reset() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let path = dir.path().join("skin-library.json");
    std::fs::write(&path, b"broken").unwrap();
    assert!(e.skin_library().await.is_err());
    assert_eq!(std::fs::read(path).unwrap(), b"broken");
}
