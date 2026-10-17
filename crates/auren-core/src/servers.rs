use crate::{
    model::{RecentServer, ServerStatus},
    Engine,
};
use anyhow::{bail, Context, Result};
use base64::Engine as _;
use chrono::{Local, NaiveDate, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Read,
    net::IpAddr,
    path::{Path, PathBuf},
    sync::LazyLock,
    time::{Duration, SystemTime},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::{Mutex, Semaphore},
};

pub const WEEK: u64 = 7 * 24 * 60 * 60;
const MAX_FILE: u64 = 16 * 1024 * 1024;

pub(crate) struct ServerState {
    history: Mutex<()>,
    scanned: Mutex<HashMap<PathBuf, (u64, SystemTime)>>,
    statuses: Mutex<HashMap<String, ServerStatus>>,
    connections: Semaphore,
}
impl Default for ServerState {
    fn default() -> Self {
        Self {
            history: Mutex::new(()),
            scanned: Mutex::new(HashMap::new()),
            statuses: Mutex::new(HashMap::new()),
            connections: Semaphore::new(5),
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct History {
    servers: Vec<RecentServer>,
    removed: HashMap<String, u64>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ServerAddress {
    pub host: String,
    pub port: u16,
    pub address: String,
}
impl ServerAddress {
    pub fn parse(address: &str) -> Result<Self> {
        let address = address.trim();
        if address.is_empty()
            || address.len() > 260
            || address
                .chars()
                .any(|character| character.is_control() || character.is_whitespace())
        {
            bail!("Некорректный адрес сервера")
        }
        let (host, port) = if let Some(ipv6) = address.strip_prefix('[') {
            let (host, remainder) = ipv6.split_once(']').context("Некорректный IPv6-адрес")?;
            host.parse::<std::net::Ipv6Addr>()
                .context("Некорректный IPv6-адрес")?;
            let port = if remainder.is_empty() {
                25565
            } else {
                remainder
                    .strip_prefix(':')
                    .context("Некорректный порт")?
                    .parse::<u16>()?
            };
            (host.to_string(), port)
        } else if address.parse::<IpAddr>().is_ok() {
            (address.to_string(), 25565)
        } else if let Some((host, port)) = address.rsplit_once(':') {
            (host.to_string(), port.parse::<u16>()?)
        } else {
            (address.to_string(), 25565)
        };
        let host = host
            .parse::<IpAddr>()
            .map(|address| address.to_string())
            .unwrap_or_else(|_| host.trim_end_matches('.').to_ascii_lowercase());
        if port == 0
            || host.is_empty()
            || host.len() > 253
            || (host.parse::<IpAddr>().is_err()
                && !host.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && label.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'
                        })
                }))
        {
            bail!("Некорректный адрес сервера")
        }
        let formatted = if host.contains(':') {
            format!("[{host}]")
        } else {
            host.clone()
        };
        let address = if port == 25565 {
            formatted
        } else {
            format!("{formatted}:{port}")
        };
        Ok(Self {
            host,
            port,
            address,
        })
    }
}

fn identity(profile: &str, address: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{profile}\n{address}")))
}

fn clean_name(name: &str) -> String {
    name.chars()
        .filter(|character| !character.is_control())
        .take(100)
        .collect::<String>()
        .trim()
        .to_string()
}

fn icon(value: &str) -> Option<String> {
    let encoded = value
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(value);
    if encoded.len() > 32 * 1024 {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    let dimensions =
        image::ImageReader::with_format(std::io::Cursor::new(&bytes), image::ImageFormat::Png)
            .into_dimensions()
            .ok()?;
    if dimensions != (64, 64) {
        return None;
    }
    image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

async fn read_history(root: &Path) -> Result<History> {
    let path = root.join("recent-servers.json");
    match tokio::fs::metadata(&path).await {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(History::default()),
        Ok(metadata) if metadata.len() > 4 * 1024 * 1024 => {
            bail!("История серверов слишком велика")
        }
        Err(error) => return Err(error.into()),
        _ => {}
    }
    serde_json::from_slice(&tokio::fs::read(path).await?)
        .context("Не удалось прочитать историю серверов; файл сохранён")
}

async fn save_history(root: &Path, history: &History) -> Result<()> {
    let temporary = root.join("recent-servers.json.tmp");
    let mut file = tokio::fs::File::create(&temporary).await?;
    file.write_all(&serde_json::to_vec(history)?).await?;
    file.sync_all().await?;
    drop(file);
    tokio::fs::rename(temporary, root.join("recent-servers.json")).await?;
    Ok(())
}

fn remember(history: &mut History, server: RecentServer) -> bool {
    if server.last_played < crate::now().saturating_sub(WEEK)
        || server.last_played > crate::now() + 300
        || history
            .removed
            .get(&server.id)
            .is_some_and(|removed| *removed >= server.last_played)
    {
        return false;
    }
    if let Some(existing) = history
        .servers
        .iter_mut()
        .find(|existing| existing.id == server.id)
    {
        if existing.last_played >= server.last_played {
            return false;
        }
        let name = if server.name == server.address {
            existing.name.clone()
        } else {
            server.name
        };
        *existing = RecentServer {
            name,
            icon: server.icon.or_else(|| existing.icon.clone()),
            ..server
        };
    } else {
        history.servers.push(server);
    }
    true
}

#[derive(Default, Deserialize)]
struct SavedServers {
    #[serde(default)]
    servers: Vec<SavedServer>,
}
#[derive(Deserialize)]
struct SavedServer {
    name: String,
    ip: String,
    #[serde(default)]
    icon: Option<String>,
}

fn saved_servers(instance: &Path) -> HashMap<String, (String, Option<String>)> {
    let result = (|| -> Result<SavedServers> {
        let path = instance.join("servers.dat");
        if std::fs::metadata(&path)?.len() > 2 * 1024 * 1024 {
            bail!("servers.dat слишком велик")
        }
        Ok(fastnbt::from_bytes(&std::fs::read(path)?)?)
    })();
    result
        .unwrap_or_default()
        .servers
        .into_iter()
        .filter_map(|server| {
            let address = ServerAddress::parse(&server.ip).ok()?;
            Some((
                address.address,
                (
                    clean_name(&server.name),
                    server.icon.as_deref().and_then(icon),
                ),
            ))
        })
        .collect()
}

fn visit(
    profile: &str,
    address: &str,
    name: &str,
    played: u64,
    saved: &HashMap<String, (String, Option<String>)>,
) -> Option<RecentServer> {
    let address = ServerAddress::parse(address).ok()?.address;
    let (saved_name, image) = saved.get(&address).cloned().unwrap_or_default();
    let name = if !saved_name.is_empty() {
        saved_name
    } else if !clean_name(name).is_empty() {
        clean_name(name)
    } else {
        address.clone()
    };
    Some(RecentServer {
        id: identity(profile, &address),
        address,
        name,
        profile_id: profile.into(),
        last_played: played,
        icon: image,
    })
}

fn quickplay_visits(
    profile: &str,
    value: &Value,
    saved: &HashMap<String, (String, Option<String>)>,
) -> Vec<RecentServer> {
    let entries = value
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(std::slice::from_ref(value));
    entries
        .iter()
        .filter_map(|entry| {
            let world = entry
                .get("quickPlayWorld")
                .or_else(|| entry.get("world"))
                .unwrap_or(entry);
            if !world["type"].as_str()?.eq_ignore_ascii_case("multiplayer") {
                return None;
            }
            let address = world["identifier"]
                .as_str()
                .or_else(|| world["id"].as_str())?;
            let address = if let Some(port) = world["port"].as_u64() {
                let parsed = ServerAddress::parse(address).ok()?;
                if parsed.host.contains(':') {
                    format!("[{}]:{port}", parsed.host)
                } else {
                    format!("{}:{port}", parsed.host)
                }
            } else {
                address.into()
            };
            let played = if let Some(value) = entry["lastPlayedTime"].as_str() {
                chrono::DateTime::parse_from_rfc3339(value)
                    .ok()?
                    .timestamp()
                    .try_into()
                    .ok()?
            } else {
                let timestamp = entry["lastPlayedTime"].as_u64()?;
                if timestamp > 10_000_000_000 {
                    timestamp / 1000
                } else {
                    timestamp
                }
            };
            visit(
                profile,
                &address,
                world["name"]
                    .as_str()
                    .or_else(|| world["displayName"].as_str())
                    .unwrap_or(""),
                played,
                saved,
            )
        })
        .collect()
}

fn log_visits(
    profile: &str,
    text: &str,
    date: NaiveDate,
    saved: &HashMap<String, (String, Option<String>)>,
) -> Vec<RecentServer> {
    static CONNECTION: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"^\[(\d{2}:\d{2}:\d{2})\] \[Render thread/INFO\]: Connecting to ([^\s,]+)(?:, (\d+))?\r?$").unwrap()
    });
    text.lines()
        .filter_map(|line| {
            let matched = CONNECTION.captures(line)?;
            let time = NaiveTime::parse_from_str(&matched[1], "%H:%M:%S").ok()?;
            let played = Local
                .from_local_datetime(&date.and_time(time))
                .earliest()?
                .timestamp()
                .try_into()
                .ok()?;
            let address = if let Some(port) = matched.get(3) {
                let host = &matched[2];
                if host.contains(':') && !host.starts_with('[') {
                    format!("[{host}]:{}", port.as_str())
                } else {
                    format!("{host}:{}", port.as_str())
                }
            } else {
                matched[2].to_string()
            };
            visit(profile, &address, "", played, saved)
        })
        .collect()
}

fn discover(
    profiles: Vec<(String, PathBuf)>,
    mut scanned: HashMap<PathBuf, (u64, SystemTime)>,
) -> (Vec<RecentServer>, HashMap<PathBuf, (u64, SystemTime)>) {
    let mut found = Vec::new();
    for (profile, instance) in profiles {
        let saved = saved_servers(&instance);
        let mut paths = vec![instance.join("logs/latest.log")];
        for directory in [instance.join("logs"), instance.join(".aurum/quickplay")] {
            if let Ok(entries) = std::fs::read_dir(directory) {
                paths.extend(
                    entries
                        .filter_map(Result::ok)
                        .map(|entry| entry.path())
                        .filter(|path| {
                            path.extension()
                                .is_some_and(|extension| extension == "gz" || extension == "json")
                        }),
                );
            }
        }
        paths.sort_by_cached_key(|path| {
            std::cmp::Reverse(
                std::fs::metadata(path)
                    .and_then(|metadata| metadata.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH),
            )
        });
        let mut budget = 32 * 1024 * 1024;
        for path in paths.into_iter().take(128) {
            let Ok(metadata) = std::fs::metadata(&path) else {
                continue;
            };
            let Ok(modified) = metadata.modified() else {
                continue;
            };
            let stamp = (metadata.len(), modified);
            if modified
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                < crate::now().saturating_sub(WEEK)
                || scanned.get(&path) == Some(&stamp)
                || metadata.len() > MAX_FILE
            {
                continue;
            }
            let result = (|| -> Result<Vec<RecentServer>> {
                let file = std::fs::File::open(&path)?;
                let mut text = String::new();
                if path.extension().is_some_and(|extension| extension == "gz") {
                    flate2::read::GzDecoder::new(file)
                        .take(MAX_FILE + 1)
                        .read_to_string(&mut text)?;
                } else {
                    file.take(MAX_FILE + 1).read_to_string(&mut text)?;
                }
                if text.len() as u64 > MAX_FILE || text.len() > budget {
                    bail!("Журнал слишком велик")
                }
                budget -= text.len();
                if path
                    .extension()
                    .is_some_and(|extension| extension == "json")
                {
                    Ok(quickplay_visits(
                        &profile,
                        &serde_json::from_str(&text)?,
                        &saved,
                    ))
                } else {
                    let date = path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .and_then(|name| name.get(..10))
                        .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                        .unwrap_or_else(|| chrono::DateTime::<Local>::from(modified).date_naive());
                    Ok(log_visits(&profile, &text, date, &saved))
                }
            })();
            if let Ok(visits) = result {
                found.extend(visits);
                scanned.insert(path, stamp);
            }
            if budget == 0 {
                break;
            }
        }
    }
    (found, scanned)
}

impl Engine {
    pub async fn recent_servers(&self) -> Result<Vec<RecentServer>> {
        let profiles = self
            .db
            .lock()
            .await
            .profiles
            .iter()
            .filter_map(|profile| {
                self.instance(&profile.id)
                    .ok()
                    .map(|path| (profile.id.clone(), path))
            })
            .collect::<Vec<_>>();
        let _guard = self.servers.history.lock().await;
        let mut history = read_history(&self.root).await?;
        let scanned = self.servers.scanned.lock().await.clone();
        let sources = profiles.clone();
        let (visits, scanned) =
            tokio::task::spawn_blocking(move || discover(sources, scanned)).await?;
        let mut changed = false;
        for server in visits {
            changed |= remember(&mut history, server);
        }
        let length = history.servers.len();
        history.servers.retain(|server| {
            server.last_played >= crate::now().saturating_sub(WEEK)
                && profiles.iter().any(|(id, _)| *id == server.profile_id)
        });
        history
            .servers
            .sort_by_key(|server| std::cmp::Reverse(server.last_played));
        history.servers.truncate(100);
        history
            .removed
            .retain(|_, removed| *removed >= crate::now().saturating_sub(WEEK));
        if changed || length != history.servers.len() {
            save_history(&self.root, &history).await?;
        }
        *self.servers.scanned.lock().await = scanned;
        Ok(history.servers)
    }

    pub async fn recent_server(&self, id: &str) -> Result<RecentServer> {
        let _guard = self.servers.history.lock().await;
        let server = read_history(&self.root)
            .await?
            .servers
            .into_iter()
            .find(|server| server.id == id)
            .context("Сервер больше не находится в списке")?;
        self.profile(&server.profile_id).await?;
        Ok(server)
    }

    pub async fn remember_server(
        &self,
        profile: &str,
        address: &str,
        name: &str,
        played: u64,
    ) -> Result<()> {
        self.profile(profile).await?;
        let instance = self.instance(profile)?;
        let saved = tokio::task::spawn_blocking(move || saved_servers(&instance)).await?;
        let server =
            visit(profile, address, name, played, &saved).context("Некорректный адрес сервера")?;
        let _guard = self.servers.history.lock().await;
        let mut history = read_history(&self.root).await?;
        if remember(&mut history, server) {
            save_history(&self.root, &history).await?;
        }
        Ok(())
    }

    pub async fn remove_recent_server(&self, id: &str) -> Result<()> {
        let _guard = self.servers.history.lock().await;
        let mut history = read_history(&self.root).await?;
        let removed = history
            .servers
            .iter()
            .find(|server| server.id == id)
            .map(|server| server.last_played)
            .unwrap_or_default()
            .max(crate::now());
        history.servers.retain(|server| server.id != id);
        history.removed.insert(id.into(), removed);
        save_history(&self.root, &history).await
    }

    pub async fn server_status(&self, id: &str, force: bool) -> Result<ServerStatus> {
        let server = self.recent_server(id).await?;
        if !force {
            if let Some(status) = self
                .servers
                .statuses
                .lock()
                .await
                .get(id)
                .filter(|status| crate::now().saturating_sub(status.checked_at) < 30)
            {
                return Ok(status.clone());
            }
        }
        let _permit = self.servers.connections.acquire().await?;
        let status = tokio::time::timeout(
            Duration::from_secs(5),
            ping(&ServerAddress::parse(&server.address)?),
        )
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(ServerStatus {
            online: false,
            players: None,
            max_players: None,
            latency_ms: None,
            icon: None,
            checked_at: crate::now(),
        });
        self.servers
            .statuses
            .lock()
            .await
            .insert(id.into(), status.clone());
        if let Some(image) = status.icon.as_ref() {
            let _guard = self.servers.history.lock().await;
            let mut history = read_history(&self.root).await?;
            if let Some(entry) = history
                .servers
                .iter_mut()
                .find(|entry| entry.id == id && entry.icon.as_ref() != Some(image))
            {
                entry.icon = Some(image.clone());
                save_history(&self.root, &history).await?;
            }
        }
        Ok(status)
    }
}

fn varint(mut value: u32, bytes: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        bytes.push(byte);
        if value == 0 {
            break;
        }
    }
}

async fn read_varint(stream: &mut TcpStream) -> Result<usize> {
    let mut value = 0u32;
    for shift in (0..35).step_by(7) {
        let byte = stream.read_u8().await?;
        if shift == 28 && byte & 0xf0 != 0 {
            bail!("Некорректный пакет сервера")
        }
        value |= u32::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value as usize);
        }
    }
    bail!("Некорректный пакет сервера")
}

pub async fn ping(address: &ServerAddress) -> Result<ServerStatus> {
    let started = std::time::Instant::now();
    let mut destination = (address.host.clone(), address.port);
    if address.port == 25565
        && address.host.parse::<IpAddr>().is_err()
        && address.host != "localhost"
    {
        if let Ok(resolver) =
            hickory_resolver::Resolver::builder_tokio().and_then(|builder| builder.build())
        {
            if let Ok(Ok(records)) = tokio::time::timeout(
                Duration::from_millis(1500),
                resolver.srv_lookup(format!("_minecraft._tcp.{}.", address.host)),
            )
            .await
            {
                if let Some(record) = records
                    .answers()
                    .iter()
                    .filter_map(|record| match &record.data {
                        hickory_resolver::proto::rr::RData::SRV(record) => Some(record),
                        _ => None,
                    })
                    .min_by_key(|record| (record.priority, std::cmp::Reverse(record.weight)))
                {
                    destination = (
                        record.target.to_utf8().trim_end_matches('.').into(),
                        record.port,
                    );
                }
            }
        }
    }
    let mut stream = TcpStream::connect((destination.0.as_str(), destination.1)).await?;
    let mut handshake = vec![0];
    varint(u32::MAX, &mut handshake);
    varint(address.host.len() as u32, &mut handshake);
    handshake.extend_from_slice(address.host.as_bytes());
    handshake.extend_from_slice(&address.port.to_be_bytes());
    handshake.push(1);
    let mut request = vec![];
    varint(handshake.len() as u32, &mut request);
    request.extend(handshake);
    request.extend([1, 0]);
    stream.write_all(&request).await?;
    let length = read_varint(&mut stream).await?;
    if !(3..=256 * 1024).contains(&length) {
        bail!("Слишком большой ответ сервера")
    }
    let mut packet = vec![0; length];
    stream.read_exact(&mut packet).await?;
    if packet[0] != 0 {
        bail!("Неизвестный ответ сервера")
    }
    let mut cursor = 1;
    let mut json_length = 0usize;
    loop {
        if cursor > 5 || cursor >= packet.len() {
            bail!("Некорректный пакет сервера")
        }
        let byte = packet[cursor];
        json_length |= usize::from(byte & 0x7f) << ((cursor - 1) * 7);
        cursor += 1;
        if byte & 0x80 == 0 {
            break;
        }
    }
    if json_length != packet.len() - cursor {
        bail!("Некорректная длина ответа сервера")
    }
    let response: Value = serde_json::from_slice(&packet[cursor..])?;
    if !response.is_object() || response.get("version").is_none() {
        bail!("Ответ не является статусом Minecraft")
    }
    Ok(ServerStatus {
        online: true,
        players: response["players"]["online"]
            .as_u64()
            .and_then(|count| count.try_into().ok()),
        max_players: response["players"]["max"]
            .as_u64()
            .and_then(|count| count.try_into().ok()),
        latency_ms: Some(started.elapsed().as_millis() as u64),
        icon: response["favicon"].as_str().and_then(icon),
        checked_at: crate::now(),
    })
}

pub fn quickplay_supported(version: &str, metadata: &Value) -> bool {
    metadata["arguments"]["game"]
        .to_string()
        .contains("--quickPlayMultiplayer")
        || version
            .split('.')
            .next()
            .and_then(|major| major.parse::<u32>().ok())
            .is_some_and(|major| major >= 26)
        || version
            .strip_prefix("1.")
            .and_then(|minor| minor.split('.').next()?.parse::<u32>().ok())
            .is_some_and(|minor| minor >= 20)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Loader;
    use serde_json::json;
    use tokio::net::TcpListener;

    fn root() -> tempfile::TempDir {
        let directory =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/server-manager");
        std::fs::create_dir_all(&directory).unwrap();
        tempfile::tempdir_in(directory).unwrap()
    }

    async fn profile(engine: &Engine, name: &str) -> String {
        engine
            .create_profile(
                name.into(),
                "1.21.11".into(),
                Loader::Fabric,
                Some("0.19.5".into()),
                0,
            )
            .await
            .unwrap()
            .id
    }

    #[test]
    fn addresses_normalize_ports_ipv6_and_reject_injection() {
        assert_eq!(
            ServerAddress::parse(" Example.ORG.:25565 ")
                .unwrap()
                .address,
            "example.org"
        );
        assert_eq!(ServerAddress::parse("[::1]:25566").unwrap().host, "::1");
        assert_eq!(ServerAddress::parse("::1").unwrap().address, "[::1]");
        for address in [
            "",
            "https://host",
            "host/",
            "host:0",
            "host:65536",
            "host --demo",
            "host\nflag",
            "[::1]x",
            "a..b",
            "host;calc",
        ] {
            assert!(ServerAddress::parse(address).is_err(), "{address}");
        }
        assert!(quickplay_supported("1.21.11", &json!({})));
        assert!(!quickplay_supported("1.19.4", &json!({})));
        assert!(quickplay_supported(
            "23w14a",
            &json!({"arguments":{"game":["--quickPlayMultiplayer"]}})
        ));
    }

    #[test]
    fn quickplay_and_old_logs_only_capture_multiplayer_connections() {
        let now = chrono::Local::now();
        let entries = json!([
            {"type":"multiplayer","id":"EXAMPLE.org:25566","name":"A server","lastPlayedTime":now.to_rfc3339()},
            {"type":"singleplayer","id":"World","name":"Private world","lastPlayedTime":now.to_rfc3339()},
            {"type":"realms","id":"1234","lastPlayedTime":now.to_rfc3339()}
        ]);
        let visits = quickplay_visits("profile", &entries, &HashMap::new());
        assert_eq!(visits.len(), 1);
        assert_eq!(visits[0].address, "example.org:25566");
        let lines = format!("[{}] [Render thread/INFO]: Connecting to example.org, 25565\n[{}] [Render thread/INFO]: [CHAT] Connecting to fake.example, 25565\n", now.format("%H:%M:%S"), now.format("%H:%M:%S"));
        let visits = log_visits("profile", &lines, now.date_naive(), &HashMap::new());
        assert_eq!(visits.len(), 1);
        assert_eq!(visits[0].address, "example.org");
    }

    #[tokio::test]
    async fn history_deduplicates_per_profile_expires_and_preserves_removal() {
        let root = root();
        let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
        let first = profile(&engine, "First").await;
        let second = profile(&engine, "Second").await;
        engine
            .remember_server(&first, "EXAMPLE.org:25565", "Example", crate::now() - 10)
            .await
            .unwrap();
        engine
            .remember_server(&first, "example.org", "Example", crate::now() - 5)
            .await
            .unwrap();
        engine
            .remember_server(&second, "example.org", "Second profile", crate::now())
            .await
            .unwrap();
        engine
            .remember_server(&first, "old.example", "Old", crate::now() - WEEK - 1)
            .await
            .unwrap();
        let history = engine.recent_servers().await.unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].profile_id, second);
        let removed = history[0].clone();
        engine.remove_recent_server(&removed.id).await.unwrap();
        engine
            .remember_server(&second, "example.org", "Old visit", removed.last_played)
            .await
            .unwrap();
        assert_eq!(engine.recent_servers().await.unwrap().len(), 1);
        engine
            .remember_server(&second, "example.org", "New visit", crate::now() + 2)
            .await
            .unwrap();
        assert_eq!(engine.recent_servers().await.unwrap().len(), 2);
        drop(engine);
        let reopened = Engine::new(root.path().into(), |_| {}).await.unwrap();
        assert_eq!(reopened.recent_servers().await.unwrap().len(), 2);
        reopened.delete_profile(&first).await.unwrap();
        assert_eq!(reopened.recent_servers().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn existing_history_imports_names_icons_gzip_and_ignores_unvisited_saved_servers() {
        let root = root();
        let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
        let id = profile(&engine, "History").await;
        let instance = engine.profile_directory(&id).await.unwrap();
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(64, 64)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let image = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
        #[derive(Serialize)]
        struct Saved {
            servers: Vec<HashMap<String, String>>,
        }
        let servers = Saved {
            servers: vec![
                HashMap::from([
                    ("name".into(), "Saved name".into()),
                    ("ip".into(), "play.example.org".into()),
                    ("icon".into(), image),
                ]),
                HashMap::from([
                    ("name".into(), "Never joined".into()),
                    ("ip".into(), "unvisited.example.org".into()),
                ]),
            ],
        };
        std::fs::write(
            instance.join("servers.dat"),
            fastnbt::to_bytes(&servers).unwrap(),
        )
        .unwrap();
        std::fs::create_dir_all(instance.join("logs")).unwrap();
        let now = Local::now();
        let path = instance
            .join("logs")
            .join(format!("{}-1.log.gz", now.format("%Y-%m-%d")));
        let mut gzip = flate2::write::GzEncoder::new(
            std::fs::File::create(path).unwrap(),
            flate2::Compression::default(),
        );
        std::io::Write::write_all(
            &mut gzip,
            format!(
                "[{}] [Render thread/INFO]: Connecting to play.example.org, 25565\n",
                now.format("%H:%M:%S")
            )
            .as_bytes(),
        )
        .unwrap();
        gzip.finish().unwrap();
        let history = engine.recent_servers().await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].name, "Saved name");
        assert!(history[0]
            .icon
            .as_ref()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        engine.remove_recent_server(&history[0].id).await.unwrap();
        drop(engine);
        let reopened = Engine::new(root.path().into(), |_| {}).await.unwrap();
        assert!(reopened.recent_servers().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn malformed_history_is_preserved_instead_of_reset() {
        let root = root();
        let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
        std::fs::write(root.path().join("recent-servers.json"), b"broken history").unwrap();
        assert!(engine.recent_servers().await.is_err());
        assert_eq!(
            std::fs::read(root.path().join("recent-servers.json")).unwrap(),
            b"broken history"
        );
    }

    async fn serve_status(listener: TcpListener, replies: usize) {
        for _ in 0..replies {
            let (mut stream, _) = listener.accept().await.unwrap();
            let length = read_varint(&mut stream).await.unwrap();
            let mut handshake = vec![0; length];
            stream.read_exact(&mut handshake).await.unwrap();
            assert_eq!(&handshake[1..6], &[255, 255, 255, 255, 15]);
            assert_eq!(handshake.last(), Some(&1));
            let mut request = [0; 2];
            stream.read_exact(&mut request).await.unwrap();
            assert_eq!(request, [1, 0]);
            let json = serde_json::to_vec(&json!({"version":{"name":"fixture","protocol":774},"players":{"online":0,"max":100},"favicon":"data:image/svg+xml;base64,not-a-png"})).unwrap();
            let mut packet = vec![0];
            varint(json.len() as u32, &mut packet);
            packet.extend(json);
            let mut bytes = vec![];
            varint(packet.len() as u32, &mut bytes);
            bytes.extend(packet);
            stream.write_all(&bytes).await.unwrap();
        }
    }

    #[tokio::test]
    async fn local_ping_reports_zero_players_and_refresh_does_not_change_recency() {
        let root = root();
        let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
        let id = profile(&engine, "Status").await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let worker = tokio::spawn(serve_status(listener, 2));
        let played = crate::now() - 300;
        engine
            .remember_server(&id, &address, "Status fixture", played)
            .await
            .unwrap();
        let server = engine.recent_servers().await.unwrap().remove(0);
        let first = engine.server_status(&server.id, false).await.unwrap();
        assert!(first.online);
        assert_eq!(first.players, Some(0));
        assert!(first.icon.is_none());
        assert!(
            engine
                .server_status(&server.id, false)
                .await
                .unwrap()
                .online
        );
        assert!(engine.server_status(&server.id, true).await.unwrap().online);
        worker.await.unwrap();
        assert!(!engine.server_status(&server.id, true).await.unwrap().online);
        assert_eq!(
            engine.recent_servers().await.unwrap()[0].last_played,
            played
        );
    }

    #[tokio::test]
    async fn oversized_ping_packets_are_rejected_before_allocating_payloads() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = ServerAddress::parse(&listener.local_addr().unwrap().to_string()).unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream
                .write_all(&[0xff, 0xff, 0xff, 0xff, 0x0f])
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(50)).await;
        });
        assert!(tokio::time::timeout(Duration::from_secs(1), ping(&address))
            .await
            .unwrap()
            .is_err());
    }
}
