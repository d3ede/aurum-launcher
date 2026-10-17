use super::{proxy, HostingIcon, HostingProfile};
use crate::{Engine, Task};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingInstall {
    pub name: String,
    pub core: String,
    pub version: String,
    pub accept_eula: bool,
    pub experimental: bool,
    pub ram_mb: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingVersion {
    pub version: String,
}
fn official_url(url: &str, hosts: &[&str]) -> Result<()> {
    let parsed = reqwest::Url::parse(url)?;
    if parsed.scheme() != "https" || !parsed.host_str().is_some_and(|host| hosts.contains(&host)) {
        bail!("Неожиданный адрес загрузки ядра")
    }
    Ok(())
}
fn supported(core: &str) -> Result<()> {
    if !["paper", "folia", "velocity", "vanilla", "purpur"].contains(&core) {
        bail!("Это ядро можно импортировать из подготовленной папки")
    }
    Ok(())
}
fn minecraft_java(version: &str) -> u32 {
    let parts: Vec<u32> = version
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect();
    match parts.as_slice() {
        [major, ..] if *major >= 26 => 25,
        [1, minor, ..] if *minor >= 21 => 21,
        [1, 20, patch, ..] if *patch >= 5 => 21,
        [1, minor, ..] if *minor >= 18 => 17,
        [1, 17, ..] => 16,
        [1, 16, patch, ..] if *patch >= 5 => 16,
        [1, minor, ..] if *minor >= 12 => 11,
        _ => 8,
    }
}
fn purpur_build(metadata: &serde_json::Value, version: &str) -> Result<(String, String)> {
    if metadata["project"] != "purpur"
        || metadata["version"] != version
        || metadata["result"] != "SUCCESS"
    {
        bail!("Успешная сборка Purpur не найдена")
    }
    let build = metadata["build"]
        .as_str()
        .context("Нет номера сборки Purpur")?;
    let checksum = metadata["md5"]
        .as_str()
        .context("Нет контрольной суммы Purpur")?;
    if build.is_empty()
        || !build.bytes().all(|value| value.is_ascii_digit())
        || checksum.len() != 32
        || !checksum.bytes().all(|value| value.is_ascii_hexdigit())
    {
        bail!("Неверные метаданные Purpur")
    }
    Ok((
        format!("https://api.purpurmc.org/v2/purpur/{version}/{build}/download"),
        checksum.into(),
    ))
}
impl Engine {
    pub async fn hosting_versions(&self, core: &str) -> Result<Vec<HostingVersion>> {
        supported(core)?;
        if core == "purpur" {
            let project = self.json("https://api.purpurmc.org/v2/purpur").await?;
            let mut versions: Vec<_> = project["versions"]
                .as_array()
                .context("Нет версий Purpur")?
                .iter()
                .filter_map(|value| {
                    value.as_str().map(|version| HostingVersion {
                        version: version.into(),
                    })
                })
                .collect();
            versions.reverse();
            return Ok(versions);
        }
        if core == "vanilla" {
            let manifest = self.minecraft_versions().await?;
            return Ok(manifest["versions"]
                .as_array()
                .context("Нет версий Mojang")?
                .iter()
                .filter(|version| {
                    version["type"] == "release"
                        && version["id"]
                            .as_str()
                            .is_some_and(|id| !id.starts_with("1.0"))
                })
                .filter_map(|version| {
                    version["id"].as_str().map(|version| HostingVersion {
                        version: version.into(),
                    })
                })
                .collect());
        }
        let project = self
            .json(&format!("https://fill.papermc.io/v3/projects/{core}"))
            .await?;
        let groups = project["versions"]
            .as_object()
            .context("Нет версий PaperMC")?;
        let mut versions: Vec<String> = groups
            .values()
            .flat_map(|group| group.as_array().into_iter().flatten())
            .filter_map(|version| version.as_str().map(str::to_owned))
            .collect();
        versions.sort_by_key(|version| {
            version
                .split(['.', '-'])
                .map(|part| part.parse::<u32>().unwrap_or(0))
                .collect::<Vec<_>>()
        });
        versions.reverse();
        versions.dedup();
        Ok(versions
            .into_iter()
            .map(|version| HostingVersion { version })
            .collect())
    }
    pub async fn hosting_install(
        &self,
        request: HostingInstall,
        task: &Task,
    ) -> Result<HostingProfile> {
        supported(&request.core)?;
        crate::store::validate_version(&request.version)?;
        if request.name.trim().is_empty()
            || request.name.len() > 120
            || !(512..=65536).contains(&request.ram_mb)
        {
            bail!("Проверьте название и RAM")
        }
        if !proxy(&request.core) && !request.accept_eula {
            bail!("Для установки нужно принять Minecraft EULA")
        }
        let (url, algorithm, checksum, java_major) = if request.core == "vanilla" {
            let manifest = self.minecraft_versions().await?;
            let version = manifest["versions"]
                .as_array()
                .context("Нет версий")?
                .iter()
                .find(|version| version["id"] == request.version)
                .context("Версия не найдена")?;
            let url = version["url"].as_str().context("Нет метаданных версии")?;
            official_url(url, &["piston-meta.mojang.com", "launchermeta.mojang.com"])?;
            let metadata = self.json(url).await?;
            let server = &metadata["downloads"]["server"];
            let url = server["url"]
                .as_str()
                .context("Для этой версии нет официального сервера")?
                .to_owned();
            official_url(&url, &["piston-data.mojang.com", "launcher.mojang.com"])?;
            (
                url,
                "sha1",
                server["sha1"]
                    .as_str()
                    .context("Нет SHA1 сервера")?
                    .to_owned(),
                metadata["javaVersion"]["majorVersion"]
                    .as_u64()
                    .unwrap_or(8) as u32,
            )
        } else if request.core == "purpur" {
            let metadata = self
                .json(&format!(
                    "https://api.purpurmc.org/v2/purpur/{}/latest",
                    request.version
                ))
                .await?;
            let (url, checksum) = purpur_build(&metadata, &request.version)?;
            official_url(&url, &["api.purpurmc.org"])?;
            (url, "md5", checksum, minecraft_java(&request.version))
        } else {
            let builds = self
                .json(&format!(
                    "https://fill.papermc.io/v3/projects/{}/versions/{}/builds",
                    request.core, request.version
                ))
                .await?;
            let build = builds
                .as_array()
                .context("Нет сборок PaperMC")?
                .iter()
                .filter(|build| request.experimental || build["channel"] == "STABLE")
                .max_by_key(|build| build["id"].as_u64().unwrap_or(0))
                .context(
                    "Стабильная сборка не найдена. Можно явно разрешить экспериментальные сборки",
                )?;
            let download = &build["downloads"]["server:default"];
            let url = download["url"]
                .as_str()
                .context("Нет ссылки на JAR")?
                .to_owned();
            official_url(&url, &["fill-data.papermc.io", "fill.papermc.io"])?;
            let java_major = if request.core == "velocity" {
                21
            } else {
                minecraft_java(&request.version)
            };
            (
                url,
                "sha256",
                download["checksums"]["sha256"]
                    .as_str()
                    .context("Нет SHA256 сервера")?
                    .to_owned(),
                java_major,
            )
        };
        task.check()?;
        let identifier = uuid::Uuid::new_v4().to_string();
        let base = self.root.join("hosting/servers");
        tokio::fs::create_dir_all(&base).await?;
        let staging = base.join(format!(".{identifier}.installing"));
        tokio::fs::create_dir(&staging).await?;
        let target = base.join(&identifier);
        let result: Result<HostingProfile> = async {
            task.progress("hosting-install", "Загружаем официальное ядро и проверяем контрольную сумму", 0, 0);
            self.download(&url, &staging.join("server.jar"), Some((algorithm, &checksum)), task).await?;
            let java_major = java_major.max(super::discovery::jar_major(&staging.join("server.jar")));
            if request.core == "velocity" {
                tokio::fs::write(staging.join("velocity.toml"), b"config-version = \"2.7\"\nbind = \"127.0.0.1:25577\"\nmotd = \"Aurum local proxy\"\nshow-max-players = 100\nonline-mode = true\nplayer-info-forwarding-mode = \"NONE\"\n[servers]\nlobby = \"127.0.0.1:25566\"\ntry = [\"lobby\"]\n").await?;
            } else {
                tokio::fs::write(staging.join("eula.txt"), b"# Minecraft EULA accepted explicitly in Aurum\neula=true\n").await?;
                tokio::fs::write(staging.join("server.properties"), b"server-ip=127.0.0.1\nserver-port=25565\nonline-mode=true\nmax-players=20\nmotd=Aurum local server\nenable-rcon=false\n").await?;
            }
            task.check()?;
            tokio::fs::rename(&staging, &target).await?;
            let profile = HostingProfile { id: identifier.clone(), name: request.name.trim().into(), description: String::new(), root: target.canonicalize()?, directory: ".".into(), entrypoint: "server.jar".into(), core: request.core, version: request.version, java_major, java_path: String::new(), ram_mb: request.ram_mb, jvm_args: String::new(), icon: HostingIcon::default(), launches: 0, last_started: None, network: None };
            let _guard = self.hosting.gate.lock().await;
            let mut profiles = self.hosting_profiles_unlocked().await?;
            if profiles.len() >= 100 { bail!("Можно добавить не более 100 серверов") }
            profiles.push(profile.clone()); self.hosting_save(&profiles).await?;
            Ok(profile)
        }.await;
        if result.is_err() {
            for directory in [&staging, &target] {
                if directory.exists() && directory.canonicalize()?.starts_with(base.canonicalize()?)
                {
                    let _ = tokio::fs::remove_dir_all(directory).await;
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn purpur_downloads_pin_successful_official_builds_and_validate_checksums() {
        let mut metadata = serde_json::json!({ "project": "purpur", "version": "1.21.11", "build": "2568", "result": "SUCCESS", "md5": "0123456789abcdef0123456789abcdef" });
        let (url, checksum) = purpur_build(&metadata, "1.21.11").unwrap();
        assert_eq!(
            url,
            "https://api.purpurmc.org/v2/purpur/1.21.11/2568/download"
        );
        assert_eq!(checksum.len(), 32);
        assert!(purpur_build(&metadata, "1.21.10").is_err());
        metadata["result"] = "FAILURE".into();
        assert!(purpur_build(&metadata, "1.21.11").is_err());
        metadata["result"] = "SUCCESS".into();
        metadata["build"] = "../latest".into();
        assert!(purpur_build(&metadata, "1.21.11").is_err());
        assert_eq!(minecraft_java("1.21.11"), 21);
        assert_eq!(minecraft_java("1.20.4"), 17);
        assert_eq!(minecraft_java("26.2"), 25);
    }
    #[test]
    fn only_allows_official_https_download_hosts() {
        assert!(official_url(
            "https://fill-data.papermc.io/v1/objects/file.jar",
            &["fill-data.papermc.io"]
        )
        .is_ok());
        assert!(official_url(
            "http://fill-data.papermc.io/file.jar",
            &["fill-data.papermc.io"]
        )
        .is_err());
        assert!(official_url(
            "https://fill-data.papermc.io.example.org/file.jar",
            &["fill-data.papermc.io"]
        )
        .is_err());
    }
    #[tokio::test]
    async fn installation_requires_explicit_eula_before_network_or_files() {
        let folder = tempfile::tempdir().unwrap();
        let engine = Engine::new(folder.path().into(), |_| {}).await.unwrap();
        let task = engine
            .task(uuid::Uuid::new_v4().to_string(), None)
            .await
            .unwrap();
        let result = engine
            .hosting_install(
                HostingInstall {
                    name: "Test".into(),
                    core: "paper".into(),
                    version: "1.21.11".into(),
                    accept_eula: false,
                    experimental: false,
                    ram_mb: 1024,
                },
                &task,
            )
            .await;
        assert!(result.unwrap_err().to_string().contains("EULA"));
        assert!(!folder.path().join("hosting/servers").exists());
    }
}
