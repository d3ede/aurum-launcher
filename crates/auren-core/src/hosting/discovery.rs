use super::{confined, proxy, HostingProfile, HostingSettings};
use anyhow::{bail, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use toml_edit::Document;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingCandidate {
    pub id: String,
    pub name: String,
    pub directory: String,
    pub entrypoint: String,
    pub core: String,
    pub version: String,
    pub java_major: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingInspection {
    pub root: PathBuf,
    pub candidates: Vec<HostingCandidate>,
    pub warnings: Vec<String>,
    pub networks: Vec<HostingNetwork>,
    pub startup_scripts: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingNetwork {
    pub directory: String,
    pub component_ids: Vec<String>,
}

fn relative(root: &Path, path: &Path) -> Result<String> {
    let path = path
        .strip_prefix(root)?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(if path.is_empty() { ".".into() } else { path })
}
fn ignored(entry: &walkdir::DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
    !name.starts_with('.')
        && ![
            "plugins",
            "mods",
            "libraries",
            "cache",
            "versions",
            "logs",
            "downloads",
            "target",
            "src",
            "node_modules",
            "world",
            "world_nether",
            "world_the_end",
            "backups",
            "mariadb",
            "mariadb-data",
            "database",
            "old",
            "third-party",
        ]
        .contains(&name.as_str())
}
fn jar_core(path: &Path) -> Option<String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(path).ok()?).ok()?;
    if ["plugin.yml", "paper-plugin.yml", "velocity-plugin.json"]
        .iter()
        .any(|metadata| archive.by_name(metadata).is_ok())
    {
        return None;
    }
    let mut manifest = String::new();
    archive
        .by_name("META-INF/MANIFEST.MF")
        .ok()?
        .take(65536)
        .read_to_string(&mut manifest)
        .ok()?;
    let main = manifest
        .lines()
        .find_map(|line| line.strip_prefix("Main-Class:"))
        .map(str::trim)?;
    if main.is_empty()
        || !main
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || b"._$".contains(&character))
    {
        return None;
    }
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    for core in [
        "velocity",
        "waterfall",
        "bungeecord",
        "folia",
        "purpur",
        "paper",
        "spigot",
        "fabric",
        "quilt",
        "neoforge",
        "forge",
    ] {
        if name.contains(core) {
            return Some(core.into());
        }
    }
    let metadata = manifest.to_ascii_lowercase();
    for (needle, core) in [
        ("velocitypowered", "velocity"),
        ("bungeecord", "bungeecord"),
        ("purpur", "purpur"),
        ("folia", "folia"),
        ("paperclip", "paper"),
        ("papermc", "paper"),
        ("spigot", "spigot"),
        ("fabricmc", "fabric"),
    ] {
        if metadata.contains(needle) {
            return Some(core.into());
        }
    }
    if main.starts_with("net.minecraft.") {
        Some("vanilla".into())
    } else {
        Some("custom".into())
    }
}
pub(super) fn jar_major(path: &Path) -> u32 {
    let Ok(file) = fs::File::open(path) else {
        return 0;
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return 0;
    };
    let mut main_classes = Vec::new();
    for metadata in [
        "META-INF/MANIFEST.MF",
        "plugin.yml",
        "paper-plugin.yml",
        "velocity-plugin.json",
    ] {
        if let Ok(entry) = archive.by_name(metadata) {
            let mut text = String::new();
            if entry.take(65536).read_to_string(&mut text).is_ok() {
                if metadata.ends_with(".json") {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(main) = value["main"].as_str() {
                            main_classes.push(main.to_owned());
                        }
                    }
                } else {
                    for line in text.lines() {
                        if let Some(main) = line
                            .strip_prefix("Main-Class:")
                            .or_else(|| line.strip_prefix("main:"))
                        {
                            main_classes.push(main.trim().trim_matches(['\'', '"']).into());
                        }
                    }
                }
            }
        }
    }
    let mut major = 0;
    for main in main_classes {
        if let Ok(mut entry) = archive.by_name(&format!("{}.class", main.replace('.', "/"))) {
            let mut header = [0; 8];
            if entry.read_exact(&mut header).is_ok() && header[..4] == [0xca, 0xfe, 0xba, 0xbe] {
                major =
                    major.max(u16::from_be_bytes([header[6], header[7]]).saturating_sub(44) as u32);
            }
        }
    }
    if major > 0 {
        return major;
    }
    for index in 0..archive.len().min(32) {
        let Ok(mut entry) = archive.by_index(index) else {
            continue;
        };
        if !entry.name().ends_with(".class") || entry.name().starts_with("META-INF/versions/") {
            continue;
        }
        let mut header = [0; 8];
        if entry.read_exact(&mut header).is_ok() && header[..4] == [0xca, 0xfe, 0xba, 0xbe] {
            major = major.max(u16::from_be_bytes([header[6], header[7]]).saturating_sub(44) as u32);
        }
        if major >= 25 {
            break;
        }
    }
    major
}
fn jars(folder: &Path) -> Vec<PathBuf> {
    fs::read_dir(folder)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("jar"))
                && !path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .contains("installer")
        })
        .take(256)
        .collect()
}
pub fn inspect(root: &Path) -> Result<HostingInspection> {
    let root = root.canonicalize().context("Папка сервера не найдена")?;
    if !root.is_dir() {
        bail!("Выберите папку сервера")
    }
    let mut result = HostingInspection { root: root.clone(), candidates: Vec::new(), warnings: vec!["Стартовые скрипты, внешние БД и службы не запускаются. Проверьте Java, JVM-флаги и зависимости перед первым запуском.".into()], networks: Vec::new(), startup_scripts: Vec::new() };
    for name in [
        "start.bat",
        "start.cmd",
        "start.ps1",
        "start.sh",
        "run.bat",
        "run.cmd",
        "run.ps1",
        "run.sh",
    ] {
        if root.join(name).is_file() && confined(&root, name).is_ok() {
            result.startup_scripts.push(name.into());
        }
    }
    let version_pattern =
        regex::Regex::new(r"(?:^|[^0-9])(1\.\d+(?:\.\d+)?|2[6-9]\.\d+(?:\.\d+)?)(?:[^0-9]|$)")?;
    let mut java_cache = std::collections::HashMap::new();
    for entry in walkdir::WalkDir::new(&root)
        .max_depth(5)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || ignored(entry))
        .take(10000)
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let folder = entry.path();
        if !entry.file_type().is_dir() {
            continue;
        }
        let local_jars = jars(folder);
        let is_velocity = folder.join("velocity.toml").is_file();
        let is_proxy = is_velocity
            || (!folder.join("server.properties").exists()
                && local_jars
                    .iter()
                    .any(|jar| jar_core(jar).is_some_and(|core| proxy(&core))));
        let has_config = is_velocity
            || folder.join("server.properties").is_file()
            || folder.join("config.yml").is_file();
        if !has_config && folder != root {
            continue;
        }
        let mut choices = local_jars;
        if choices.is_empty() && has_config {
            let mut parent = folder.parent();
            while let Some(directory) = parent.filter(|directory| directory.starts_with(&root)) {
                choices.extend(jars(&directory.join("distributions")));
                if !choices.is_empty() {
                    break;
                }
                parent = directory.parent();
            }
        }
        choices.retain(|path| {
            path.canonicalize()
                .is_ok_and(|path| path.starts_with(&root))
                && jar_core(path).is_some_and(|core| proxy(&core) == is_proxy)
        });
        choices.sort_by_key(|path| {
            (
                if path.file_name().unwrap_or_default() == "paper.jar" {
                    0
                } else {
                    1
                },
                path.clone(),
            )
        });
        let Some(jar) = choices.first() else { continue };
        let directory = relative(&root, folder)?;
        let entrypoint = relative(&root, jar)?;
        let core = if is_velocity {
            "velocity".into()
        } else {
            jar_core(jar).context("Исполняемый JAR изменился во время поиска")?
        };
        let filename = jar.file_name().unwrap_or_default().to_string_lossy();
        let version = version_pattern
            .captures(&filename)
            .map(|capture| capture[1].to_owned())
            .unwrap_or_else(|| "—".into());
        let default_java = if version.starts_with("26.") { 25 } else { 21 };
        let mut java_major = default_java.max(
            *java_cache
                .entry(jar.clone())
                .or_insert_with(|| jar_major(jar)),
        );
        for plugin in jars(&folder.join("plugins"))
            .iter()
            .filter(|path| {
                path.canonicalize()
                    .is_ok_and(|path| path.starts_with(&root))
            })
            .take(64)
        {
            java_major = java_major.max(
                *java_cache
                    .entry(plugin.clone())
                    .or_insert_with(|| jar_major(plugin)),
            );
        }
        let digest = format!("{:x}", Sha256::digest(format!("{directory}\n{entrypoint}")));
        result.candidates.push(HostingCandidate {
            id: digest,
            name: folder
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            directory,
            entrypoint,
            core,
            version,
            java_major,
        });
        if result.candidates.len() >= 64 {
            result
                .warnings
                .push("Показаны первые 64 компонента. Выберите более узкую папку.".into());
            break;
        }
    }
    let mut parents = std::collections::BTreeSet::new();
    for candidate in &result.candidates {
        if proxy(&candidate.core) {
            let parent = Path::new(&candidate.directory)
                .parent()
                .unwrap_or(Path::new(""));
            parents.insert(if parent.as_os_str().is_empty() {
                ".".into()
            } else {
                parent.to_string_lossy().replace('\\', "/")
            });
        }
    }
    for directory in parents {
        let component_ids: Vec<String> = result
            .candidates
            .iter()
            .filter(|candidate| {
                let parent = Path::new(&candidate.directory)
                    .parent()
                    .unwrap_or(Path::new(""));
                let parent = if parent.as_os_str().is_empty() {
                    ".".into()
                } else {
                    parent.to_string_lossy().replace('\\', "/")
                };
                parent == directory
            })
            .map(|candidate| candidate.id.clone())
            .collect();
        if component_ids.len() > 1 {
            result.networks.push(HostingNetwork {
                directory,
                component_ids,
            });
        }
    }
    if result.candidates.is_empty() {
        result.warnings.push("Исполняемый JAR не найден. Для Forge/NeoForge с @args укажите подготовленный исполняемый сервер; shell-скрипты не исполняются.".into());
    }
    Ok(result)
}

pub(crate) fn read_small(path: &Path) -> Result<String> {
    if !path.exists() {
        return Ok(String::new());
    }
    if fs::metadata(path)?.len() > 1024 * 1024 {
        bail!("Конфигурация слишком велика")
    }
    fs::read_to_string(path).context("Конфигурация должна быть в UTF-8")
}
pub(crate) fn config_path(profile: &HostingProfile, file: &str) -> Result<PathBuf> {
    let folder = confined(&profile.root, &profile.directory)?;
    let path = folder.join(file);
    match fs::symlink_metadata(&path) {
        Ok(_) => confined(&profile.root, &relative(&profile.root, &path)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path),
        Err(error) => Err(error.into()),
    }
}
fn property<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines()
        .filter_map(|line| line.trim().split_once('='))
        .filter(|(name, _)| name.trim() == key)
        .map(|(_, value)| value.trim())
        .next_back()
}
pub(crate) fn settings(profile: &HostingProfile) -> Result<HostingSettings> {
    if profile.core == "velocity" {
        let document = read_small(&config_path(profile, "velocity.toml")?)?.parse::<Document>()?;
        let bind = document
            .get("bind")
            .and_then(toml_edit::Item::as_str)
            .unwrap_or("127.0.0.1:25577");
        let (host, port) = bind.rsplit_once(':').unwrap_or(("127.0.0.1", "25577"));
        return Ok(HostingSettings {
            port: port.parse().unwrap_or(25577),
            bind: host.trim_matches(['[', ']']).into(),
            online_mode: document
                .get("online-mode")
                .and_then(toml_edit::Item::as_bool)
                .unwrap_or(true),
            max_players: document
                .get("show-max-players")
                .and_then(toml_edit::Item::as_integer)
                .unwrap_or(500)
                .max(0) as u32,
            motd: document
                .get("motd")
                .and_then(toml_edit::Item::as_str)
                .unwrap_or("")
                .into(),
        });
    }
    if proxy(&profile.core) {
        let text = read_small(&config_path(profile, "config.yml")?)?;
        let host = text
            .lines()
            .filter_map(|line| line.trim().strip_prefix("host:"))
            .next()
            .unwrap_or("127.0.0.1:25577")
            .trim()
            .trim_matches(['\'', '"']);
        let (bind, port) = host.rsplit_once(':').unwrap_or(("127.0.0.1", "25577"));
        return Ok(HostingSettings {
            port: port.parse().context("Неверный порт прокси")?,
            bind: bind.trim_matches(['[', ']']).into(),
            online_mode: !text.lines().any(|line| line.trim() == "online_mode: false"),
            max_players: 100,
            motd: String::new(),
        });
    }
    let text = read_small(&config_path(profile, "server.properties")?)?;
    Ok(HostingSettings {
        port: property(&text, "server-port")
            .unwrap_or("25565")
            .parse()
            .context("Неверный server-port")?,
        bind: property(&text, "server-ip").unwrap_or("").into(),
        online_mode: property(&text, "online-mode") != Some("false"),
        max_players: property(&text, "max-players")
            .unwrap_or("20")
            .parse()
            .unwrap_or(20),
        motd: property(&text, "motd").unwrap_or("").into(),
    })
}
pub(crate) fn write_settings(profile: &HostingProfile, settings: &HostingSettings) -> Result<()> {
    let previous = self::settings(profile)?;
    if &previous == settings {
        return Ok(());
    }
    if proxy(&profile.core) && profile.core != "velocity" {
        bail!("Настройки этого прокси редактируются в его конфигурации")
    }
    let folder = confined(&profile.root, &profile.directory)?;
    let file = if profile.core == "velocity" {
        "velocity.toml"
    } else {
        "server.properties"
    };
    let path = config_path(profile, file)?;
    let original = read_small(&path)?;
    let updated = if profile.core == "velocity" {
        let mut document = original.parse::<Document>()?;
        let host = if settings.bind.is_empty() {
            "0.0.0.0"
        } else {
            &settings.bind
        };
        let address = if host.contains(':') {
            format!("[{host}]:{}", settings.port)
        } else {
            format!("{host}:{}", settings.port)
        };
        document["bind"] = toml_edit::value(address);
        document["online-mode"] = toml_edit::value(settings.online_mode);
        document["show-max-players"] = toml_edit::value(settings.max_players as i64);
        document["motd"] = toml_edit::value(&settings.motd);
        document.to_string()
    } else {
        let values: Vec<_> = [
            (
                "server-port",
                settings.port.to_string(),
                settings.port != previous.port,
            ),
            (
                "server-ip",
                settings.bind.clone(),
                settings.bind != previous.bind,
            ),
            (
                "online-mode",
                settings.online_mode.to_string(),
                settings.online_mode != previous.online_mode,
            ),
            (
                "max-players",
                settings.max_players.to_string(),
                settings.max_players != previous.max_players,
            ),
            (
                "motd",
                settings.motd.clone(),
                settings.motd != previous.motd,
            ),
        ]
        .into_iter()
        .filter(|(_, _, changed)| *changed)
        .map(|(key, value, _)| (key, value))
        .collect();
        let mut lines: Vec<String> = original
            .lines()
            .filter(|line| {
                !values.iter().any(|(key, _)| {
                    line.trim()
                        .split_once('=')
                        .is_some_and(|(name, _)| name.trim() == *key)
                })
            })
            .map(str::to_owned)
            .collect();
        lines.extend(values.iter().map(|(key, value)| format!("{key}={value}")));
        format!("{}\n", lines.join("\n"))
    };
    if original == updated {
        return Ok(());
    }
    let backup = folder.join(format!("{file}.aurum-backup"));
    if !backup.exists() {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup)?
            .write_all(original.as_bytes())?;
    }
    let temporary = folder.join(format!(".{file}.{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary, updated)?;
    fs::rename(temporary, path)?;
    Ok(())
}
use std::io::Write;

#[cfg(test)]
mod tests {
    use super::*;
    fn profile(root: &Path, core: &str) -> HostingProfile {
        HostingProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Test".into(),
            description: String::new(),
            root: root.canonicalize().unwrap(),
            directory: ".".into(),
            entrypoint: "server.jar".into(),
            core: core.into(),
            version: "1.21.11".into(),
            java_major: 21,
            java_path: String::new(),
            ram_mb: 1024,
            jvm_args: String::new(),
            icon: super::super::HostingIcon::default(),
            launches: 0,
            last_started: None,
            network: None,
        }
    }
    #[test]
    fn settings_preserve_passwords_unknown_keys_and_unchanged_motd() {
        let folder = tempfile::tempdir().unwrap();
        let original = "# Original\nserver-port=25565\nmotd=\\u00a7Gold\\nSecond line\nrcon.password=do-not-touch\ncustom=value\n";
        fs::write(folder.path().join("server.properties"), original).unwrap();
        let profile = profile(folder.path(), "paper");
        let mut current = settings(&profile).unwrap();
        write_settings(&profile, &current).unwrap();
        assert_eq!(
            fs::read_to_string(folder.path().join("server.properties")).unwrap(),
            original
        );
        current.port = 25566;
        write_settings(&profile, &current).unwrap();
        let updated = fs::read_to_string(folder.path().join("server.properties")).unwrap();
        assert!(updated.contains("rcon.password=do-not-touch\ncustom=value"));
        assert!(updated.contains("motd=\\u00a7Gold\\nSecond line"));
        assert_eq!(
            fs::read_to_string(folder.path().join("server.properties.aurum-backup")).unwrap(),
            original
        );
        assert_eq!(settings(&profile).unwrap().port, 25566);
    }
    #[test]
    fn velocity_missing_defaults_do_not_panic_and_forwarding_secrets_survive() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("velocity.toml"), "bind = \"127.0.0.1:25577\"\nforwarding-secret-file = \"forwarding.secret\"\n[servers]\nlobby = \"127.0.0.1:25566\"\n").unwrap();
        fs::write(folder.path().join("forwarding.secret"), "private").unwrap();
        let profile = profile(folder.path(), "velocity");
        let mut current = settings(&profile).unwrap();
        assert!(current.online_mode);
        current.port = 25578;
        write_settings(&profile, &current).unwrap();
        let document = fs::read_to_string(folder.path().join("velocity.toml"))
            .unwrap()
            .parse::<Document>()
            .unwrap();
        assert_eq!(
            document["servers"]["lobby"].as_str(),
            Some("127.0.0.1:25566")
        );
        assert_eq!(
            document["forwarding-secret-file"].as_str(),
            Some("forwarding.secret")
        );
        assert_eq!(
            fs::read_to_string(folder.path().join("forwarding.secret")).unwrap(),
            "private"
        );
        assert_eq!(settings(&profile).unwrap().port, 25578);
    }
    #[test]
    fn discovers_network_with_shared_distributions_without_running_scripts() {
        let folder = tempfile::tempdir().unwrap();
        for name in [
            "runtime/network/lobby",
            "runtime/network/velocity",
            "runtime/network/distributions",
        ] {
            fs::create_dir_all(folder.path().join(name)).unwrap();
        }
        fs::write(
            folder
                .path()
                .join("runtime/network/lobby/server.properties"),
            "server-port=25566",
        )
        .unwrap();
        fs::write(
            folder.path().join("runtime/network/velocity/velocity.toml"),
            "bind=\"127.0.0.1:25577\"",
        )
        .unwrap();
        super::super::test_server_jar(
            &folder
                .path()
                .join("runtime/network/distributions/paper.jar"),
        );
        super::super::test_server_jar(
            &folder
                .path()
                .join("runtime/network/distributions/velocity.jar"),
        );
        let scan = inspect(folder.path()).unwrap();
        assert_eq!(scan.candidates.len(), 2);
        assert_eq!(scan.networks.len(), 1);
        assert_eq!(scan.networks[0].directory, "runtime/network");
        assert_eq!(scan.networks[0].component_ids.len(), 2);
        assert!(scan
            .candidates
            .iter()
            .any(|candidate| candidate.core == "velocity"));
        assert!(scan
            .candidates
            .iter()
            .all(|candidate| candidate.entrypoint.contains("distributions")));
    }
    #[test]
    fn does_not_mislabel_plugins_and_probe_inputs_as_vanilla_servers() {
        let folder = tempfile::tempdir().unwrap();
        for name in ["actual", "worldgen-probes/experiment"] {
            fs::create_dir_all(folder.path().join(name)).unwrap();
            fs::write(
                folder.path().join(name).join("server.properties"),
                "server-port=25565",
            )
            .unwrap();
        }
        super::super::test_server_jar(&folder.path().join("actual/paper.jar"));
        let mut archive = zip::ZipWriter::new(
            fs::File::create(
                folder
                    .path()
                    .join("worldgen-probes/experiment/Plugin-input.jar"),
            )
            .unwrap(),
        );
        archive
            .start_file("plugin.yml", zip::write::SimpleFileOptions::default())
            .unwrap();
        archive
            .write_all(b"main: example.Plugin\nname: TestPlugin\n")
            .unwrap();
        archive.finish().unwrap();
        fs::write(
            folder.path().join("start.bat"),
            "@echo off\necho This script must not run > never-created.txt",
        )
        .unwrap();
        let scan = inspect(folder.path()).unwrap();
        assert_eq!(scan.candidates.len(), 1);
        assert_eq!(scan.candidates[0].name, "actual");
        assert_eq!(scan.startup_scripts, ["start.bat"]);
        assert!(!folder.path().join("never-created.txt").exists());
    }
}
