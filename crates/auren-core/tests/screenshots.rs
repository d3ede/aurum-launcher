use auren_core::{model::Loader, Engine};
use std::{io::Cursor, path::Path};
fn root() -> tempfile::TempDir {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/screenshot-library");
    std::fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}
fn png() -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(64, 32)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}
#[tokio::test]
async fn lists_per_instance_and_globally_and_never_treats_other_files_as_screenshots() {
    let root = root();
    let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
    let a = engine
        .create_profile(
            "First world".into(),
            "1.21.1".into(),
            Loader::Vanilla,
            None,
            0,
        )
        .await
        .unwrap();
    let b = engine
        .create_profile(
            "Second world".into(),
            "1.21.1".into(),
            Loader::Vanilla,
            None,
            0,
        )
        .await
        .unwrap();
    for (profile, name) in [
        (&a, "2026-11-07_12.00.00.png"),
        (&b, "2026-11-07_13.00.00.png"),
    ] {
        let directory = engine.instance(&profile.id).unwrap().join("screenshots");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join(name), png()).unwrap();
        std::fs::write(directory.join("fake.png"), b"not an image").unwrap();
        std::fs::write(directory.join("private.txt"), b"not a screenshot").unwrap();
    }
    let all = engine.screenshots(None).await.unwrap();
    assert_eq!(all.items.len(), 2);
    let first = engine.screenshots(Some(&a.id)).await.unwrap();
    assert_eq!(first.items.len(), 1);
    assert_eq!(first.items[0].profile_name, "First world");
    assert_eq!(
        engine.screenshot_bytes(&first.items[0].id).await.unwrap(),
        png()
    );
    assert!(engine
        .screenshot_image(&first.items[0].id, true)
        .await
        .unwrap()
        .starts_with("data:image/jpeg;base64,"));
    assert!(engine
        .screenshots(Some(&uuid::Uuid::new_v4().to_string()))
        .await
        .is_err());
    std::fs::remove_file(
        engine
            .instance(&a.id)
            .unwrap()
            .join("screenshots/2026-11-07_12.00.00.png"),
    )
    .unwrap();
    assert!(engine.screenshot_bytes(&first.items[0].id).await.is_err());
}
