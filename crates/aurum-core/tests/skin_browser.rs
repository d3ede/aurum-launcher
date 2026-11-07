use aurum_core::Engine;

#[tokio::test]
#[ignore = "Contacts public MineSkin and Mojang APIs"]
async fn public_skin_discovery_and_import_need_no_player_account() {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/skin-browser");
    std::fs::create_dir_all(&root).unwrap();
    let directory = tempfile::tempdir_in(root).unwrap();
    let engine = Engine::new(directory.path().into(), |_| {}).await.unwrap();
    let page =
        serde_json::to_value(engine.browse_skins("knight", "latest", None).await.unwrap()).unwrap();
    let entries = page["skins"].as_array().unwrap();
    assert!(!entries.is_empty());
    let texture = engine
        .skin_browser_texture(entries[0]["hash"].as_str().unwrap())
        .await
        .unwrap();
    assert!(texture.starts_with("data:image/png;base64,"));
    let skin = engine
        .skin_browser_skin(entries[0]["id"].as_str().unwrap(), "mineskin")
        .await
        .unwrap();
    assert!(matches!(skin.model.as_str(), "alex" | "steve"));
    assert!(engine.skin_library().await.unwrap().skins.is_empty());
    let player = engine.skin_browser_skin("Notch", "player").await.unwrap();
    assert_eq!(player.name.as_deref(), Some("Notch"));
    assert!(player.texture.starts_with("data:image/png;base64,"));
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(skin.texture.split_once(',').unwrap().1)
        .unwrap();
    engine
        .save_library_skin(
            None,
            skin.name.unwrap_or_else(|| "Test skin".into()),
            skin.model,
            bytes,
            None,
        )
        .await
        .unwrap();
    let restarted = Engine::new(directory.path().into(), |_| {}).await.unwrap();
    assert_eq!(restarted.skin_library().await.unwrap().skins.len(), 1);
    assert!(restarted.snapshot().await.database.accounts.is_empty());
}
