use super::{confined, proxy, HostingIcon, HostingNetworkProfile, HostingProfile};
use crate::Engine;
use anyhow::{bail, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

#[derive(Default)]
struct ComponentLogCursor {
    position: u64,
    pending: Vec<u8>,
    discard_line: bool,
}
impl ComponentLogCursor {
    fn prepare(&mut self, size: u64) {
        if size < self.position {
            self.position = 0;
            self.pending.clear();
            self.discard_line = false;
        }
        if size.saturating_sub(self.position) > 65536 {
            self.position = size - 65536;
            self.pending.clear();
            self.discard_line = true;
        }
    }
    fn append(&mut self, bytes: &[u8], mut line: impl FnMut(&str)) {
        for byte in bytes {
            if *byte == b'\n' {
                if !self.discard_line && !self.pending.is_empty() {
                    line(String::from_utf8_lossy(&self.pending).trim_end_matches('\r'));
                }
                self.pending.clear();
                self.discard_line = false;
            } else if !self.discard_line {
                if self.pending.len() < 8192 {
                    self.pending.push(*byte);
                } else {
                    self.pending.clear();
                    self.discard_line = true;
                }
            }
        }
    }
}

pub(super) fn default_stop_command() -> String {
    "stop".into()
}

pub(super) fn default_script(root: &Path) -> Option<String> {
    let names: &[&str] = if cfg!(windows) {
        &[
            "start.bat",
            "start.cmd",
            "start.ps1",
            "run.bat",
            "run.cmd",
            "run.ps1",
        ]
    } else {
        &[]
    };
    names
        .iter()
        .find(|name| root.join(name).is_file() && confined(root, name).is_ok())
        .map(|name| (*name).into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn component_log_cursor_preserves_partial_lines_and_bounds_memory() {
        let mut cursor = ComponentLogCursor::default();
        let mut lines = Vec::new();
        cursor.append(b"Player_", |line| lines.push(line.to_owned()));
        assert!(lines.is_empty());
        cursor.append(b"1 joined\r\nnext", |line| lines.push(line.to_owned()));
        assert_eq!(lines, ["Player_1 joined"]);
        cursor.position = 100;
        cursor.prepare(10);
        cursor.append(b"rotated\n", |line| lines.push(line.to_owned()));
        assert_eq!(lines.last().unwrap(), "rotated");
        cursor.append(&vec![b'x'; 9000], |line| lines.push(line.to_owned()));
        assert!(cursor.pending.is_empty());
        cursor.append(b"\nvalid\n", |line| lines.push(line.to_owned()));
        assert_eq!(lines.last().unwrap(), "valid");
        cursor.prepare(100000);
        assert_eq!(cursor.position, 100000 - 65536);
        cursor.append(b"truncated\ncomplete\n", |line| lines.push(line.to_owned()));
        assert_eq!(lines.last().unwrap(), "complete");
        assert!(!lines.iter().any(|line| line == "truncated"));
    }

    async fn fixture() -> (tempfile::TempDir, Engine, Vec<HostingProfile>) {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data");
        std::fs::create_dir_all(&workspace).unwrap();
        let folder = tempfile::tempdir_in(workspace).unwrap();
        for (directory, core) in [("network/hub", "paper"), ("network/proxy", "velocity")] {
            let path = folder.path().join(directory);
            std::fs::create_dir_all(&path).unwrap();
            super::super::test_server_jar(&path.join(format!("{core}.jar")));
            std::fs::write(
                path.join(if core == "velocity" {
                    "velocity.toml"
                } else {
                    "server.properties"
                }),
                if core == "velocity" {
                    "bind = \"127.0.0.1:25577\"\n"
                } else {
                    "server-port=25566\n"
                },
            )
            .unwrap();
        }
        std::fs::write(folder.path().join("start.bat"), "@echo off\nexit /b 0\n").unwrap();
        let engine = Engine::new(folder.path().join("data"), |_| {})
            .await
            .unwrap();
        let scan = super::super::inspect(folder.path()).unwrap();
        let added = engine
            .hosting_import(
                folder.path().into(),
                scan.candidates
                    .iter()
                    .map(|candidate| candidate.id.clone())
                    .collect(),
            )
            .await
            .unwrap();
        (folder, engine, added)
    }

    #[tokio::test]
    async fn imports_one_network_preserves_components_and_never_runs_script() {
        let (folder, engine, added) = fixture().await;
        assert_eq!(added.len(), 1);
        let network = &added[0];
        assert_eq!(network.network.as_ref().unwrap().components.len(), 2);
        let profiles = engine.hosting_profiles().await.unwrap();
        assert_eq!(profiles.len(), 3);
        assert_eq!(engine.hosting_profiles().await.unwrap().len(), 3);
        assert_eq!(
            engine.hosting_settings(&network.id).await.unwrap().port,
            25577
        );
        assert!(engine.hosting_running().is_empty());
        let task = engine
            .task(uuid::Uuid::new_v4().to_string(), None)
            .await
            .unwrap();
        assert!(engine
            .hosting_start(&network.network.as_ref().unwrap().components[0], &task)
            .await
            .is_err());
        assert!(engine
            .hosting_remove(&network.network.as_ref().unwrap().components[0])
            .await
            .is_err());
        engine.hosting_remove(&network.id).await.unwrap();
        assert!(engine.hosting_profiles().await.unwrap().is_empty());
        assert!(folder.path().join("network/hub/paper.jar").exists());
    }

    #[tokio::test]
    async fn existing_profiles_migrate_once_with_backup_without_changing_server_files() {
        let (folder, engine, added) = fixture().await;
        let mut old = engine.hosting_profiles().await.unwrap();
        old.retain(|profile| profile.network.is_none());
        let original = serde_json::to_vec_pretty(&old).unwrap();
        std::fs::write(engine.root.join("hosting/profiles.json"), &original).unwrap();
        let migrated = engine.hosting_profiles().await.unwrap();
        assert_eq!(migrated.len(), 3);
        assert_eq!(engine.hosting_profiles().await.unwrap().len(), 3);
        assert_eq!(
            std::fs::read(engine.root.join("hosting/profiles.before-networks.json")).unwrap(),
            original
        );
        assert!(folder.path().join("start.bat").exists());
        assert_ne!(
            migrated
                .iter()
                .find(|profile| profile.network.is_some())
                .unwrap()
                .id,
            added[0].id
        );
    }

    #[tokio::test]
    async fn network_icon_changes_do_not_validate_or_rewrite_backend_settings() {
        let (folder, engine, added) = fixture().await;
        let profile = &added[0];
        let configuration = folder.path().join("network/proxy/velocity.toml");
        let before = std::fs::read(&configuration).unwrap();
        let mut update = super::super::HostingUpdate {
            name: profile.name.clone(),
            description: profile.description.clone(),
            java_major: profile.java_major,
            java_path: profile.java_path.clone(),
            ram_mb: profile.ram_mb,
            jvm_args: profile.jvm_args.clone(),
            icon: profile.icon.clone(),
            settings: super::super::HostingSettings {
                port: 0,
                bind: "unchanged external hostname".into(),
                online_mode: false,
                max_players: 999999,
                motd: "First line\nSecond line".into(),
            },
        };
        update.icon.symbol = "paper".into();
        update.icon.color = "#12ABCD".into();
        update.icon.background = "#304632".into();
        engine
            .hosting_update(&profile.id, update.clone())
            .await
            .unwrap();
        let saved = engine.hosting_profile(&profile.id).await.unwrap();
        assert_eq!(saved.icon.color, "#12ABCD");
        assert_eq!(saved.icon.symbol, "paper");
        assert_eq!(std::fs::read(&configuration).unwrap(), before);
        assert!(!configuration.with_extension("toml.aurum-backup").exists());
        update.icon.color = "invalid".into();
        assert!(engine.hosting_update(&profile.id, update).await.is_err());
        assert_eq!(
            engine
                .hosting_profile(&profile.id)
                .await
                .unwrap()
                .icon
                .color,
            "#12ABCD"
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn script_consent_is_content_bound_and_paths_are_confined() {
        let (folder, engine, added) = fixture().await;
        let id = &added[0].id;
        let task = engine
            .task(uuid::Uuid::new_v4().to_string(), None)
            .await
            .unwrap();
        assert!(engine.hosting_start(id, &task).await.is_err());
        let trust = engine.hosting_script_trust(id).await.unwrap();
        assert!(!trust.trusted);
        assert!(engine.hosting_trust_script(id, "wrong").await.is_err());
        engine.hosting_trust_script(id, &trust.hash).await.unwrap();
        assert!(engine.hosting_script_trust(id).await.unwrap().trusted);
        std::fs::write(folder.path().join("start.bat"), "@echo changed\n").unwrap();
        assert!(!engine.hosting_script_trust(id).await.unwrap().trusted);
        assert!(engine.hosting_start(id, &task).await.is_err());
        for path in [
            "../outside.bat",
            "network/hub/paper.jar",
            "C:/Windows/notepad.exe",
        ] {
            assert!(engine
                .hosting_network_script(id, Some(path.into()))
                .await
                .is_err());
        }
        assert_eq!(
            engine
                .hosting_profiles()
                .await
                .unwrap()
                .iter()
                .find(|profile| &profile.id == id)
                .unwrap()
                .network
                .as_ref()
                .unwrap()
                .startup_script
                .as_deref(),
            Some("start.bat")
        );
    }
}

pub(super) fn group_profiles(profiles: &mut Vec<HostingProfile>) -> Result<bool> {
    let grouped: Vec<_> = profiles
        .iter()
        .filter_map(|profile| profile.network.as_ref())
        .flat_map(|network| network.components.iter().cloned())
        .collect();
    let mut groups = BTreeMap::new();
    for profile in profiles
        .iter()
        .filter(|profile| profile.network.is_none() && !grouped.contains(&profile.id))
    {
        let parent = Path::new(&profile.directory)
            .parent()
            .unwrap_or(Path::new(""));
        groups
            .entry((profile.root.clone(), parent.to_path_buf()))
            .or_insert_with(Vec::new)
            .push(profile.clone());
    }
    let mut changed = false;
    let root_counts = groups
        .iter()
        .filter(|(_, members)| {
            members.len() > 1 && members.iter().any(|member| proxy(&member.core))
        })
        .fold(BTreeMap::new(), |mut counts, ((root, _), _)| {
            *counts.entry(root.clone()).or_insert(0) += 1;
            counts
        });
    for ((root, directory), members) in groups {
        if members.len() < 2 || !members.iter().any(|member| proxy(&member.core)) {
            continue;
        }
        let directory = if directory.as_os_str().is_empty() {
            ".".into()
        } else {
            directory.to_string_lossy().replace('\\', "/")
        };
        let folder = confined(&root, &directory)?;
        let local_script = default_script(&folder).map(|script| {
            if directory == "." {
                script
            } else {
                format!("{directory}/{script}")
            }
        });
        let script = local_script.or_else(|| {
            if root_counts.get(&root) == Some(&1) {
                default_script(&root)
            } else {
                None
            }
        });
        let display_root =
            if script.as_ref().is_some_and(|script| !script.contains('/')) || directory == "." {
                &root
            } else {
                &folder
            };
        let name = display_root
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        profiles.push(HostingProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            description: String::new(),
            root,
            directory: if script.is_some() {
                ".".into()
            } else {
                directory
            },
            entrypoint: String::new(),
            core: "network".into(),
            version: "—".into(),
            java_major: members
                .iter()
                .map(|member| member.java_major)
                .max()
                .unwrap_or(21),
            java_path: String::new(),
            ram_mb: members.iter().map(|member| member.ram_mb).sum(),
            jvm_args: String::new(),
            icon: HostingIcon {
                symbol: "network".into(),
                ..Default::default()
            },
            launches: 0,
            last_started: None,
            network: Some(HostingNetworkProfile {
                components: members.into_iter().map(|member| member.id).collect(),
                startup_script: script,
                trusted_hash: None,
                stop_command: default_stop_command(),
            }),
        });
        changed = true;
    }
    Ok(changed)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingScriptTrust {
    pub path: String,
    pub hash: String,
    pub trusted: bool,
}

pub(super) fn script_trust(profile: &HostingProfile) -> Result<HostingScriptTrust> {
    let network = profile.network.as_ref().context("Выберите сеть серверов")?;
    let script = network
        .startup_script
        .as_ref()
        .context("Файл запуска не выбран")?;
    if !cfg!(windows) {
        bail!("Запуск скриптов сети пока поддерживается только в Windows");
    }
    let path = confined(&profile.root, script)?;
    if !path.is_file()
        || !matches!(
            path.extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("bat" | "cmd" | "ps1")
        )
    {
        bail!("Выберите BAT, CMD или PowerShell внутри папки сети")
    }
    if std::fs::metadata(&path)?.len() > 1024 * 1024 {
        bail!("Стартовый скрипт слишком велик");
    }
    let hash = format!("{:x}", Sha256::digest(std::fs::read(&path)?));
    Ok(HostingScriptTrust {
        path: {
            let text = path.to_string_lossy();
            if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
                format!(r"\\{unc}")
            } else {
                text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
            }
        },
        trusted: network.trusted_hash.as_ref() == Some(&hash),
        hash,
    })
}

impl Engine {
    pub(super) async fn hosting_start_network(
        &self,
        profile: HostingProfile,
        task: &crate::Task,
    ) -> Result<()> {
        use super::process::{Control, HostingLive, Output, Runtime};
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        };
        let gate = self.hosting.gate.lock().await;
        if self.hosting_running().contains(&profile.id) {
            bail!("Сеть уже запускается или работает");
        }
        let members = self.hosting_members(&profile).await?;
        for member in &members {
            if self.hosting_running().contains(&member.id)
                || super::process::port_busy(member).await?
            {
                bail!(
                    "Компонент {} уже работает. Сначала остановите его",
                    member.name
                );
            }
        }
        let scripted = profile.network.as_ref().unwrap().startup_script.is_some();
        if scripted && !script_trust(&profile)?.trusted {
            bail!("Сначала подтвердите запуск выбранного скрипта");
        }
        let (sender, receiver) = tokio::sync::mpsc::channel(32);
        let runtime = Arc::new(Runtime {
            output: Mutex::new(Output {
                live: HostingLive {
                    status: "starting".into(),
                    started_at: Some(crate::now()),
                    ..Default::default()
                },
                lines: Default::default(),
                sequence: 0,
            }),
            sender,
        });
        self.hosting
            .runtime
            .lock()
            .unwrap()
            .insert(profile.id.clone(), runtime.clone());
        drop(gate);
        if scripted {
            #[cfg(windows)]
            if let Err(error) = super::script::spawn(&profile, runtime.clone(), receiver).await {
                runtime.line(&format!("{error:#}"), "error");
                runtime.output.lock().unwrap().live.status = "crashed".into();
                return Err(error);
            }
            #[cfg(not(windows))]
            {
                let _ = receiver;
                bail!("Запуск скриптов сети пока поддерживается только в Windows");
            }
            self.hosting_monitor_script(profile.clone(), members, runtime.clone());
        } else {
            let initializing = Arc::new(AtomicBool::new(true));
            self.hosting_monitor_network(
                members.clone(),
                runtime.clone(),
                receiver,
                initializing.clone(),
            );
            let mut ordered = members.clone();
            ordered.sort_by_key(|member| proxy(&member.core));
            let result: Result<()> = async {
                for member in ordered {
                    task.check()?;
                    self.hosting_start_leaf(&member.id, task).await?;
                    let deadline =
                        tokio::time::Instant::now() + std::time::Duration::from_secs(120);
                    loop {
                        task.check()?;
                        let live = self.hosting_console(&member.id, 0).await?.live;
                        if live.status == "running" {
                            break;
                        }
                        if matches!(live.status.as_str(), "stopped" | "crashed" | "stopping")
                            || tokio::time::Instant::now() >= deadline
                        {
                            bail!("Компонент {} не запустился; проверьте консоль", member.name);
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    }
                }
                Ok(())
            }
            .await;
            if let Err(error) = result {
                runtime.line(&format!("{error:#}"), "error");
                let _ = runtime.sender.send(Control::Stop).await;
                initializing.store(false, Ordering::Relaxed);
                return Err(error);
            }
            initializing.store(false, Ordering::Relaxed);
        }
        let _guard = self.hosting.gate.lock().await;
        let mut profiles = self.hosting_profiles_unlocked().await?;
        if let Some(saved) = profiles.iter_mut().find(|saved| saved.id == profile.id) {
            saved.launches += 1;
            saved.last_started = Some(crate::now());
        }
        if let Err(error) = self.hosting_save(&profiles).await {
            runtime.line(&format!("Статистика не сохранена: {error}"), "warn");
        }
        Ok(())
    }
    fn hosting_monitor_network(
        &self,
        members: Vec<HostingProfile>,
        runtime: std::sync::Arc<super::process::Runtime>,
        mut receiver: tokio::sync::mpsc::Receiver<super::process::Control>,
        initializing: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) {
        use super::process::Control;
        let engine = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
            let mut stopping = false;
            let mut sequences = std::collections::HashMap::new();
            loop {
                tokio::select! {
                    control = receiver.recv() => {
                        match control {
                            Some(Control::Stop) | None => {
                                stopping = true;
                                for member in members.iter().rev() { if engine.hosting_running().contains(&member.id) { let _ = engine.hosting_control(&member.id, "stop", "").await; } }
                            },
                            Some(Control::Kill) => { stopping = true; for member in &members { if engine.hosting_running().contains(&member.id) { let _ = engine.hosting_control(&member.id, "kill", "").await; } } },
                            Some(Control::Command(command)) => { if let Some(gateway) = members.iter().find(|member| proxy(&member.core)) { let _ = engine.hosting_control(&gateway.id, "command", &command).await; } },
                        }
                    },
                    _ = interval.tick() => {
                        let mut live = Vec::new();
                        for member in &members {
                            let after = sequences.get(&member.id).copied().unwrap_or(0);
                            if let Ok(console) = engine.hosting_console(&member.id, after).await {
                                sequences.insert(member.id.clone(), console.latest);
                                for line in console.lines { runtime.line(&format!("[{}] {}", member.name, line.message), &line.level); }
                                live.push((member, console.live));
                            }
                        }
                        let active = live.iter().any(|(_, live)| matches!(live.status.as_str(), "running" | "starting" | "stopping"));
                        let initializing = initializing.load(std::sync::atomic::Ordering::Relaxed);
                        let mut output = runtime.output.lock().unwrap();
                        output.live.status = if stopping && active { "stopping" } else if !active && !initializing { if live.iter().any(|(_, live)| live.status == "crashed") { "crashed" } else { "stopped" } } else if live.len() == members.len() && live.iter().all(|(_, live)| live.status == "running") { "running" } else { "starting" }.into();
                        output.live.cpu = Some(live.iter().filter_map(|(_, live)| live.cpu).sum());
                        output.live.memory_bytes = Some(live.iter().filter_map(|(_, live)| live.memory_bytes).sum());
                        if let Some((_, gateway)) = live.iter().find(|(member, _)| proxy(&member.core)) { output.live.players = gateway.players.clone(); output.live.player_count = gateway.player_count; output.live.max_players = gateway.max_players; }
                        if !active && !initializing { break; }
                    }
                }
            }
        });
    }
    fn hosting_monitor_script(
        &self,
        profile: HostingProfile,
        members: Vec<HostingProfile>,
        runtime: std::sync::Arc<super::process::Runtime>,
    ) {
        let engine = self.clone();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncSeekExt};
            let mut positions = std::collections::HashMap::new();
            for member in &members {
                if let Ok(path) = super::discovery::config_path(member, "logs/latest.log") {
                    let size = tokio::fs::metadata(&path)
                        .await
                        .map(|metadata| metadata.len())
                        .unwrap_or(0);
                    positions.insert(
                        member.id.clone(),
                        ComponentLogCursor {
                            position: size,
                            ..Default::default()
                        },
                    );
                }
            }
            while runtime.active() {
                let mut ready = true;
                for member in &members {
                    ready &= super::process::port_busy(member).await.unwrap_or(false);
                    if let Ok(path) = super::discovery::config_path(member, "logs/latest.log") {
                        if let Ok(mut file) = tokio::fs::File::open(path).await {
                            let size = file
                                .metadata()
                                .await
                                .map(|metadata| metadata.len())
                                .unwrap_or(0);
                            let cursor = positions.entry(member.id.clone()).or_default();
                            cursor.prepare(size);
                            if file
                                .seek(std::io::SeekFrom::Start(cursor.position))
                                .await
                                .is_ok()
                            {
                                let mut bytes = vec![
                                    0;
                                    (size.saturating_sub(cursor.position).min(65536))
                                        as usize
                                ];
                                if let Ok(length) = file.read(&mut bytes).await {
                                    cursor.position += length as u64;
                                    cursor.append(&bytes[..length], |line| {
                                        runtime.component_line(
                                            &member.name,
                                            line,
                                            proxy(&member.core),
                                        )
                                    });
                                }
                            }
                        }
                    }
                }
                if let Ok(gateway) = engine.hosting_gateway(&profile).await {
                    if let Ok(console) = engine.hosting_console(&gateway.id, 0).await {
                        let mut output = runtime.output.lock().unwrap();
                        if matches!(output.live.status.as_str(), "starting" | "running") {
                            output.live.status = if ready { "running" } else { "starting" }.into();
                        }
                        output.live.player_count = console.live.player_count;
                        output.live.max_players = console.live.max_players;
                        if console.live.player_count == Some(0) {
                            output.live.players.clear();
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        });
    }
    pub(super) async fn hosting_members(
        &self,
        profile: &HostingProfile,
    ) -> Result<Vec<HostingProfile>> {
        let network = profile.network.as_ref().context("Выберите сеть серверов")?;
        let profiles = self.hosting_profiles_unlocked().await?;
        network
            .components
            .iter()
            .map(|id| {
                profiles
                    .iter()
                    .find(|member| &member.id == id && member.network.is_none())
                    .cloned()
                    .context("Компонент сети не найден")
            })
            .collect()
    }
    pub(super) async fn hosting_gateway(&self, profile: &HostingProfile) -> Result<HostingProfile> {
        if profile.network.is_none() {
            return Ok(profile.clone());
        }
        self.hosting_members(profile)
            .await?
            .into_iter()
            .find(|member| proxy(&member.core))
            .context("Прокси сети не найден")
    }
    pub async fn hosting_script_trust(&self, id: &str) -> Result<HostingScriptTrust> {
        script_trust(&self.hosting_profile(id).await?)
    }
    pub async fn hosting_trust_script(&self, id: &str, hash: &str) -> Result<()> {
        let _guard = self.hosting.gate.lock().await;
        let mut profiles = self.hosting_profiles_unlocked().await?;
        let profile = profiles
            .iter_mut()
            .find(|profile| profile.id == id)
            .context("Сеть не найдена")?;
        if script_trust(profile)?.hash != hash {
            bail!("Скрипт изменился. Подтвердите новый файл");
        }
        profile.network.as_mut().unwrap().trusted_hash = Some(hash.into());
        self.hosting_save(&profiles).await
    }
    pub async fn hosting_network_script(&self, id: &str, script: Option<String>) -> Result<()> {
        let _guard = self.hosting.gate.lock().await;
        if self.hosting_running().contains(&id.to_owned()) {
            bail!("Сначала остановите сеть");
        }
        let mut profiles = self.hosting_profiles_unlocked().await?;
        let profile = profiles
            .iter_mut()
            .find(|profile| profile.id == id)
            .context("Сеть не найдена")?;
        let network = profile.network.as_mut().context("Выберите сеть серверов")?;
        network.startup_script = script;
        network.trusted_hash = None;
        if network.startup_script.is_some() {
            script_trust(profile)?;
        }
        self.hosting_save(&profiles).await
    }
    pub async fn hosting_network_stop_command(&self, id: &str, command: String) -> Result<()> {
        if command.len() > 1024 || command.chars().any(char::is_control) {
            bail!("Укажите одну команду остановки без переводов строки");
        }
        let _guard = self.hosting.gate.lock().await;
        if self.hosting_running().contains(&id.to_owned()) {
            bail!("Сначала остановите сеть");
        }
        let mut profiles = self.hosting_profiles_unlocked().await?;
        let profile = profiles
            .iter_mut()
            .find(|profile| profile.id == id)
            .context("Сеть не найдена")?;
        profile
            .network
            .as_mut()
            .context("Выберите сеть серверов")?
            .stop_command = command.trim().into();
        self.hosting_save(&profiles).await
    }
}
