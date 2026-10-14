use auren_core::{model::*, Engine};

#[tokio::test]
async fn icon_style_survives_restart_and_invalid_edits_leave_saved_style_intact() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let mut profile = engine
        .create_profile(
            "Icon test".into(),
            "1.21.1".into(),
            Loader::Vanilla,
            None,
            2,
        )
        .await
        .unwrap();
    let mut legacy = serde_json::to_value(&profile).unwrap();
    legacy.as_object_mut().unwrap().remove("iconStyle");
    assert!(serde_json::from_value::<Profile>(legacy)
        .unwrap()
        .icon_style
        .is_none());
    profile.icon_style = Some(ProfileIconStyle {
        symbol: "rocket".into(),
        color: "#abcdef".into(),
        background: "#123456".into(),
    });
    engine.update_profile(profile.clone()).await.unwrap();
    let restored = Engine::new(dir.path().into(), |_| {}).await.unwrap();
    let saved = restored
        .profile(&profile.id)
        .await
        .unwrap()
        .icon_style
        .unwrap();
    assert_eq!(saved.symbol, "rocket");
    assert_eq!(saved.color, "#ABCDEF");
    assert_eq!(saved.background, "#123456");
    for invalid in ["red", "#123", "#GGGGGG", "url(test)", "#12345678"] {
        profile.icon_style.as_mut().unwrap().background = invalid.into();
        assert!(restored.update_profile(profile.clone()).await.is_err());
        assert_eq!(
            restored
                .profile(&profile.id)
                .await
                .unwrap()
                .icon_style
                .unwrap()
                .background,
            "#123456"
        );
    }
    profile.icon_style.as_mut().unwrap().background = "#123456".into();
    profile.icon_style.as_mut().unwrap().symbol = "unknown".into();
    assert!(restored.update_profile(profile.clone()).await.is_err());
    profile.icon_style = None;
    restored.update_profile(profile.clone()).await.unwrap();
    assert!(restored
        .profile(&profile.id)
        .await
        .unwrap()
        .icon_style
        .is_none());
}
