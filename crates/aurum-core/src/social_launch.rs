//! Launcher-owned, read-only bridge to Minecraft's native LAN connection screen.
use crate::{servers::ServerAddress, Task};
use anyhow::{bail, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

const AGENT: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/aurum-lan-join.jar"));
const CLASSES: &[(&str, &str)] = &[
    ("minecraft", "net.minecraft.client.Minecraft"),
    ("screen", "net.minecraft.client.gui.screens.Screen"),
    ("title", "net.minecraft.client.gui.screens.TitleScreen"),
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

pub(crate) async fn prepare(
    engine: &crate::Engine,
    instance: &Path,
    client: &Path,
    meta: &Value,
    target: &ServerAddress,
    name: &str,
    task: &Task,
) -> Result<Option<String>> {
    let root = &engine.root;
    let ip: std::net::IpAddr = target.host.parse()?;
    if !ip.is_loopback() {
        bail!("Social target must be the local broker bridge");
    }
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
        engine
            .download(url, &path, Some(("sha1", sha1)), task)
            .await?;
        if tokio::fs::metadata(&path).await?.len() > 32_000_000 {
            bail!("Official mappings exceed limit");
        }
        mappings = tokio::fs::read_to_string(path).await?;
    }
    task.check()?;
    let directory = instance.join(".aurum/social");
    tokio::fs::create_dir_all(&directory).await?;
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
    let configuration = format!("{}.properties", uuid::Uuid::new_v4());
    let status = directory.join("agent-state");
    tokio::fs::write(&status, "waiting\n").await?;
    let mut properties = format!(
        "host={}\nport={}\nname={}\nstatus={}\n",
        target.host,
        target.port,
        property(name),
        property(&status.to_string_lossy())
    );
    for (role, aliases) in class_aliases(&mappings) {
        properties.push_str(&format!("class.{role}={aliases}\n"));
    }
    tokio::fs::write(directory.join(&configuration), properties).await?;
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
        "waiting" | "connecting" | "joined" | "game-screen" | "unsupported" | "timeout"
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
}
