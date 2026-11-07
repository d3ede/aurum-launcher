use super::{install::HostingVersion, HostingProfile};
use crate::{model::Loader, store::validate_version, Engine, Task};
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

pub(super) fn is_modded(core: &str) -> bool {
    matches!(core, "fabric" | "forge" | "neoforge")
}
fn loader(core: &str) -> Result<Loader> {
    match core {
        "fabric" => Ok(Loader::Fabric),
        "forge" => Ok(Loader::Forge),
        "neoforge" => Ok(Loader::Neoforge),
        _ => bail!("Выберите Fabric, Forge или NeoForge"),
    }
}
fn neoforge_minecraft(version: &str) -> Option<String> {
    let parts: Vec<_> = version.split(['.', '-']).collect();
    let major = parts.first()?.parse::<u32>().ok()?;
    let minor = parts.get(1)?.parse::<u32>().ok()?;
    if major >= 26 {
        let patch = parts.get(2)?.parse::<u32>().ok()?;
        Some(if patch == 0 {
            format!("{major}.{minor}")
        } else {
            format!("{major}.{minor}.{patch}")
        })
    } else if (20..26).contains(&major) {
        Some(if minor == 0 {
            format!("1.{major}")
        } else {
            format!("1.{major}.{minor}")
        })
    } else {
        None
    }
}
fn minecraft_sort(version: &str) -> Vec<u32> {
    version
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}
async fn maven_versions(engine: &Engine, core: &str) -> Result<Vec<String>> {
    let url = match core {
        "forge" => "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
        "neoforge" => {
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml"
        }
        _ => bail!("Выберите Fabric, Forge или NeoForge"),
    };
    let response = engine.http.get(url).send().await?.error_for_status()?;
    if response
        .content_length()
        .is_some_and(|length| length > 8_000_000)
    {
        bail!("Список версий загрузчика слишком велик")
    }
    let xml = response.text().await?;
    if xml.len() > 8_000_000 {
        bail!("Список версий загрузчика слишком велик")
    }
    let pattern = regex::Regex::new(r"<version>([^<]+)</version>")?;
    Ok(pattern
        .captures_iter(&xml)
        .map(|capture| capture[1].to_owned())
        .collect())
}
pub(super) async fn versions(engine: &Engine, core: &str) -> Result<Vec<HostingVersion>> {
    let mut versions = if core == "fabric" {
        engine
            .json("https://meta.fabricmc.net/v2/versions/game")
            .await?
            .as_array()
            .context("Неизвестный ответ загрузчика")?
            .iter()
            .filter(|item| item["stable"] == true)
            .filter_map(|item| item["version"].as_str().map(str::to_owned))
            .collect::<Vec<_>>()
    } else {
        maven_versions(engine, core)
            .await?
            .iter()
            .filter_map(|version| {
                if core == "forge" {
                    version.split_once('-').map(|(mc, _)| mc.to_owned())
                } else {
                    neoforge_minecraft(version)
                }
            })
            .collect()
    };
    versions.retain(|version| {
        validate_version(version).is_ok()
            && !version.contains('-')
            && (version.starts_with("26.")
                || version
                    .strip_prefix("1.")
                    .and_then(|v| v.split('.').next()?.parse::<u32>().ok())
                    .is_some_and(|minor| minor >= 6))
    });
    versions.sort_by_key(|version| minecraft_sort(version));
    versions.reverse();
    versions.dedup();
    Ok(versions
        .into_iter()
        .map(|version| HostingVersion { version })
        .collect())
}
impl Engine {
    pub async fn hosting_loader_versions(
        &self,
        core: &str,
        minecraft: &str,
        experimental: bool,
    ) -> Result<Vec<String>> {
        validate_version(minecraft)?;
        loader(core)?;
        if core == "fabric" {
            let metadata = self
                .json(&format!(
                    "https://meta.fabricmc.net/v2/versions/loader/{minecraft}"
                ))
                .await?;
            return Ok(metadata
                .as_array()
                .context("Неизвестный ответ загрузчика")?
                .iter()
                .filter(|item| experimental || item["loader"]["stable"] == true)
                .filter_map(|item| {
                    item["loader"]["version"]
                        .as_str()
                        .filter(|v| validate_version(v).is_ok())
                        .map(str::to_owned)
                })
                .collect());
        }
        let mut versions = maven_versions(self, core)
            .await?
            .into_iter()
            .filter_map(|version| {
                if core == "forge" {
                    version
                        .strip_prefix(&format!("{minecraft}-"))
                        .map(str::to_owned)
                } else if neoforge_minecraft(&version).as_deref() == Some(minecraft)
                    && (experimental || !version.contains('-'))
                {
                    Some(version)
                } else {
                    None
                }
            })
            .filter(|version| validate_version(version).is_ok())
            .collect::<Vec<_>>();
        versions.reverse();
        Ok(versions)
    }
}

pub(super) fn forge_installer(core: &str, minecraft: &str, version: &str) -> Result<String> {
    validate_version(minecraft)?;
    validate_version(version)?;
    match core {
        "forge" => Ok(format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{minecraft}-{version}/forge-{minecraft}-{version}-installer.jar")),
        "neoforge" if neoforge_minecraft(version).as_deref() == Some(minecraft) => Ok(format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar")),
        _ => bail!("Версия загрузчика не подходит для выбранного Minecraft"),
    }
}
pub(super) fn forge_entrypoint(
    folder: &Path,
    core: &str,
    minecraft: &str,
    version: &str,
) -> Result<String> {
    let library = if core == "forge" {
        format!("net/minecraftforge/forge/{minecraft}-{version}")
    } else {
        format!("net/neoforged/neoforge/{version}")
    };
    let file = if cfg!(windows) {
        "win_args.txt"
    } else {
        "unix_args.txt"
    };
    let args = format!("libraries/{library}/{file}");
    if folder.join(&args).is_file() {
        super::confined(folder, &args)?;
        return Ok(args);
    }
    // Older Forge releases are executable server JARs instead of JVM argfiles.
    if core == "forge" {
        for entry in std::fs::read_dir(folder)?.take(256) {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type()?.is_file()
                && name.starts_with(&format!("forge-{minecraft}-{version}"))
                && name.ends_with(".jar")
                && !name.contains("installer")
            {
                super::confined(folder, &name)?;
                return Ok(name);
            }
        }
    }
    bail!("Установщик не создал серверные файлы загрузчика")
}
pub(super) fn launch_target(profile: &HostingProfile, folder: &Path) -> Result<Vec<String>> {
    let file = super::confined(&profile.root, &profile.entrypoint)?;
    if matches!(profile.core.as_str(), "forge" | "neoforge")
        && file.extension().is_some_and(|ext| ext == "txt")
    {
        let relative = file
            .strip_prefix(folder)
            .context("Файл запуска должен находиться в папке сервера")?;
        return Ok(vec![format!(
            "@{}",
            relative.to_string_lossy().replace('\\', "/")
        )]);
    }
    let path = if let Ok(relative) = file.strip_prefix(folder) {
        relative.to_string_lossy().replace('\\', "/")
    } else {
        let path = file.to_string_lossy();
        if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{unc}")
        } else {
            path.strip_prefix(r"\\?\").unwrap_or(&path).into()
        }
    };
    Ok(vec!["-jar".into(), path])
}
async fn minecraft_java(engine: &Engine, version: &str) -> Result<u32> {
    let manifest = engine.minecraft_versions().await?;
    let metadata_url = manifest["versions"]
        .as_array()
        .context("Нет версий Mojang")?
        .iter()
        .find(|item| item["id"] == version)
        .and_then(|item| item["url"].as_str())
        .context("Версия Minecraft не найдена")?;
    super::install::official_url(
        metadata_url,
        &["piston-meta.mojang.com", "launchermeta.mojang.com"],
    )?;
    let metadata = engine.json(metadata_url).await?;
    Ok(metadata["javaVersion"]["majorVersion"]
        .as_u64()
        .unwrap_or(8) as u32)
}
pub(super) async fn install(
    engine: &Engine,
    request: &super::install::HostingInstall,
    folder: &Path,
    task: &Task,
) -> Result<(String, u32)> {
    let loaders = engine
        .hosting_loader_versions(&request.core, &request.version, request.experimental)
        .await?;
    let selected = request
        .loader_version
        .as_deref()
        .filter(|value| !value.is_empty())
        .or_else(|| loaders.first().map(String::as_str))
        .context("Нет совместимой версии загрузчика")?;
    if !loaders.iter().any(|version| version == selected) {
        bail!("Версия загрузчика не подходит для выбранного Minecraft")
    }
    let major = minecraft_java(engine, &request.version).await?;
    task.check()?;
    tokio::fs::create_dir_all(folder.join("mods")).await?;
    if request.core == "fabric" {
        let installers = engine
            .json("https://meta.fabricmc.net/v2/versions/installer")
            .await?;
        let installer = installers
            .as_array()
            .context("Неизвестный ответ загрузчика")?
            .iter()
            .find(|item| item["stable"] == true)
            .and_then(|item| item["version"].as_str())
            .context("Нет версии установщика Fabric")?;
        validate_version(installer)?;
        let url = format!(
            "https://meta.fabricmc.net/v2/versions/loader/{}/{selected}/{installer}/server/jar",
            request.version
        );
        task.progress(
            "hosting-install",
            "Загружаем официальный сервер Fabric",
            0,
            0,
        );
        engine
            .download(&url, &folder.join("fabric-server-launch.jar"), None, task)
            .await?;
        return Ok(("fabric-server-launch.jar".into(), major));
    }
    let url = forge_installer(&request.core, &request.version, selected)?;
    let checksum = engine
        .http
        .get(format!("{url}.sha1"))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let checksum = checksum
        .split_whitespace()
        .next()
        .context("Нет SHA1 установщика")?;
    if checksum.len() != 40 || !checksum.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("Нет SHA1 установщика")
    }
    let installer: PathBuf = folder.join("aurum-loader-installer.jar");
    task.progress(
        "hosting-install",
        "Загружаем официальный установщик сервера",
        0,
        0,
    );
    engine
        .download(&url, &installer, Some(("sha1", checksum)), task)
        .await?;
    let java = engine.java_with_path(major, "", task).await?;
    task.progress(
        "hosting-install",
        "Устанавливаем серверный загрузчик и библиотеки",
        0,
        0,
    );
    let mut command = tokio::process::Command::new(java);
    command
        .current_dir(folder)
        .arg("-jar")
        .arg("aurum-loader-installer.jar")
        .arg("--installServer");
    crate::minecraft::hide(&mut command);
    engine.run_installer(command, task).await?;
    task.check()?;
    let entrypoint = forge_entrypoint(folder, &request.core, &request.version, selected)?;
    let _ = tokio::fs::remove_file(installer).await;
    Ok((entrypoint, major))
}

pub(super) async fn create(
    engine: &Engine,
    request: super::install::HostingInstall,
    task: &Task,
) -> Result<HostingProfile> {
    task.check()?;
    let id = uuid::Uuid::new_v4().to_string();
    let base = engine.root.join("hosting/servers");
    tokio::fs::create_dir_all(&base).await?;
    let staging = base.join(format!(".{id}.installing"));
    let target = base.join(&id);
    tokio::fs::create_dir(&staging).await?;
    let result = async {
        let (entrypoint, java_major) = install(engine, &request, &staging, task).await?;
        tokio::fs::write(staging.join("eula.txt"), b"# Minecraft EULA accepted explicitly in Aurum\neula=true\n").await?;
        tokio::fs::write(staging.join("server.properties"), b"server-ip=127.0.0.1\nserver-port=25565\nonline-mode=true\nmax-players=20\nmotd=Aurum local server\nenable-rcon=false\n").await?;
        task.check()?;
        tokio::fs::rename(&staging, &target).await?;
        let profile = HostingProfile { id: id.clone(), name: request.name.trim().into(), description: String::new(), root: target.canonicalize()?, directory: ".".into(), entrypoint, core: request.core, version: request.version, java_major, java_path: String::new(), ram_mb: request.ram_mb, jvm_args: String::new(), icon: super::HostingIcon::default(), launches: 0, last_started: None, network: None };
        let _gate = engine.hosting.gate.lock().await;
        let mut profiles = engine.hosting_profiles_unlocked().await?;
        if profiles.len() >= 100 { bail!("Можно добавить не более 100 серверов") }
        profiles.push(profile.clone());
        engine.hosting_save(&profiles).await?;
        Ok(profile)
    }.await;
    if result.is_err() {
        for directory in [&staging, &target] {
            if directory.exists() && directory.canonicalize()?.starts_with(base.canonicalize()?) {
                let _ = tokio::fs::remove_dir_all(directory).await;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_neoforge_versions_without_mixing_minecraft_patches() {
        assert_eq!(neoforge_minecraft("21.1.100"), Some("1.21.1".into()));
        assert_eq!(neoforge_minecraft("20.2.1-beta"), Some("1.20.2".into()));
        assert_eq!(neoforge_minecraft("26.3.0.101"), Some("26.3".into()));
        assert_eq!(neoforge_minecraft("26.3.1.2"), Some("26.3.1".into()));
        assert_eq!(neoforge_minecraft("../bad"), None);
        assert!(forge_installer("neoforge", "1.21.4", "21.1.100").is_err());
        assert!(forge_installer("forge", "1.21.1", "../../payload").is_err());
        assert!(forge_installer("forge", "1.20.1", "47.4.0")
            .unwrap()
            .ends_with("forge-1.20.1-47.4.0-installer.jar"));
    }
    #[test]
    fn modern_forge_selects_the_official_argfile_and_legacy_selects_a_server_jar() {
        let root = tempfile::tempdir().unwrap();
        let relative = format!(
            "libraries/net/minecraftforge/forge/1.20.1-47.4.0/{}",
            if cfg!(windows) {
                "win_args.txt"
            } else {
                "unix_args.txt"
            }
        );
        std::fs::create_dir_all(root.path().join(&relative).parent().unwrap()).unwrap();
        std::fs::write(root.path().join(&relative), "--launchTarget forgeserver").unwrap();
        assert_eq!(
            forge_entrypoint(root.path(), "forge", "1.20.1", "47.4.0").unwrap(),
            relative
        );
        assert!(forge_entrypoint(root.path(), "neoforge", "1.21.1", "21.1.100").is_err());
        std::fs::write(root.path().join("forge-1.12.2-14.23.5.2860.jar"), "server").unwrap();
        assert_eq!(
            forge_entrypoint(root.path(), "forge", "1.12.2", "14.23.5.2860").unwrap(),
            "forge-1.12.2-14.23.5.2860.jar"
        );
    }
}
