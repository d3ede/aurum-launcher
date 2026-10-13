#![cfg(windows)]
use auren_core::{model::Loader, Engine};
use std::{
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
};

struct OwnedJava(Child);
impl Drop for OwnedJava {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
async fn java(root: &Path, directory: &Path, label: &str) -> OwnedJava {
    let executable = std::env::var_os("AURUM_PROCESS_TEST_JAVA")
        .expect("Set AURUM_PROCESS_TEST_JAVA to a JDK 11+ java.exe");
    let source = root.join(format!("SessionFixture{label}.java"));
    std::fs::create_dir_all(directory).unwrap();
    std::fs::write(&source, format!(r#"class SessionFixture{label} {{
        public static void main(String[] args) throws Exception {{
            java.nio.file.Files.writeString(java.nio.file.Path.of(args[1], "ready-{label}"), "ready");
            Thread.sleep(600000);
        }}
    }}"#)).unwrap();
    let child = Command::new(executable)
        .arg(source)
        .arg("--gameDir")
        .arg(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x08000000)
        .spawn()
        .unwrap();
    let mut child = OwnedJava(child);
    for _ in 0..100 {
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "Owned Java fixture exited before readiness"
        );
        if directory.join(format!("ready-{label}")).exists() {
            return child;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    panic!("Owned Java fixture did not become ready");
}
async fn profile(root: &Path) -> (Engine, String, PathBuf) {
    let engine = Engine::new(root.join("Aurum"), |_| {}).await.unwrap();
    let profile = engine
        .create_profile(
            "Session test".into(),
            "1.21.1".into(),
            Loader::Vanilla,
            None,
            1,
        )
        .await
        .unwrap();
    let directory = engine.instance(&profile.id).unwrap();
    std::fs::create_dir_all(&directory).unwrap();
    (engine, profile.id, directory)
}

#[tokio::test]
#[ignore = "requires AURUM_PROCESS_TEST_JAVA; uses only owned temporary Java fixtures"]
async fn reopen_restores_running_and_stops_only_the_matching_game() {
    let root = tempfile::tempdir().unwrap();
    let (engine, id, directory) = profile(root.path()).await;
    let mut game = java(root.path(), &directory, "Game").await;
    let mut unrelated = java(root.path(), &root.path().join("Unrelated"), "Other").await;
    let data = engine.root.clone();
    drop(engine);
    let reopened = Engine::new(data, |_| {}).await.unwrap();
    assert_eq!(reopened.snapshot().await.running, vec![id.clone()]);
    assert!(reopened.ensure_idle(&id).await.is_err());
    assert!(reopened
        .launch(&id)
        .await
        .unwrap_err()
        .to_string()
        .contains("уже запущена"));
    reopened.stop(&id).await.unwrap();
    assert!(reopened.snapshot().await.running.is_empty());
    assert!(game.0.try_wait().unwrap().is_some());
    assert!(
        unrelated.0.try_wait().unwrap().is_none(),
        "Unrelated Java must remain running"
    );
}

#[tokio::test]
#[ignore = "requires AURUM_PROCESS_TEST_JAVA; uses only owned temporary Java fixtures"]
async fn exited_game_is_removed_and_does_not_return_as_a_ghost() {
    let root = tempfile::tempdir().unwrap();
    let (engine, id, directory) = profile(root.path()).await;
    let mut game = java(root.path(), &directory, "Exit").await;
    let reopened = Engine::new(engine.root.clone(), |_| {}).await.unwrap();
    assert!(reopened.snapshot().await.running.contains(&id));
    game.0.kill().unwrap();
    game.0.wait().unwrap();
    assert!(reopened.snapshot().await.running.is_empty());
    reopened.ensure_idle(&id).await.unwrap();
    let again = Engine::new(engine.root.clone(), |_| {}).await.unwrap();
    assert!(again.snapshot().await.running.is_empty());
}

#[tokio::test]
#[ignore = "requires AURUM_PROCESS_TEST_JAVA; uses only owned temporary Java fixtures"]
async fn multiple_existing_processes_for_one_profile_are_stopped_together() {
    let root = tempfile::tempdir().unwrap();
    let (engine, id, directory) = profile(root.path()).await;
    let mut first = java(root.path(), &directory, "First").await;
    let mut second = java(root.path(), &directory, "Second").await;
    let reopened = Engine::new(engine.root.clone(), |_| {}).await.unwrap();
    assert_eq!(reopened.snapshot().await.running, vec![id.clone()]);
    reopened.stop(&id).await.unwrap();
    assert!(reopened.snapshot().await.running.is_empty());
    assert!(first.0.try_wait().unwrap().is_some());
    assert!(second.0.try_wait().unwrap().is_some());
}
