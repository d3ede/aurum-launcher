//! Launcher-owned file inbox for Minecraft's native LAN connection screen.
use crate::{servers::ServerAddress, Task};
use anyhow::{bail, Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

const AGENT: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/aurum-lan-join.jar"));
const CLASSES: &[(&str, &str)] = &[
    ("minecraft", "net.minecraft.client.Minecraft"),
    ("screen", "net.minecraft.client.gui.screens.Screen"),
    ("title", "net.minecraft.client.gui.screens.TitleScreen"),
    (
        "multiplayer",
        "net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen",
    ),
    ("overlay", "net.minecraft.client.gui.screens.Overlay"),
    ("gui", "net.minecraft.client.gui.Gui"),
    ("level", "net.minecraft.client.multiplayer.ClientLevel"),
    ("player", "net.minecraft.client.player.LocalPlayer"),
    (
        "disconnect",
        "net.minecraft.client.gui.screens.DisconnectedScreen",
    ),
    ("server", "net.minecraft.client.multiplayer.ServerData"),
    (
        "address",
        "net.minecraft.client.multiplayer.resolver.ServerAddress",
    ),
    ("connect", "net.minecraft.client.gui.screens.ConnectScreen"),
];

fn class_aliases(mappings: &str) -> BTreeMap<&'static str, String> {
    let mut aliases = CLASSES
        .iter()
        .map(|(role, name)| (*role, (*name).to_string()))
        .collect::<BTreeMap<_, _>>();
    for line in mappings
        .lines()
        .filter(|s| !s.starts_with(char::is_whitespace))
    {
        if let Some((name, obfuscated)) = line.trim_end().trim_end_matches(':').split_once(" -> ") {
            if let Some((role, _)) = CLASSES.iter().find(|(_, named)| name == *named) {
                if !obfuscated.is_empty()
                    && obfuscated
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "_.$".contains(c))
                {
                    aliases
                        .get_mut(role)
                        .unwrap()
                        .push_str(&format!(",{obfuscated}"));
                }
            }
        }
    }
    aliases
}
fn property(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn disconnect_aliases(mappings: &str, signature: &str) -> String {
    let mut inside = false;
    let mut aliases = vec!["disconnect".to_string()];
    for line in mappings.lines() {
        if !line.starts_with(char::is_whitespace) {
            inside = line.starts_with("net.minecraft.client.Minecraft -> ");
        } else if inside {
            if let Some((mapped_signature, name)) = line.trim().split_once(" -> ") {
                if mapped_signature.ends_with(signature)
                    && name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "_$".contains(c))
                {
                    aliases.push(name.into());
                }
            }
        }
    }
    aliases.join(",")
}

/// A session-specific inbox prevents requests from an earlier JVM being replayed.
pub(crate) async fn request(instance: &Path, target: &ServerAddress, name: &str) -> Result<bool> {
    let ip: std::net::IpAddr = target.host.parse()?;
    if !ip.is_loopback() {
        bail!("Social target must be the local broker bridge");
    }
    let directory = instance.join(".aurum/social");
    let Ok(session) = tokio::fs::read_to_string(directory.join("bridge-session")).await else {
        return Ok(false);
    };
    let session = uuid::Uuid::parse_str(session.trim())?.to_string();
    let request = directory.join(format!("{session}.request"));
    let temporary = directory.join(format!("{}.part", uuid::Uuid::new_v4()));
    let properties = format!(
        "host={}\nport={}\nname={}\n",
        target.host,
        target.port,
        property(name)
    );
    tokio::fs::write(directory.join("agent-state"), "waiting\n").await?;
    tokio::fs::write(&temporary, properties).await?;
    tokio::fs::rename(&temporary, request).await?;
    Ok(true)
}

pub(crate) async fn prepare(
    engine: &crate::Engine,
    instance: &Path,
    client: &Path,
    meta: &Value,
    target: Option<&ServerAddress>,
    name: &str,
    task: &Task,
) -> Result<Option<String>> {
    let root = &engine.root;
    let directory = instance.join(".aurum/social");
    tokio::fs::create_dir_all(&directory).await?;
    let _ = tokio::fs::remove_file(directory.join("bridge-session")).await;
    let client = client.to_path_buf();
    let named = tokio::task::spawn_blocking(move || -> Result<bool> {
        let mut jar = zip::ZipArchive::new(std::fs::File::open(client)?)?;
        let named = jar.by_name("net/minecraft/client/Minecraft.class").is_ok();
        Ok(named)
    })
    .await??;
    let mut mappings = String::new();
    if !named {
        let entry = &meta["downloads"]["client_mappings"];
        let (Some(url), Some(sha1)) = (entry["url"].as_str(), entry["sha1"].as_str()) else {
            return Ok(None);
        };
        let url_parsed = reqwest::Url::parse(url)?;
        if url_parsed.scheme() != "https"
            || !matches!(
                url_parsed.host_str(),
                Some("piston-data.mojang.com" | "launcher.mojang.com")
            )
        {
            bail!("Unsupported official mapping origin");
        }
        if sha1.len() != 40
            || !sha1.bytes().all(|c| c.is_ascii_hexdigit())
            || entry["size"].as_u64().unwrap_or(u64::MAX) > 32_000_000
        {
            bail!("Invalid official mappings metadata");
        }
        let path = root
            .join("cache/social-mappings")
            .join(format!("{sha1}.txt"));
        tokio::time::timeout(
            std::time::Duration::from_secs(8),
            engine.download(url, &path, Some(("sha1", sha1)), task),
        )
        .await
        .context("Social mappings download timed out")??;
        if tokio::fs::metadata(&path).await?.len() > 32_000_000 {
            bail!("Official mappings exceed limit");
        }
        mappings = tokio::fs::read_to_string(path).await?;
    }
    task.check()?;
    let filename = format!("lan-join-{:x}.jar", Sha256::digest(AGENT));
    let jar = directory.join(&filename);
    if !crate::net::verify(
        &jar,
        Some(("sha256", &format!("{:x}", Sha256::digest(AGENT)))),
    )
    .await
    .unwrap_or(false)
    {
        tokio::fs::write(&jar, AGENT).await?;
    }
    let session = uuid::Uuid::new_v4();
    let configuration = format!("{session}.properties");
    let status = directory.join("agent-state");
    tokio::fs::write(&status, "idle\n").await?;
    let mut properties = format!(
        "request={}\nstatus={}\nmethod.disconnect={}\nmethod.disconnectScreen={}\n",
        property(
            &directory
                .join(format!("{session}.request"))
                .to_string_lossy()
        ),
        property(&status.to_string_lossy()),
        disconnect_aliases(&mappings, "void disconnect()"),
        disconnect_aliases(
            &mappings,
            "void disconnect(net.minecraft.client.gui.screens.Screen,boolean)"
        )
    );
    for (role, aliases) in class_aliases(&mappings) {
        properties.push_str(&format!("class.{role}={aliases}\n"));
    }
    tokio::fs::write(directory.join(&configuration), properties).await?;
    tokio::fs::write(directory.join("bridge-session"), session.to_string()).await?;
    if let Some(target) = target {
        request(instance, target, name).await?;
    }
    Ok(Some(format!(
        "-javaagent:.aurum/social/{filename}=.aurum/social/{configuration}"
    )))
}

pub(crate) async fn state(instance: &Path) -> Result<String> {
    let path = instance.join(".aurum/social/agent-state");
    if !path.is_file() {
        return Ok("unsupported".into());
    }
    if tokio::fs::metadata(&path).await?.len() > 64 {
        bail!("Invalid LAN launch state");
    }
    let state = tokio::fs::read_to_string(path).await?;
    let state = state.trim();
    if matches!(
        state,
        "idle"
            | "waiting"
            | "menu-required"
            | "connecting"
            | "joined"
            | "game-screen"
            | "unsupported"
            | "timeout"
    ) {
        Ok(state.into())
    } else {
        Ok("waiting".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn agent_reuses_one_jvm_saves_the_world_and_consumes_each_request_once() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("LanJoinAgentProbe.java");
        std::fs::write(
            &source,
            include_str!("../tests/java/LanJoinAgentProbe.java"),
        )
        .unwrap();
        let mut compile = std::process::Command::new("javac");
        compile
            .args(["--release", "8", "-encoding", "UTF-8"])
            .arg(&source);
        assert!(compile.status().unwrap().success());
        let jar = root.path().join("agent.jar");
        std::fs::write(&jar, AGENT).unwrap();
        let inbox = root.path().join("inbox");
        let status = root.path().join("state");
        let configuration = root.path().join("agent.properties");
        let mut properties = format!(
            "request={}\nstatus={}\n",
            property(&inbox.to_string_lossy()),
            property(&status.to_string_lossy())
        );
        for (role, fixture) in [
            ("minecraft", "Client"),
            ("screen", "Screen"),
            ("title", "Title"),
            ("multiplayer", "Multiplayer"),
            ("disconnect", "Disconnected"),
            ("overlay", "Overlay"),
            ("gui", "Gui"),
            ("level", "Level"),
            ("player", "Player"),
            ("server", "Server"),
            ("address", "Address"),
            ("connect", "Connect"),
        ] {
            properties.push_str(&format!("class.{role}=LanJoinAgentProbe${fixture}\n"));
        }
        std::fs::write(&configuration, properties).unwrap();
        let output = std::process::Command::new("java")
            .arg(format!(
                "-javaagent:{}={}",
                jar.display(),
                configuration.display()
            ))
            .arg("-cp")
            .arg(root.path())
            .arg("LanJoinAgentProbe")
            .arg(inbox)
            .arg(status)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    #[test]
    fn aliases_only_accept_class_entries_and_preserve_named_fallback() {
        let aliases = class_aliases("net.minecraft.client.Minecraft -> abc:\n    int screen -> z\nnet.minecraft.client.gui.screens.Screen -> xyz:\nnet.minecraft.client.multiplayer.ServerData -> ../bad:\n");
        assert_eq!(aliases["minecraft"], "net.minecraft.client.Minecraft,abc");
        assert_eq!(
            aliases["screen"],
            "net.minecraft.client.gui.screens.Screen,xyz"
        );
        assert_eq!(
            aliases["server"],
            "net.minecraft.client.multiplayer.ServerData"
        );
        assert_eq!(property("Test\\n\nname"), "Test\\\\n\\nname");
    }
    #[tokio::test]
    async fn malformed_status_is_not_a_success() {
        let dir = tempfile::tempdir().unwrap();
        tokio::fs::create_dir_all(dir.path().join(".aurum/social"))
            .await
            .unwrap();
        tokio::fs::write(
            dir.path().join(".aurum/social/agent-state"),
            "joined\nnot-joined",
        )
        .await
        .unwrap();
        assert_eq!(state(dir.path()).await.unwrap(), "waiting");
    }

    #[test]
    fn disconnect_mapping_uses_only_the_exact_client_method() {
        assert_eq!(disconnect_aliases("net.minecraft.client.Minecraft -> abc:\n    1:2:void disconnect() -> q\n    1:2:void disconnect(boolean) -> z\nnet.minecraft.Other -> other:\n    void disconnect() -> wrong\n", "void disconnect()"), "disconnect,q");
    }

    #[tokio::test]
    async fn running_session_accepts_repeated_loopback_requests_only() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join(".aurum/social");
        tokio::fs::create_dir_all(&directory).await.unwrap();
        let first = ServerAddress::parse("127.0.0.1:30001").unwrap();
        assert!(!request(root.path(), &first, "First").await.unwrap());
        let session = uuid::Uuid::new_v4();
        tokio::fs::write(directory.join("bridge-session"), session.to_string())
            .await
            .unwrap();
        assert!(request(root.path(), &first, "First\nname").await.unwrap());
        let path = directory.join(format!("{session}.request"));
        assert!(tokio::fs::read_to_string(&path)
            .await
            .unwrap()
            .contains("name=First\\nname"));
        let second = ServerAddress::parse("[::1]:30002").unwrap();
        assert!(request(root.path(), &second, "Second").await.unwrap());
        let saved = tokio::fs::read_to_string(&path).await.unwrap();
        assert!(saved.contains("port=30002\n"));
        let remote = ServerAddress::parse("192.0.2.1:30003").unwrap();
        assert!(request(root.path(), &remote, "Remote").await.is_err());
        assert_eq!(tokio::fs::read_to_string(path).await.unwrap(), saved);
    }

    #[tokio::test]
    async fn an_old_running_game_uses_lan_fallback_without_launching_a_duplicate() {
        let root = tempfile::tempdir().unwrap();
        let engine = crate::Engine::new(root.path().to_path_buf(), |_| {})
            .await
            .unwrap();
        let p = engine
            .create_profile(
                "Running".into(),
                "1.21.1".into(),
                crate::model::Loader::Vanilla,
                None,
                0,
            )
            .await
            .unwrap();
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        engine
            .running
            .lock()
            .await
            .insert(p.id.clone(), stop.clone());
        let task = engine
            .task(uuid::Uuid::new_v4().to_string(), Some(p.id.clone()))
            .await
            .unwrap();
        assert!(!engine
            .launch_social_server(&p.id, "127.0.0.1:30001", &task)
            .await
            .unwrap());
        assert!(std::sync::Arc::ptr_eq(
            &stop,
            engine.running.lock().await.get(&p.id).unwrap()
        ));
        assert!(!stop.load(std::sync::atomic::Ordering::Relaxed));
    }
}
