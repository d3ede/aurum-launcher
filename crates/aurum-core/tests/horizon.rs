use aurum_core::{
    model::{Loader, Profile, ProfileIconStyle, Runtime},
    Engine,
};

#[tokio::test]
async fn legacy_profiles_keep_java_and_horizon_metadata_survives_restart() {
    let root = tempfile::tempdir().unwrap();
    let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
    let java = engine
        .create_profile(
            "Java".into(),
            "1.21.1".into(),
            Loader::Fabric,
            Some("0.16.0".into()),
            0,
        )
        .await
        .unwrap();
    let mut old = serde_json::to_value(&java).unwrap();
    old.as_object_mut().unwrap().remove("engine");
    assert_eq!(
        serde_json::from_value::<Profile>(old).unwrap().engine,
        Runtime::Java
    );
    let mut native = engine
        .create_profile_with_engine(
            "Horizon".into(),
            "26.3".into(),
            Loader::Vanilla,
            None,
            0,
            Runtime::Horizon,
        )
        .await
        .unwrap();
    for symbol in ["fabric", "forge", "neoforge", "quilt", "horizon", "vanilla"] {
        native.icon_style = Some(ProfileIconStyle {
            symbol: symbol.into(),
            color: "#ABCDEF".into(),
            background: "#123456".into(),
        });
        engine.update_profile(native.clone()).await.unwrap();
    }
    let restored = Engine::new(root.path().into(), |_| {}).await.unwrap();
    assert_eq!(
        restored.profile(&native.id).await.unwrap().engine,
        Runtime::Horizon
    );
    assert_eq!(
        restored.profile(&java.id).await.unwrap().engine,
        Runtime::Java
    );
    assert_ne!(
        restored.instance(&native.id).unwrap(),
        restored.instance(&java.id).unwrap()
    );
    // The frontend cannot turn an installed Java profile into another engine through settings.
    let mut forged = java.clone();
    forged.engine = Runtime::Horizon;
    restored.update_profile(forged).await.unwrap();
    assert_eq!(
        restored.profile(&java.id).await.unwrap().engine,
        Runtime::Java
    );
}

#[tokio::test]
async fn refuses_java_loaders_and_unowned_installation_before_downloading() {
    let root = tempfile::tempdir().unwrap();
    let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
    assert!(engine
        .create_profile_with_engine(
            "Wrong loader".into(),
            "26.3".into(),
            Loader::Fabric,
            Some("1".into()),
            0,
            Runtime::Horizon
        )
        .await
        .is_err());
    assert!(engine
        .create_profile_with_engine(
            "Wrong version".into(),
            "1.21.1".into(),
            Loader::Vanilla,
            None,
            0,
            Runtime::Horizon
        )
        .await
        .is_err());
    let profile = engine
        .create_profile_with_engine(
            "Horizon".into(),
            "26.3".into(),
            Loader::Vanilla,
            None,
            0,
            Runtime::Horizon,
        )
        .await
        .unwrap();
    let task = engine
        .task(uuid::Uuid::new_v4().to_string(), Some(profile.id.clone()))
        .await
        .unwrap();
    let error = engine
        .install(&profile.id, &task)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("Microsoft"), "{error}");
    assert!(!root.path().join("horizon").exists());
    assert!(engine
        .profile(&profile.id)
        .await
        .unwrap()
        .installed_version
        .is_none());
    let account = engine.add_offline("Tester".into()).await.unwrap();
    engine.select_account(account.id).await.unwrap();
    assert!(engine
        .install(&profile.id, &task)
        .await
        .unwrap_err()
        .to_string()
        .contains("Microsoft"));
}
