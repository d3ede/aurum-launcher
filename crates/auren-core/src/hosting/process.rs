use super::{confined, discovery, proxy, HostingProfile};
use crate::{model::Event, now, Engine, Task};
use anyhow::{bail, Context, Result};
use regex::Regex;
use serde::Serialize;
use std::{
    collections::VecDeque,
    process::Stdio,
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    sync::mpsc,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleLine {
    pub sequence: u64,
    pub time: u64,
    pub level: String,
    pub message: String,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingLive {
    pub status: String,
    pub pid: Option<u32>,
    pub started_at: Option<u64>,
    pub cpu: Option<f32>,
    pub memory_bytes: Option<u64>,
    pub players: Vec<String>,
    pub player_count: Option<u32>,
    pub max_players: Option<u32>,
    pub exit_code: Option<i32>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingConsole {
    pub lines: Vec<ConsoleLine>,
    pub latest: u64,
    pub truncated: bool,
    pub live: HostingLive,
}
pub(super) struct Output {
    pub(super) live: HostingLive,
    pub(super) lines: VecDeque<ConsoleLine>,
    pub(super) sequence: u64,
}
pub(crate) struct Runtime {
    pub(super) output: Mutex<Output>,
    pub(super) sender: mpsc::Sender<Control>,
}
pub(super) enum Control {
    Command(String),
    Stop,
    Kill,
}
fn track_player_event(output: &mut Output, line: &str) {
    static EVENT: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^\[\d{2}:\d{2}:\d{2}(?: INFO)?\](?: \[[^\]\r\n]+\]){0,2}: (?:\[connected player\] )?([A-Za-z0-9_.-]{1,32})(?:\s*\([^\r\n]*?\))?:? (joined the game|has connected|left the game|has disconnected)(?:$|[.: ])").unwrap()
    });
    if let Some(capture) = EVENT.captures(line) {
        let name = capture[1].to_owned();
        if capture[2].contains("joined") || capture[2].contains("has connected") {
            if !output.live.players.contains(&name) && output.live.players.len() < 10000 {
                output.live.players.push(name);
            }
        } else {
            output.live.players.retain(|player| player != &name);
        }
        output.live.player_count = Some(output.live.players.len() as u32);
    }
}
impl Runtime {
    pub(crate) fn active(&self) -> bool {
        matches!(
            self.output.lock().unwrap().live.status.as_str(),
            "starting" | "running" | "stopping"
        )
    }
    pub(super) fn line(&self, line: &str, level: &str) {
        self.record_line(line, level, true, None);
    }
    pub(super) fn component_line(&self, component: &str, line: &str, gateway: bool) {
        self.record_line(line, "info", gateway, Some(component));
    }
    fn record_line(&self, line: &str, level: &str, track_players: bool, component: Option<&str>) {
        static ANSI: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").unwrap());
        static SECRET: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(
                r"(?i)((?:password|secret|token|authorization|session)[\w.-]*\s*[=:]\s*)[^\s,;]+",
            )
            .unwrap()
        });
        let clean = ANSI.replace_all(line, "");
        let clean: String = clean
            .chars()
            .filter(|character| !character.is_control() || *character == '\t')
            .take(4096)
            .collect();
        if clean.is_empty() {
            return;
        }
        let message = SECRET.replace_all(&clean, "${1}[hidden]").into_owned();
        let message = match component {
            Some(component) => format!("[{component}] {message}"),
            None => message,
        };
        let mut output = self.output.lock().unwrap();
        if matches!(output.live.status.as_str(), "starting" | "running")
            && (clean.contains("Done (")
                || clean.contains("Listening on ")
                || clean.contains("Listening for connections on"))
        {
            output.live.status = "running".into();
        }
        if track_players {
            track_player_event(&mut output, &clean);
        }
        output.sequence += 1;
        let sequence = output.sequence;
        let level = if clean.contains("ERROR") || clean.contains("SEVERE") {
            "error"
        } else if clean.contains("WARN") {
            "warn"
        } else {
            level
        };
        output.lines.push_back(ConsoleLine {
            sequence,
            time: now(),
            level: level.into(),
            message,
        });
        while output.lines.len() > 2000 {
            output.lines.pop_front();
        }
    }
}

pub(crate) async fn port_busy(profile: &HostingProfile) -> Result<bool> {
    let settings = discovery::settings(profile)?;
    let host = match settings.bind.as_str() {
        "" | "0.0.0.0" => "127.0.0.1",
        "::" => "::1",
        host => host,
    };
    Ok(tokio::time::timeout(
        Duration::from_millis(300),
        tokio::net::TcpStream::connect((host, settings.port)),
    )
    .await
    .is_ok_and(|result| result.is_ok()))
}

pub(super) async fn read_output(
    mut source: impl AsyncRead + Unpin,
    runtime: Arc<Runtime>,
    level: &'static str,
) {
    let mut chunk = [0; 4096];
    let mut pending = Vec::new();
    loop {
        let length = match source.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(length) => length,
        };
        for byte in &chunk[..length] {
            if *byte == b'\n' || pending.len() >= 8192 {
                runtime.line(&String::from_utf8_lossy(&pending), level);
                pending.clear();
            }
            if *byte != b'\n' && *byte != b'\r' {
                pending.push(*byte);
            }
        }
    }
    if !pending.is_empty() {
        runtime.line(&String::from_utf8_lossy(&pending), level);
    }
}

impl Engine {
    pub async fn hosting_start(&self, id: &str, task: &Task) -> Result<()> {
        let profiles = self.hosting_profiles_unlocked().await?;
        if profiles.iter().any(|profile| {
            profile
                .network
                .as_ref()
                .is_some_and(|network| network.components.contains(&id.to_owned()))
        }) {
            bail!("Запускайте сеть целиком через её общую карточку")
        }
        let profile = self.hosting_profile(id).await?;
        if profile.network.is_some() {
            return self.hosting_start_network(profile, task).await;
        }
        self.hosting_start_leaf(id, task).await
    }
    pub(super) async fn hosting_start_leaf(&self, id: &str, task: &Task) -> Result<()> {
        let gate = self.hosting.gate.lock().await;
        if self.hosting_running().contains(&id.to_owned()) {
            bail!("Сервер уже запускается или работает")
        }
        let profile = self.hosting_profile(id).await?;
        if port_busy(&profile).await? {
            bail!("Порт занят внешним процессом. Остановите его перед запуском через Aurum")
        }
        let settings = discovery::settings(&profile)?;
        let (sender, receiver) = mpsc::channel(32);
        let runtime = Arc::new(Runtime {
            output: Mutex::new(Output {
                live: HostingLive {
                    status: "starting".into(),
                    max_players: Some(settings.max_players),
                    ..Default::default()
                },
                lines: VecDeque::new(),
                sequence: 0,
            }),
            sender,
        });
        self.hosting
            .runtime
            .lock()
            .unwrap()
            .insert(id.into(), runtime.clone());
        drop(gate);
        let result = self
            .hosting_spawn(profile, runtime.clone(), receiver, task)
            .await;
        if let Err(error) = &result {
            runtime.line(&format!("{error:#}"), "error");
            runtime.output.lock().unwrap().live.status = "crashed".into();
        }
        result
    }
    async fn hosting_spawn(
        &self,
        profile: HostingProfile,
        runtime: Arc<Runtime>,
        mut receiver: mpsc::Receiver<Control>,
        task: &Task,
    ) -> Result<()> {
        let folder = confined(&profile.root, &profile.directory)?;
        let jar = confined(&profile.root, &profile.entrypoint)?;
        let settings = discovery::settings(&profile)?;
        if !proxy(&profile.core)
            && !discovery::read_small(&discovery::config_path(&profile, "eula.txt")?)?
                .lines()
                .any(|line| line.trim() == "eula=true")
        {
            bail!("Сначала примите Minecraft EULA в настройках сервера")
        }
        let java = self
            .java_with_path(profile.java_major, &profile.java_path, task)
            .await?;
        task.check()?;
        let mut command = tokio::process::Command::new(java);
        command
            .current_dir(&folder)
            .arg(format!("-Xms{}M", profile.ram_mb.min(512)))
            .arg(format!("-Xmx{}M", profile.ram_mb));
        let arguments = shlex::split(&profile.jvm_args).context("Некорректные JVM-аргументы")?;
        command.args(arguments).arg("-jar").arg(jar);
        if !proxy(&profile.core) {
            command.arg("nogui");
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false);
        crate::minecraft::hide(&mut command);
        let mut child = command.spawn().context("Не удалось запустить сервер")?;
        let pid = child.id().context("Нет PID сервера")?;
        let mut input = child.stdin.take().context("Нет консоли сервера")?;
        let stdout = child.stdout.take().context("Нет stdout сервера")?;
        let stderr = child.stderr.take().context("Нет stderr сервера")?;
        {
            let mut output = runtime.output.lock().unwrap();
            output.live.pid = Some(pid);
            output.live.started_at = Some(now());
        }
        runtime.line("Запуск Java. Ожидаем готовность сервера…", "system");
        let mut output_task = tokio::spawn(read_output(stdout, runtime.clone(), "info"));
        let mut error_task = tokio::spawn(read_output(stderr, runtime.clone(), "error"));
        let engine = self.clone();
        let identifier = profile.id.clone();
        let status_runtime = runtime.clone();
        let host = match settings.bind.as_str() {
            "" | "0.0.0.0" => "127.0.0.1",
            "::" => "::1",
            host => host,
        }
        .to_owned();
        let status_task = tokio::spawn(async move {
            let address = crate::servers::ServerAddress {
                address: format!("{host}:{}", settings.port),
                host,
                port: settings.port,
            };
            while status_runtime.active() {
                if let Ok(Ok(status)) =
                    tokio::time::timeout(Duration::from_millis(700), crate::servers::ping(&address))
                        .await
                {
                    let mut output = status_runtime.output.lock().unwrap();
                    if output.live.status != "stopping" && status.online {
                        output.live.status = "running".into();
                    }
                    output.live.player_count = status.players;
                    output.live.max_players = status.max_players;
                    if status.players == Some(0) {
                        output.live.players.clear();
                    }
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });
        let stop_command = if profile.core == "velocity" {
            "shutdown"
        } else if proxy(&profile.core) {
            "end"
        } else {
            "stop"
        };
        tokio::spawn(async move {
            let mut system = sysinfo::System::new();
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            let started = Instant::now();
            let status = loop {
                tokio::select! {
                    status = child.wait() => break status,
                    control = receiver.recv() => {
                        let line = match control {
                            Some(Control::Command(line)) => line,
                            Some(Control::Stop) => { runtime.output.lock().unwrap().live.status = "stopping".into(); stop_command.into() },
                            Some(Control::Kill) => { let _ = child.start_kill(); continue },
                            None => { let _ = child.start_kill(); continue },
                        };
                        if let Err(error) = input.write_all(format!("{line}\n").as_bytes()).await { runtime.line(&error.to_string(), "error"); }
                        let _ = input.flush().await;
                        runtime.line(&format!("> {line}"), "command");
                    },
                    _ = interval.tick() => {
                        let process_id = sysinfo::Pid::from_u32(pid);
                        system.refresh_processes_specifics(sysinfo::ProcessesToUpdate::Some(&[process_id]), true, sysinfo::ProcessRefreshKind::nothing().with_cpu().with_memory());
                        if let Some(process) = system.process(process_id) {
                            let mut output = runtime.output.lock().unwrap();
                            output.live.memory_bytes = Some(process.memory());
                            if started.elapsed() > Duration::from_secs(1) { output.live.cpu = Some(process.cpu_usage() / std::thread::available_parallelism().map_or(1, usize::from) as f32); }
                        }
                    }
                }
            };
            status_task.abort();
            let _ = tokio::time::timeout(Duration::from_secs(2), async {
                let _ = (&mut output_task).await;
                let _ = (&mut error_task).await;
            })
            .await;
            output_task.abort();
            error_task.abort();
            let success = status.as_ref().is_ok_and(|status| status.success());
            let exit_code = status.as_ref().ok().and_then(|status| status.code());
            runtime.line(
                &format!(
                    "Процесс завершён: {}",
                    status
                        .map(|status| status.to_string())
                        .unwrap_or_else(|error| error.to_string())
                ),
                if success { "system" } else { "error" },
            );
            {
                let mut output = runtime.output.lock().unwrap();
                output.live.status = if success { "stopped" } else { "crashed" }.into();
                output.live.pid = None;
                output.live.exit_code = exit_code;
                output.live.cpu = None;
                output.live.memory_bytes = None;
                output.live.players.clear();
                output.live.player_count = Some(0);
            }
            (engine.emit)(Event {
                id: identifier,
                profile_id: None,
                phase: "hosting-changed".into(),
                message: String::new(),
                done: 0,
                total: 0,
            });
        });
        let _guard = self.hosting.gate.lock().await;
        let saved: Result<()> = async {
            let mut profiles = self.hosting_profiles_unlocked().await?;
            if let Some(saved) = profiles.iter_mut().find(|saved| saved.id == profile.id) {
                saved.launches += 1;
                saved.last_started = Some(now());
            }
            self.hosting_save(&profiles).await
        }
        .await;
        if let Err(error) = saved {
            self.hosting
                .runtime
                .lock()
                .unwrap()
                .get(&profile.id)
                .unwrap()
                .line(&format!("Статистика не сохранена: {error}"), "warn");
        }
        Ok(())
    }
    pub async fn hosting_control(&self, id: &str, action: &str, command: &str) -> Result<()> {
        let profile = self.hosting_profile(id).await?;
        if profile
            .network
            .as_ref()
            .is_some_and(|network| network.startup_script.is_some())
            && action == "command"
        {
            bail!("Скрипт сам управляет консолями. Для завершения всей сети используйте подтверждённое принудительное завершение")
        }
        let runtime = self
            .hosting
            .runtime
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .context("Запустите сервер через Aurum для управления")?;
        if !runtime.active() {
            bail!("Сервер остановлен")
        }
        let control = match action {
            "stop" => Control::Stop,
            "kill" => Control::Kill,
            "command" => {
                if command.trim().is_empty()
                    || command.len() > 1024
                    || command.chars().any(char::is_control)
                {
                    bail!("Введите одну команду без переводов строки")
                }
                Control::Command(command.trim().trim_start_matches('/').into())
            }
            _ => bail!("Неизвестное действие"),
        };
        runtime
            .sender
            .try_send(control)
            .context("Консоль занята, попробуйте ещё раз")
    }
    pub async fn hosting_restart(&self, id: &str, task: &Task) -> Result<()> {
        self.hosting_control(id, "stop", "").await?;
        for _ in 0..240 {
            task.check()?;
            if !self.hosting_running().contains(&id.to_owned()) {
                return self.hosting_start(id, task).await;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        bail!("Сервер не завершился за минуту. Проверьте консоль; принудительное завершение доступно отдельно")
    }
    pub async fn hosting_console(&self, id: &str, after: u64) -> Result<HostingConsole> {
        let runtime = self.hosting.runtime.lock().unwrap().get(id).cloned();
        if let Some(runtime) = runtime {
            let output = runtime.output.lock().unwrap();
            return Ok(HostingConsole {
                lines: output
                    .lines
                    .iter()
                    .filter(|line| line.sequence > after)
                    .cloned()
                    .collect(),
                latest: output.sequence,
                truncated: after > 0
                    && output
                        .lines
                        .front()
                        .is_some_and(|line| line.sequence > after + 1),
                live: output.live.clone(),
            });
        }
        let saved = self.hosting_profile(id).await?;
        let profile = self.hosting_gateway(&saved).await?;
        let settings = discovery::settings(&profile)?;
        let external = port_busy(&profile).await?;
        let host = match settings.bind.as_str() {
            "" | "0.0.0.0" => "127.0.0.1",
            "::" => "::1",
            host => host,
        };
        let address = crate::servers::ServerAddress::parse(&format!(
            "{}:{}",
            if host.contains(':') {
                format!("[{host}]")
            } else {
                host.into()
            },
            settings.port
        ))?;
        let status = if external {
            tokio::time::timeout(Duration::from_millis(700), crate::servers::ping(&address))
                .await
                .ok()
                .and_then(Result::ok)
        } else {
            None
        };
        Ok(HostingConsole {
            lines: Vec::new(),
            latest: 0,
            truncated: false,
            live: HostingLive {
                status: if external { "external" } else { "stopped" }.into(),
                player_count: status.and_then(|status| status.players),
                max_players: Some(settings.max_players),
                ..Default::default()
            },
        })
    }
    pub async fn hosting_player_action(
        &self,
        id: &str,
        player: &str,
        action: &str,
        target: &str,
    ) -> Result<()> {
        if player.is_empty()
            || player.len() > 32
            || !player
                .bytes()
                .all(|character| character.is_ascii_alphanumeric() || b"_.-".contains(&character))
        {
            bail!("Неверное имя игрока")
        }
        let saved = self.hosting_profile(id).await?;
        if saved
            .network
            .as_ref()
            .is_some_and(|network| network.startup_script.is_some())
        {
            bail!("Команды компонентов недоступны при запуске через скрипт");
        }
        let profile = self.hosting_gateway(&saved).await?;
        let command = if profile.core == "velocity" {
            if action != "send"
                || target.is_empty()
                || target.len() > 64
                || !target.bytes().all(|character| {
                    character.is_ascii_alphanumeric() || b"_.-".contains(&character)
                })
            {
                bail!("Для Velocity доступен перевод на бэкенд; остальные команды зависят от плагинов")
            }
            format!("send {player} {target}")
        } else {
            match action {
                "kick" | "ban" | "pardon" | "op" | "deop" => format!("{action} {player}"),
                "whitelist" => format!("whitelist add {player}"),
                "survival" | "creative" | "spectator" => format!("gamemode {action} {player}"),
                _ => bail!("Неизвестное действие игрока"),
            }
        };
        self.hosting_control(&profile.id, "command", &command).await
    }
    pub async fn hosting_accept_eula(&self, id: &str) -> Result<()> {
        let _guard = self.hosting.gate.lock().await;
        if self.hosting_running().contains(&id.to_owned()) {
            bail!("Сначала остановите сервер")
        }
        let profile = self.hosting_profile(id).await?;
        if profile.network.is_some() {
            bail!("EULA принимается отдельно для игровых компонентов, а не для сети");
        }
        let path = discovery::config_path(&profile, "eula.txt")?;
        tokio::fs::write(
            path,
            b"# Minecraft EULA accepted explicitly in Aurum\neula=true\n",
        )
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn velocity_logger_events_survive_component_labels_and_backend_switches() {
        let (sender, _) = mpsc::channel(1);
        let runtime = Runtime {
            output: Mutex::new(Output {
                live: HostingLive::default(),
                lines: VecDeque::new(),
                sequence: 0,
            }),
            sender,
        };
        let joined = "[20:54:35] [Netty NIO Worker #21/INFO] [com.velocitypowered.proxy.connection.client.AuthSessionHandler]: [connected player] Player_1 (/127.0.0.1:12345) has connected";
        runtime.component_line("proxy", joined, true);
        runtime.component_line("proxy", joined, true);
        assert_eq!(runtime.output.lock().unwrap().live.players, ["Player_1"]);
        assert!(runtime
            .output
            .lock()
            .unwrap()
            .lines
            .back()
            .unwrap()
            .message
            .starts_with("[proxy] [20:54:35]"));
        runtime.component_line(
            "lobby",
            "[20:54:57] [Server thread/INFO]: Player_1 left the game",
            false,
        );
        runtime.component_line("proxy", "[20:54:57] [Netty NIO Worker #21/INFO] [com.velocitypowered.proxy.connection.MinecraftConnection]: [server connection] Player_1 -> lobby has disconnected", true);
        assert_eq!(runtime.output.lock().unwrap().live.players, ["Player_1"]);
        runtime.component_line("proxy", "[20:55:01] [Netty NIO Worker #21/INFO] [com.velocitypowered.proxy.connection.MinecraftConnection]: [connected player] Player_1 (/127.0.0.1:12345) has disconnected", true);
        assert!(runtime.output.lock().unwrap().live.players.is_empty());
        runtime.line(
            "[20:55:02 INFO]: [connected player] Player_2 (/127.0.0.1:12346): has connected",
            "info",
        );
        assert_eq!(runtime.output.lock().unwrap().live.players, ["Player_2"]);
        runtime.line(
            "[20:55:03] [Server thread/INFO]: <Player_2> Player_3 joined the game",
            "info",
        );
        assert_eq!(runtime.output.lock().unwrap().live.players, ["Player_2"]);
    }
    #[test]
    fn bounded_console_redacts_secrets_and_tracks_real_joins() {
        let (sender, _) = mpsc::channel(1);
        let runtime = Runtime {
            output: Mutex::new(Output {
                live: HostingLive::default(),
                lines: VecDeque::new(),
                sequence: 0,
            }),
            sender,
        };
        runtime.line(
            "[12:00:00] [Server thread/INFO]: Player_1 joined the game",
            "info",
        );
        assert_eq!(runtime.output.lock().unwrap().live.players, ["Player_1"]);
        runtime.line("password=very-secret token: abc", "info");
        assert!(!runtime
            .output
            .lock()
            .unwrap()
            .lines
            .back()
            .unwrap()
            .message
            .contains("very-secret"));
        for _ in 0..2100 {
            runtime.line("test", "info");
        }
        assert_eq!(runtime.output.lock().unwrap().lines.len(), 2000);
        runtime.line(
            "[12:01:00] [Server thread/INFO]: Player_1 left the game",
            "info",
        );
        assert!(runtime.output.lock().unwrap().live.players.is_empty());
    }
}
