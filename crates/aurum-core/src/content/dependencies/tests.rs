use super::*;
use crate::Engine;
use serde_json::json;
use sha1::{Digest, Sha1};

const BYTES: &[u8] = b"verified installed Superb Warfare fixture";

async fn fixture() -> (tempfile::TempDir, Profile, std::path::PathBuf, Content) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/content-dependencies");
    std::fs::create_dir_all(&root).unwrap();
    let directory = tempfile::tempdir_in(root).unwrap();
    let engine = Engine::new(directory.path().into(), |_| {}).await.unwrap();
    let profile = engine
        .create_profile(
            "Existing Forge pack".into(),
            "1.20.1".into(),
            Loader::Forge,
            Some("47.4.10".into()),
            0,
        )
        .await
        .unwrap();
    let instance = engine.instance(&profile.id).unwrap();
    let filename = "superbwarfare-0.8.9.1-hotfix.jar";
    std::fs::create_dir_all(instance.join("mods")).unwrap();
    std::fs::write(instance.join("mods").join(filename), BYTES).unwrap();
    let item = Content {
        id: "local:mod:superbwarfare".into(),
        source: "modrinth".into(),
        project_id: "Cd3DYqzn".into(),
        version_id: "mHmtMuKF".into(),
        name: "Superb Warfare".into(),
        filename: filename.into(),
        kind: "mod".into(),
        enabled: true,
        info: ContentInfo::default(),
    };
    (directory, profile, instance, item)
}

fn installed_version() -> Value {
    json!({"id":"mHmtMuKF", "project_id":"Cd3DYqzn", "game_versions":["1.20.1"],
        "loaders":["forge"], "files":[{"filename":"superbwarfare-0.8.9.1-hotfix.jar",
        "hashes":{"sha1":format!("{:x}", Sha1::digest(BYTES))}}]})
}

fn bad_pin() -> Value {
    json!({"id":"Qdwf6rIX", "project_id":"Cd3DYqzn", "game_versions":["1.21.1"], "loaders":["neoforge"]})
}

fn dependency() -> Value {
    json!({"project_id":"Cd3DYqzn", "version_id":"Qdwf6rIX", "dependency_type":"required"})
}

#[tokio::test]
async fn frontline_reuses_verified_forge_mod_instead_of_foreign_neoforge_pin() {
    let (_dir, profile, instance, item) = fixture().await;
    let mut requested = vec![];
    let chosen = reusable_modrinth_dependency(
        &profile,
        &instance,
        &[item],
        &dependency(),
        Some(&bad_pin()),
        |id| {
            requested.push(id);
            std::future::ready(Ok(installed_version()))
        },
    )
    .await
    .unwrap();
    assert_eq!(chosen, Some(("Cd3DYqzn".into(), "mHmtMuKF".into())));
    assert_eq!(requested, ["mHmtMuKF"]);
    assert_eq!(
        std::fs::read(instance.join("mods/superbwarfare-0.8.9.1-hotfix.jar")).unwrap(),
        BYTES
    );
}

#[tokio::test]
async fn project_only_dependency_keeps_installed_version_and_explicit_compatible_pins_win() {
    let (_dir, profile, instance, item) = fixture().await;
    let chosen = reusable_modrinth_dependency(
        &profile,
        &instance,
        std::slice::from_ref(&item),
        &json!({"project_id":"Cd3DYqzn"}),
        None,
        |_| std::future::ready(Ok(installed_version())),
    )
    .await
    .unwrap();
    assert_eq!(chosen, Some(("Cd3DYqzn".into(), "mHmtMuKF".into())));
    let valid_pin = json!({"id":"exact-other-release", "project_id":"Cd3DYqzn", "game_versions":["1.20.1"], "loaders":["forge"]});
    let chosen = reusable_modrinth_dependency(
        &profile,
        &instance,
        &[item],
        &dependency(),
        Some(&valid_pin),
        |_| async { panic!("A compatible exact pin must not be substituted") },
    )
    .await
    .unwrap();
    assert_eq!(chosen, None);
}

#[tokio::test]
async fn disabled_missing_changed_or_other_provider_mods_cannot_satisfy_dependency() {
    for scenario in ["disabled", "missing", "changed", "other-provider"] {
        let (_dir, profile, instance, mut item) = fixture().await;
        let path = instance.join("mods").join(&item.filename);
        match scenario {
            "disabled" => {
                item.enabled = false;
                std::fs::rename(&path, path.with_extension("jar.disabled")).unwrap();
            }
            "missing" => std::fs::remove_file(&path).unwrap(),
            "changed" => std::fs::write(&path, b"different jar under the old filename").unwrap(),
            "other-provider" => item.source = "curseforge".into(),
            _ => unreachable!(),
        }
        let chosen = reusable_modrinth_dependency(
            &profile,
            &instance,
            &[item],
            &dependency(),
            Some(&bad_pin()),
            |_| std::future::ready(Ok(installed_version())),
        )
        .await
        .unwrap();
        assert_eq!(chosen, None, "{scenario}");
    }
}

#[tokio::test]
async fn installed_metadata_must_match_project_version_profile_and_file_hash() {
    for scenario in [
        "project",
        "version",
        "minecraft",
        "loader",
        "hash",
        "filename",
    ] {
        let (_dir, profile, instance, item) = fixture().await;
        let mut raw = installed_version();
        match scenario {
            "project" => raw["project_id"] = json!("unrelated-project"),
            "version" => raw["id"] = json!("another-version"),
            "minecraft" => raw["game_versions"] = json!(["1.21.1"]),
            "loader" => raw["loaders"] = json!(["neoforge"]),
            "hash" => raw["files"][0]["hashes"]["sha1"] = Value::Null,
            "filename" => raw["files"][0]["filename"] = json!("other.jar"),
            _ => unreachable!(),
        }
        let chosen = reusable_modrinth_dependency(
            &profile,
            &instance,
            &[item],
            &dependency(),
            Some(&bad_pin()),
            |_| std::future::ready(Ok(raw.clone())),
        )
        .await
        .unwrap();
        assert_eq!(chosen, None, "{scenario}");
    }
}

#[tokio::test]
async fn pin_without_project_id_can_reuse_but_mismatched_project_is_rejected() {
    let (_dir, profile, instance, item) = fixture().await;
    let chosen = reusable_modrinth_dependency(
        &profile,
        &instance,
        std::slice::from_ref(&item),
        &json!({"version_id":"Qdwf6rIX"}),
        Some(&bad_pin()),
        |_| std::future::ready(Ok(installed_version())),
    )
    .await
    .unwrap();
    assert!(chosen.is_some());
    let result = reusable_modrinth_dependency(
        &profile,
        &instance,
        &[item],
        &json!({"project_id":"another-project", "version_id":"Qdwf6rIX"}),
        Some(&bad_pin()),
        |_| std::future::ready(Ok(installed_version())),
    )
    .await;
    assert!(result.is_err());
}
