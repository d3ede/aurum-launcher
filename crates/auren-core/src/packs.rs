use crate::{model::*, Engine, Task};
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{io::Read, path::Path};

fn bundled_pack_icon(zip: &mut zip::ZipArchive<std::fs::File>) -> Option<String> {
    for name in [
        "icon.png",
        "modpack.png",
        "overrides/icon.png",
        "client-overrides/icon.png",
    ] {
        let Ok(mut file) = zip.by_name(name) else {
            continue;
        };
        if file.size() > 2_000_000
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            continue;
        }
        let mut bytes = Vec::new();
        if (&mut file).take(2_000_001).read_to_end(&mut bytes).is_ok() && bytes.len() <= 2_000_000 {
            if let Ok(icon) = crate::store::prepare_profile_icon_bytes(&bytes) {
                return Some(icon);
            }
        }
    }
    None
}

pub(crate) type DownloadHashCache =
    std::collections::HashMap<(std::path::PathBuf, String), (u64, std::time::SystemTime, String)>;

async fn read_pack_icon(response: reqwest::Response) -> Option<String> {
    use futures_util::StreamExt;
    let response = response.error_for_status().ok()?;
    if response
        .content_length()
        .is_some_and(|size| size > 2_000_000)
    {
        return None;
    }
    // Some CDNs stream without Content-Length. Bound the actual body as well.
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.ok()?;
        if bytes.len() + chunk.len() > 2_000_000 {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    crate::store::prepare_profile_icon_bytes(&bytes).ok()
}

async fn pack_cf<F, Fut>(
    cf: &mut F,
    path: &str,
    task: &Task,
    pack_name: &str,
    done: u64,
    total: u64,
) -> Result<Value>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<Value>>,
{
    for attempt in 0..=3 {
        task.check()?;
        let result = cf(path.to_owned()).await;
        let delay = match &result {
            Err(error) if attempt < 3 => error
                .downcast_ref::<crate::aurum_api::CurseForgeRateLimited>()
                .map(|error| error.retry_after),
            _ => None,
        };
        let Some(delay) = delay else { return result };
        task.pack_progress(
            pack_name,
            "CurseForge ограничил частоту запросов. Ожидаем и продолжим автоматически.",
            done,
            total,
        );
        let deadline = tokio::time::Instant::now() + delay;
        while tokio::time::Instant::now() < deadline {
            task.check()?;
            tokio::time::sleep_until(
                deadline.min(tokio::time::Instant::now() + std::time::Duration::from_millis(100)),
            )
            .await;
        }
    }
    unreachable!()
}

fn manual_hash(file: &PackManualDownload) -> (&str, &str) {
    file.sha256
        .as_deref()
        .map(|hash| ("sha256", hash))
        .unwrap_or(("sha1", &file.sha1))
}

// Used only when the provider cannot identify a ZIP's project type.
fn archive_content_folder(path: &Path) -> Option<&'static str> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).ok()?).ok()?;
    let mut resources = false;
    let mut shaders = false;
    for index in 0..zip.len() {
        let file = zip.by_index(index).ok()?;
        let name = file.name().ok()?;
        if matches!(
            name.as_ref(),
            "fabric.mod.json"
                | "quilt.mod.json"
                | "META-INF/mods.toml"
                | "META-INF/neoforge.mods.toml"
        ) {
            return None;
        }
        resources |= name == "pack.mcmeta";
        shaders |= name.starts_with("shaders/");
    }
    if shaders {
        Some("shaderpacks")
    } else if resources {
        Some("resourcepacks")
    } else {
        None
    }
}

fn download_name_matches(actual: &str, expected: &str) -> bool {
    if actual == expected {
        return true;
    }
    let Some((stem, extension)) = expected.rsplit_once('.') else {
        return false;
    };
    actual
        .strip_prefix(stem)
        .and_then(|s| s.strip_prefix(" ("))
        .and_then(|s| s.strip_suffix(&format!(").{extension}")))
        .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

fn loader(deps: &Value) -> Result<(Loader, Option<String>)> {
    for (key, l) in [
        ("fabric-loader", Loader::Fabric),
        ("forge", Loader::Forge),
        ("neoforge", Loader::Neoforge),
        ("quilt-loader", Loader::Quilt),
    ] {
        if let Some(v) = deps[key].as_str() {
            crate::store::validate_version(v)?;
            return Ok((l, Some(v.into())));
        }
    }
    Ok((Loader::Vanilla, None))
}

fn launcher_managed_path(path: &str) -> bool {
    matches!(
        path.split('/')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        ".aurum" | "launch.json" | "launch.json.tmp" | "client" | "natives"
    )
}

fn validate_pack_path(path: &str) -> Result<()> {
    crate::safe_join(Path::new("pack"), path)?;
    // Mods choose their own game-directory names. Protect only launcher-owned
    // runtime files; confinement and ZIP link checks apply to every other path.
    if launcher_managed_path(path) {
        bail!("Пакет пытается изменить служебные файлы лаунчера: {path}");
    }
    Ok(())
}

fn check_pack_overrides(
    zip: &mut zip::ZipArchive<std::fs::File>,
    prefixes: &[String],
    task: &Task,
) -> Result<()> {
    let mut total = 0u64;
    for prefix in prefixes {
        for index in 0..zip.len() {
            task.check()?;
            let file = zip.by_index(index)?;
            let name = file.name()?;
            let Some(relative) = name.strip_prefix(prefix) else {
                continue;
            };
            if relative.is_empty() || file.is_dir() {
                continue;
            }
            validate_pack_path(relative)?;
            total = total
                .checked_add(file.size())
                .context("Слишком большой архив")?;
            if total > 1_000_000_000 {
                bail!("Слишком большой архив");
            }
            if file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                bail!("Архив содержит символическую ссылку");
            }
        }
    }
    Ok(())
}

impl Engine {
    /// Optional artwork must never prevent a pack from being installed.
    pub(crate) async fn download_pack_icon(&self, url: &str) -> Option<String> {
        let parsed = reqwest::Url::parse(url).ok()?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return None;
        }
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            read_pack_icon(self.http.get(url).send().await.ok()?).await
        })
        .await
        .ok()
        .flatten()
    }

    pub async fn import_pack(&self, path: &Path, task: &Task) -> Result<String> {
        self.import_pack_with(path, task, |path| async move { self.cf(&path).await })
            .await
    }

    async fn import_pack_with<F, Fut>(&self, path: &Path, task: &Task, cf: F) -> Result<String>
    where
        F: FnMut(String) -> Fut,
        Fut: std::future::Future<Output = Result<Value>>,
    {
        self.import_pack_with_icon(path, task, None, cf).await
    }

    async fn import_pack_with_icon<F, Fut>(
        &self,
        path: &Path,
        task: &Task,
        icon: Option<String>,
        mut cf: F,
    ) -> Result<String>
    where
        F: FnMut(String) -> Fut,
        Fut: std::future::Future<Output = Result<Value>>,
    {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?)?;
        let mr = zip.by_name("modrinth.index.json").is_ok();
        let manifest: Value = {
            let mut file = zip
                .by_name(if mr {
                    "modrinth.index.json"
                } else {
                    "manifest.json"
                })
                .context("Поддерживаются .mrpack и CurseForge ZIP с manifest.json")?;
            if file.size() > 2_000_000 {
                bail!("Слишком большой манифест")
            }
            let mut bytes = vec![];
            file.read_to_end(&mut bytes)?;
            serde_json::from_slice(&bytes)?
        };
        if mr && (manifest["formatVersion"] != 1 || manifest["game"] != "minecraft") {
            bail!("Неподдерживаемый формат mrpack")
        }
        let mc = if mr {
            manifest["dependencies"]["minecraft"].as_str()
        } else {
            manifest["minecraft"]["version"].as_str()
        }
        .context("Нет версии Minecraft")?
        .to_string();
        crate::store::validate_version(&mc)?;
        let (loader, lv) = if mr {
            loader(&manifest["dependencies"])?
        } else {
            let selected = manifest["minecraft"]["modLoaders"]
                .as_array()
                .and_then(|a| a.iter().find(|l| l["primary"] == true).or(a.first()));
            if let Some(l) = selected {
                let id = l["id"].as_str().context("Нет загрузчика")?;
                let (kind, version) = id
                    .split_once('-')
                    .context("Неверный загрузчик CurseForge")?;
                let mut deps = serde_json::Map::new();
                deps.insert(
                    match kind {
                        "fabric" => "fabric-loader",
                        "quilt" => "quilt-loader",
                        "forge" => "forge",
                        "neoforge" => "neoforge",
                        _ => bail!("Неподдерживаемый загрузчик"),
                    }
                    .into(),
                    Value::String(version.into()),
                );
                loader(&Value::Object(deps))?
            } else {
                (Loader::Vanilla, None)
            }
        };
        let name = manifest["name"]
            .as_str()
            .unwrap_or("Импортированная сборка")
            .to_string();
        crate::store::validate_name(&name)?;
        let overrides = if mr {
            vec!["overrides/".to_string(), "client-overrides/".to_string()]
        } else {
            vec![format!(
                "{}/",
                manifest["overrides"]
                    .as_str()
                    .unwrap_or("overrides")
                    .trim_end_matches('/')
            )]
        };
        // Reject unsupported or unsafe bundled paths before spending time on downloads.
        check_pack_overrides(&mut zip, &overrides, task)?;
        if mr {
            for file in manifest["files"].as_array().context("Нет списка файлов")? {
                task.check()?;
                if file["env"]["client"] != "unsupported" {
                    validate_pack_path(file["path"].as_str().context("Нет пути файла")?)?;
                }
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let stage = self.root.join("staging").join(&task.id).join("pack");
        tokio::fs::create_dir_all(&stage).await?;
        let pack_name = name.clone();
        let result:Result<()>=async {
            let mut manual_downloads = vec![];
            if mr {
                let files=manifest["files"].as_array().context("Нет списка файлов")?;
                for (i,file) in files.iter().enumerate() {
                    task.check()?; if file["env"]["client"]=="unsupported" {continue}
                    let file_path=file["path"].as_str().context("Нет пути файла")?;validate_pack_path(file_path)?;
                    let downloads=file["downloads"].as_array().context("Нет адресов загрузки")?;
                    let hash=file["hashes"]["sha1"].as_str().context("Нет SHA1 файла")?;
                    let mut downloaded=false;
                    for url in downloads {
                        let url=url.as_str().context("Неверный URL")?;
                        let parsed=reqwest::Url::parse(url)?;
                        if parsed.scheme()!="https" || !["cdn.modrinth.com","edge.forgecdn.net","mediafilez.forgecdn.net","github.com","raw.githubusercontent.com"].contains(&parsed.host_str().unwrap_or("")) {
                            bail!("Домен загрузки пакета не разрешён: {}",parsed.host_str().unwrap_or(""))
                        }
                        if self.download(url,&crate::safe_join(&stage,file_path)?,Some(("sha1",hash)),task).await.is_ok() {downloaded=true;break}
                    }
                    if !downloaded {task.check()?;bail!("Не удалось загрузить {file_path}")}
                    task.pack_progress(&pack_name,format!("Файлы пакета · {file_path}"),i as u64+1,files.len() as u64);
                }
            } else {
                let files=manifest["files"].as_array().context("Нет файлов CurseForge")?;
                let mut projects = std::collections::HashMap::new();
                for (i,file) in files.iter().enumerate() {
                    task.check()?;
                    let project=file["projectID"].as_u64().context("Нет projectID")?;
                    let version=file["fileID"].as_u64().context("Нет fileID")?;
                    let raw=pack_cf(&mut cf,&format!("/mods/{project}/files/{version}"),task,&pack_name,i as u64,files.len() as u64).await?;
                    if let std::collections::hash_map::Entry::Vacant(entry) = projects.entry(project) {
                        entry.insert(pack_cf(&mut cf,&format!("/mods/{project}"),task,&pack_name,i as u64,files.len() as u64).await.ok());
                    }
                    let info = projects.get(&project).and_then(Option::as_ref);
                    let folder = match info.and_then(|i| i["data"]["classId"].as_u64()) {
                        Some(12) => Some("resourcepacks"),
                        Some(6552) => Some("shaderpacks"),
                        Some(6) => Some("mods"),
                        _ => None,
                    };
                    if let Some(mut missing) = self.import_curseforge_file(&stage, project, version, &raw["data"], folder, task).await? {
                        // Project metadata improves the label and links to the exact file version.
                        // A failed optional lookup must not discard the rest of the pack.
                        if let Some(info) = info {
                            if let Some(name) = info["data"]["name"].as_str() { missing.name = name.into(); }
                            if let Some(slug) = info["data"]["slug"].as_str().filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')) {
                                missing.url = format!("https://www.curseforge.com/minecraft/mc-mods/{slug}/files/{version}");
                            }
                            if let Some(page) = info["data"]["links"]["websiteUrl"].as_str()
                                .and_then(|s| reqwest::Url::parse(s).ok())
                                .filter(|u| u.scheme() == "https" && matches!(u.host_str(), Some("www.curseforge.com" | "curseforge.com")) && u.query().is_none() && u.fragment().is_none()) {
                                missing.url = format!("{}/files/{version}",page.as_str().trim_end_matches('/'));
                            }
                        }
                        manual_downloads.push(missing);
                    }
                    task.pack_progress(&pack_name,"Файлы CurseForge",i as u64+1,files.len() as u64);
                }
            }
            let mut total=0u64;
            for prefix in overrides { for i in 0..zip.len() {task.check()?;let mut f=zip.by_index(i)?;let name=f.name()?.into_owned();let Some(relative)=name.strip_prefix(&prefix)else{continue};if relative.is_empty() || f.is_dir(){continue}validate_pack_path(relative)?;total+=f.size();if total>1_000_000_000{bail!("Слишком большой архив")};if f.unix_mode().is_some_and(|m|m&0o170000==0o120000){bail!("Архив содержит символическую ссылку")};let path=crate::safe_join(&stage,relative)?;std::fs::create_dir_all(path.parent().unwrap())?;std::io::copy(&mut f,&mut std::fs::File::create(path)?)?; } }
            // Some packs bundle a restricted file in their overrides already.
            let mut remaining = vec![];
            for file in manual_downloads {
                task.check()?;
                let path = crate::safe_join(&stage, &file.path)?;
                if !path.exists() || !crate::net::verify(&path, Some(("sha1", &file.sha1))).await? {
                    remaining.push(file);
                }
            }
            let manual_downloads = remaining;
            task.check()?;
            let icon = icon.or_else(|| bundled_pack_icon(&mut zip));
            let p=Profile{engine:crate::model::Runtime::Java,id:id.clone(),name,minecraft:mc,loader,loader_version:lv,installed_version:None,ram_mb:None,jvm_args:String::new(),last_played:None,cover:0,icon,icon_style:None,manual_downloads,content:vec![]};
            self.publish_profile(p, Some(&stage)).await
        }.await;
        let _ = tokio::fs::remove_dir_all(self.root.join("staging").join(&task.id)).await;
        result?;
        Ok(id)
    }

    async fn import_curseforge_file(
        &self,
        stage: &Path,
        project: u64,
        version: u64,
        file: &Value,
        folder: Option<&str>,
        task: &Task,
    ) -> Result<Option<PackManualDownload>> {
        task.check()?;
        if file["modId"].as_u64() != Some(project) || file["id"].as_u64() != Some(version) {
            bail!("Файл относится к другому проекту")
        }
        let name = file["fileName"].as_str().context("Нет имени файла")?;
        if name.contains('/') {
            bail!("Неверное имя файла")
        }
        let path = format!("{}/{name}", folder.unwrap_or("mods"));
        let dest = crate::safe_join(stage, &path)?;
        let hash = file["hashes"]
            .as_array()
            .and_then(|a| a.iter().find(|h| h["algo"] == 1))
            .and_then(|h| h["value"].as_str())
            .context("Нет SHA1")?;
        let url = file["downloadUrl"]
            .as_str()
            .filter(|s| !s.trim().is_empty());
        let reason = if let Some(url) = url {
            if self
                .download(url, &dest, Some(("sha1", hash)), task)
                .await
                .is_ok()
            {
                if folder.is_none() && name.ends_with(".zip") {
                    if let Some(folder) = archive_content_folder(&dest) {
                        let target = crate::safe_join(stage, &format!("{folder}/{name}"))?;
                        tokio::fs::create_dir_all(target.parent().unwrap()).await?;
                        tokio::fs::rename(&dest, target).await?;
                    }
                }
                return Ok(None);
            }
            task.check()?;
            "download"
        } else {
            "restricted"
        };
        Ok(Some(PackManualDownload {
            name: name.into(),
            path,
            url: format!("https://www.curseforge.com/projects/{project}/files/{version}"),
            sha1: hash.into(),
            sha256: None,
            reason: reason.into(),
        }))
    }

    pub async fn import_pack_manual_file(
        &self,
        id: &str,
        file_path: &str,
        source: &Path,
    ) -> Result<()> {
        self.import_pack_manual_file_with_cleanup(id, file_path, source, false)
            .await
    }

    pub async fn import_pack_manual_file_with_cleanup(
        &self,
        id: &str,
        file_path: &str,
        source: &Path,
        remove_source: bool,
    ) -> Result<()> {
        let _guard = self
            .busy
            .try_lock()
            .map_err(|_| anyhow::anyhow!("Дождитесь завершения текущей операции"))?;
        self.ensure_idle(id).await?;
        let profile = self.profile(id).await?;
        let missing = profile
            .manual_downloads
            .iter()
            .find(|f| f.path == file_path)
            .context("Файл не найден в списке ручной установки")?;
        validate_pack_path(&missing.path)?;
        let stage = self
            .root
            .join("staging")
            .join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&stage).await?;
        let result: Result<()> = async {
            let temp = stage.join("manual-file");
            tokio::fs::copy(source, &temp).await?;
            if !crate::net::verify(&temp, Some(manual_hash(missing))).await? {
                bail!("Выбран другой файл. Скачайте указанную версию мода")
            }
            let mut destination = missing.path.clone();
            if let Some(name) = missing
                .path
                .strip_prefix("mods/")
                .filter(|name| name.ends_with(".zip") && missing.sha256.is_none())
            {
                if let Some(folder) = archive_content_folder(&temp) {
                    destination = format!("{folder}/{name}");
                }
            }
            let dest = crate::safe_join(&self.instance(id)?, &destination)?;
            tokio::fs::create_dir_all(dest.parent().unwrap()).await?;
            tokio::fs::rename(&temp, &dest).await?;
            let mut db = self.db.lock().await;
            let mut next = db.clone();
            let profile = next
                .profiles
                .iter_mut()
                .find(|p| p.id == id)
                .context("Сборка не найдена")?;
            profile.manual_downloads.retain(|f| f.path != file_path);
            crate::store::persist(&self.root, &next).await?;
            *db = next;
            drop(db);
            if remove_source {
                // Cross-volume moves publish a verified copy first. Never delete
                // a file selected from the instance itself or a changed source.
                match tokio::fs::canonicalize(source).await {
                    Ok(original) if original != tokio::fs::canonicalize(&dest).await? => {
                        if !crate::net::verify(source, Some(manual_hash(missing))).await? {
                            bail!("Файл установлен, но оригинал изменился и сохранён");
                        }
                        tokio::fs::remove_file(source).await.context(
                            "Файл установлен, но не удалось удалить оригинал из папки загрузки",
                        )?;
                    }
                    Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                        return Err(error.into())
                    }
                    _ => {}
                }
            }
            Ok(())
        }
        .await;
        let _ = tokio::fs::remove_dir_all(&stage).await;
        result
    }

    async fn cached_download_matches(
        &self,
        source: &Path,
        missing: &PackManualDownload,
    ) -> Result<bool> {
        let metadata = tokio::fs::metadata(source).await?;
        let (algorithm, expected) = manual_hash(missing);
        let Ok(modified) = metadata.modified() else {
            return crate::net::verify(source, Some((algorithm, expected))).await;
        };
        let key = (source.to_path_buf(), algorithm.to_owned());
        if let Some((length, time, hash)) = self.pack_download_hashes.lock().await.get(&key) {
            if *length == metadata.len() && *time == modified {
                return Ok(hash.eq_ignore_ascii_case(expected));
            }
        }
        let hash = crate::net::file_hash(source, algorithm).await?;
        let matches = hash.eq_ignore_ascii_case(expected);
        let mut cache = self.pack_download_hashes.lock().await;
        if cache.len() >= 2048 {
            cache.clear();
        }
        cache.insert(key, (metadata.len(), modified, hash));
        Ok(matches)
    }

    /// Inspect completed files by checksum, including browser-renamed archives.
    /// The copied bytes are verified again before publication and source cleanup.
    pub async fn scan_pack_downloads(
        &self,
        id: &str,
        downloads: &Path,
        remove_imported: bool,
    ) -> Result<usize> {
        let profile = self.profile(id).await?;
        if profile.manual_downloads.is_empty() {
            return Ok(0);
        }
        let instance = self.instance(id)?;
        let mut folders = vec![downloads.to_path_buf()];
        for missing in &profile.manual_downloads {
            let destination = crate::safe_join(&instance, &missing.path)?;
            if let Some(parent) = destination.parent() {
                if !folders.iter().any(|folder| folder == parent) {
                    folders.push(parent.to_path_buf());
                }
            }
        }
        let mut candidates = vec![];
        for folder in folders {
            let mut entries = match tokio::fs::read_dir(&folder).await {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            while let Some(entry) = entries.next_entry().await? {
                if entry.file_type().await?.is_file() {
                    candidates.push(entry.path());
                }
            }
        }
        let mut imported = 0;
        for missing in profile.manual_downloads {
            let expected = missing.path.rsplit('/').next().context("Нет имени файла")?;
            let expected_extension = Path::new(expected).extension();
            candidates.sort_by_key(|source| {
                !source
                    .file_name()
                    .and_then(|s| s.to_str())
                    .is_some_and(|name| download_name_matches(name, expected))
            });
            for source in &candidates {
                let matching_extension = match (source.extension(), expected_extension) {
                    (Some(actual), Some(expected)) => actual.eq_ignore_ascii_case(expected),
                    (None, None) => true,
                    _ => false,
                };
                if !matching_extension {
                    continue;
                }
                if !self
                    .cached_download_matches(source, &missing)
                    .await
                    .unwrap_or(false)
                {
                    continue;
                }
                self.import_pack_manual_file_with_cleanup(
                    id,
                    &missing.path,
                    source,
                    remove_imported && !source.starts_with(&instance),
                )
                .await?;
                imported += 1;
                break;
            }
        }
        Ok(imported)
    }
    pub async fn download_pack(
        &self,
        source: &str,
        project: &str,
        version: &str,
        task: &Task,
    ) -> Result<String> {
        crate::store::validate_version(project)?;
        crate::store::validate_version(version)?;
        if crate::pack_catalog::is_pack_source(source) {
            return self
                .download_platform_pack(source, project, version, task)
                .await;
        }
        let (url, hash) = if source == "modrinth" {
            let raw = self
                .json(&format!("{}/version/{version}", crate::catalog::MODRINTH))
                .await?;
            if raw["project_id"] != project {
                bail!("Версия относится к другому проекту")
            };
            let f = raw["files"]
                .as_array()
                .and_then(|a| a.iter().find(|f| f["primary"] == true).or(a.first()))
                .context("Нет файла пакета")?;
            (
                f["url"].as_str().context("Нет URL")?.to_string(),
                f["hashes"]["sha1"]
                    .as_str()
                    .context("Нет SHA1")?
                    .to_string(),
            )
        } else if source == "curseforge" {
            let raw = pack_cf(
                &mut |path: String| async move { self.cf(&path).await },
                &format!("/mods/{project}/files/{version}"),
                task,
                "CurseForge",
                0,
                0,
            )
            .await?;
            let f = &raw["data"];
            (
                f["downloadUrl"]
                    .as_str()
                    .context("Автор запретил загрузку через сторонние приложения")?
                    .to_string(),
                f["hashes"]
                    .as_array()
                    .and_then(|a| a.iter().find(|h| h["algo"] == 1))
                    .and_then(|h| h["value"].as_str())
                    .context("Нет SHA1")?
                    .to_string(),
            )
        } else {
            bail!("Неизвестный источник")
        };
        let path = self.root.join("downloads").join(format!("{}.zip", task.id));
        self.download(&url, &path, Some(("sha1", &hash)), task)
            .await?;
        // Archive manifests do not contain the project's catalog artwork.
        let metadata = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            if source == "modrinth" {
                self.json(&format!("{}/project/{project}", crate::catalog::MODRINTH))
                    .await
            } else {
                self.cf(&format!("/mods/{project}")).await
            }
        })
        .await;
        let icon_url = metadata.ok().and_then(Result::ok).and_then(|raw| {
            if source == "modrinth" {
                raw["icon_url"].as_str()
            } else {
                raw["data"]["logo"]["thumbnailUrl"]
                    .as_str()
                    .or_else(|| raw["data"]["logo"]["url"].as_str())
            }
            .map(str::to_owned)
        });
        let icon = match icon_url {
            Some(url) => self.download_pack_icon(&url).await,
            None => None,
        };
        task.check()?;
        self.import_pack_with_icon(
            &path,
            task,
            icon,
            |path| async move { self.cf(&path).await },
        )
        .await
    }
    pub async fn import_folder(
        &self,
        path: &Path,
        name: String,
        mc: String,
        loader: Loader,
        lv: Option<String>,
        task: &Task,
    ) -> Result<String> {
        Ok(self
            .import_folder_with_cleanup(path, name, mc, loader, lv, false, task)
            .await?
            .id)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn import_folder_with_cleanup(
        &self,
        path: &Path,
        name: String,
        mc: String,
        loader: Loader,
        lv: Option<String>,
        remove_source: bool,
        task: &Task,
    ) -> Result<FolderImportResult> {
        crate::store::validate_name(&name)?;
        crate::store::validate_version(&mc)?;
        if loader != Loader::Vanilla {
            crate::store::validate_version(lv.as_deref().context("Нет загрузчика")?)?
        }
        let source = std::fs::canonicalize(path)?;
        let root = std::fs::canonicalize(&self.root)?;
        if source.starts_with(&root) || root.starts_with(&source) {
            bail!("Выберите внешнюю папку игры")
        }
        let snapshot = if remove_source {
            let source = path.to_path_buf();
            Some(
                tokio::task::spawn_blocking(move || {
                    crate::import_cleanup::ImportSnapshot::capture(&source)
                })
                .await??,
            )
        } else {
            None
        };
        let id = uuid::Uuid::new_v4().to_string();
        let stage = self.root.join("staging").join(&task.id).join("folder");
        tokio::fs::create_dir_all(&stage).await?;
        let result: Result<()> = async {
            let kinds: Vec<std::ffi::OsString> = std::fs::read_dir(&source)?
                .map(|entry| entry.map(|entry| entry.file_name()))
                .collect::<std::io::Result<Vec<_>>>()?
                .into_iter()
                // Disposal requires a verified copy of every original file.
                // Ordinary imports regenerate the launcher's runtime files.
                .filter(|name| remove_source || !launcher_managed_path(&name.to_string_lossy()))
                .collect();
            for kind in kinds {
                let source = source.join(kind);
                if !source.exists() {
                    continue;
                }
                for entry in walkdir::WalkDir::new(&source).follow_links(false) {
                    task.check()?;
                    let entry = entry?;
                    if entry.file_type().is_symlink() {
                        bail!("Папка содержит символические ссылки")
                    };
                    let relative = entry
                        .path()
                        .strip_prefix(path)
                        .or_else(|_| entry.path().strip_prefix(source.parent().unwrap()))?;
                    let dest = stage.join(relative);
                    if entry.file_type().is_dir() {
                        tokio::fs::create_dir_all(dest).await?
                    } else {
                        tokio::fs::create_dir_all(dest.parent().unwrap()).await?;
                        tokio::fs::copy(entry.path(), dest).await?;
                        task.progress("import", entry.file_name().to_string_lossy(), 0, 0)
                    }
                }
            }
            task.check()?;
            let p = Profile {
                engine: crate::model::Runtime::Java,
                icon: None,
                icon_style: None,
                id: id.clone(),
                name,
                minecraft: mc,
                loader,
                loader_version: lv,
                installed_version: None,
                ram_mb: None,
                jvm_args: String::new(),
                last_played: None,
                cover: 1,
                manual_downloads: vec![],
                content: vec![],
            };
            self.publish_profile(p, Some(&stage)).await
        }
        .await;
        let _ = tokio::fs::remove_dir_all(self.root.join("staging").join(&task.id)).await;
        result?;
        let mut response = FolderImportResult {
            id: id.clone(),
            source_removed: false,
            warning: None,
        };
        if let Some(snapshot) = snapshot {
            if task.check().is_ok() {
                let destination = self.instance(&id)?;
                let cancel = task.cancel.clone();
                match tokio::task::spawn_blocking(move || {
                    snapshot.recycle(&destination, |_| false, &cancel)
                })
                .await?
                {
                    Ok(()) => response.source_removed = true,
                    Err(error) => response.warning = Some(format!("{error:#}")),
                }
            } else {
                response.warning = Some("Удаление оригинала отменено; обе копии сохранены".into());
            }
        }
        Ok(response)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderImportResult {
    pub id: String,
    pub source_removed: bool,
    pub warning: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sha1::{Digest, Sha1};
    use std::{
        io::Write,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
    };

    fn fixture() -> (tempfile::TempDir, Task) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/pack-manual-tests");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let task = Task {
            id: uuid::Uuid::new_v4().to_string(),
            profile_id: None,
            cancel: Arc::new(AtomicBool::new(false)),
            emit: Arc::new(|_| {}),
        };
        (dir, task)
    }

    fn archive(path: &Path) {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(
            json!({"name":"Manual pack", "minecraft":{"version":"1.21.1"},
            "files":[{"projectID":1,"fileID":11},{"projectID":2,"fileID":22},
                {"projectID":3,"fileID":33},{"projectID":4,"fileID":44}]})
            .to_string()
            .as_bytes(),
        )
        .unwrap();
        zip.start_file("overrides/config/test.txt", options)
            .unwrap();
        zip.write_all(b"pack settings").unwrap();
        zip.finish().unwrap();
    }

    async fn metadata(path: String) -> Result<Value> {
        if path == "/mods/1" {
            return Ok(json!({"data":{"name":"Restricted Mod","slug":"unused-slug",
                "links":{"websiteUrl":"https://www.curseforge.com/minecraft/mc-mods/restricted-mod"}}}));
        }
        if path == "/mods/3" {
            bail!("Optional project lookup unavailable")
        }
        let project: u64 = path.split('/').nth(2).unwrap().parse().unwrap();
        let url = if project == 1 {
            Value::Null
        } else {
            json!("http://127.0.0.1/not-requested")
        };
        Ok(
            json!({"data":{"id":project*11,"modId":project,"fileName":format!("mod-{project}.jar"),
            "downloadUrl":url,"hashes":[{"algo":1,"value":format!("{:x}",Sha1::digest(b"correct mod"))}]}}),
        )
    }

    async fn prepare(engine: &Engine, task: &Task) {
        let mods = engine.root.join("staging").join(&task.id).join("pack/mods");
        tokio::fs::create_dir_all(&mods).await.unwrap();
        for project in [2, 4] {
            tokio::fs::write(mods.join(format!("mod-{project}.jar")), b"correct mod")
                .await
                .unwrap();
        }
    }

    fn artwork(color: [u8; 4]) -> Vec<u8> {
        let image = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            32,
            32,
            image::Rgba(color),
        ));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        bytes.into_inner()
    }

    #[tokio::test]
    async fn pack_artwork_is_published_and_survives_restart() {
        for mr in [true, false] {
            for catalog_icon in [false, true] {
                let (dir, task) = fixture();
                let root = dir.path().join("data");
                let engine = Engine::new(root.clone(), |_| {}).await.unwrap();
                let path = dir.path().join("artwork.zip");
                let bundled = artwork([200, 60, 40, 255]);
                let catalog = artwork([30, 180, 80, 255]);
                let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
                let options = zip::write::SimpleFileOptions::default();
                zip.start_file(
                    if mr {
                        "modrinth.index.json"
                    } else {
                        "manifest.json"
                    },
                    options,
                )
                .unwrap();
                let manifest = if mr {
                    json!({"formatVersion":1,"game":"minecraft","name":"Art pack","dependencies":{"minecraft":"1.21.1"},"files":[]})
                } else {
                    json!({"name":"Art pack","minecraft":{"version":"1.21.1"},"files":[]})
                };
                zip.write_all(manifest.to_string().as_bytes()).unwrap();
                zip.start_file("icon.png", options).unwrap();
                zip.write_all(&bundled).unwrap();
                zip.finish().unwrap();
                let provided = catalog_icon
                    .then(|| crate::store::prepare_profile_icon_bytes(&catalog).unwrap());
                let expected = provided
                    .clone()
                    .unwrap_or_else(|| crate::store::prepare_profile_icon_bytes(&bundled).unwrap());
                let id = engine
                    .import_pack_with_icon(&path, &task, provided, |_| async {
                        bail!("No CF files expected")
                    })
                    .await
                    .unwrap();
                assert_eq!(
                    engine.profile(&id).await.unwrap().icon.as_deref(),
                    Some(expected.as_str())
                );
                drop(engine);
                let reopened = Engine::new(root, |_| {}).await.unwrap();
                assert_eq!(
                    reopened.profile(&id).await.unwrap().icon.as_deref(),
                    Some(expected.as_str())
                );
            }
        }
    }

    #[tokio::test]
    async fn streamed_pack_artwork_is_bounded_and_validated() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let valid = artwork([40, 80, 200, 255]);
        for (body, status, accepted) in [
            (valid.clone(), "200 OK", true),
            (b"not an image".to_vec(), "200 OK", false),
            (vec![0; 2_000_001], "200 OK", false),
            (valid, "404 Not Found", false),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 4096];
                let _ = socket.read(&mut request).await;
                let header = format!("HTTP/1.1 {status}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n", body.len());
                if socket.write_all(header.as_bytes()).await.is_ok()
                    && socket.write_all(&body).await.is_ok()
                {
                    let _ = socket.write_all(b"\r\n0\r\n\r\n").await;
                }
            });
            let response = reqwest::Client::new()
                .get(format!("http://{address}/icon"))
                .send()
                .await
                .unwrap();
            let icon = read_pack_icon(response).await;
            assert_eq!(icon.is_some(), accepted);
            if let Some(icon) = icon {
                crate::store::validate_profile_icon(&icon).unwrap();
            }
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn custom_mod_data_survives_curseforge_modrinth_and_folder_imports() {
        let (dir, task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let datapack = "datapacks/datapacks/CWRecipeChanges/pack.mcmeta";
        let custom_files = [
            "fancymenu_data/buddy/buddy_leveling.json",
            "patchouli_books/guide/book.json",
            "custom_mod_folder/nested/file.bin",
            "custom-root-settings.json",
        ];
        for mr in [false, true] {
            let path = dir.path().join(if mr { "data.mrpack" } else { "data.zip" });
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file(
                if mr {
                    "modrinth.index.json"
                } else {
                    "manifest.json"
                },
                options,
            )
            .unwrap();
            let manifest = if mr {
                json!({"formatVersion":1,"game":"minecraft","name":"Datapack mrpack",
                    "dependencies":{"minecraft":"1.21.1"},"files":[]})
            } else {
                json!({"name":"Datapack CurseForge","minecraft":{"version":"1.21.1"},
                    "overrides":"bundled","files":[]})
            };
            zip.write_all(manifest.to_string().as_bytes()).unwrap();
            for prefix in if mr {
                vec!["overrides", "client-overrides"]
            } else {
                vec!["bundled"]
            } {
                zip.start_file(format!("{prefix}/{datapack}"), options)
                    .unwrap();
                zip.write_all(br#"{"pack":{"pack_format":48,"description":"Recipes"}}"#)
                    .unwrap();
                for file in custom_files {
                    zip.start_file(format!("{prefix}/{file}"), options).unwrap();
                    zip.write_all(b"custom mod data").unwrap();
                }
            }
            zip.finish().unwrap();
            let id = engine.import_pack(&path, &task).await.unwrap();
            let game = engine.instance(&id).unwrap();
            assert_eq!(
                std::fs::read(game.join(datapack)).unwrap(),
                br#"{"pack":{"pack_format":48,"description":"Recipes"}}"#
            );
            for file in custom_files {
                assert_eq!(std::fs::read(game.join(file)).unwrap(), b"custom mod data");
            }
        }
        let source = dir.path().join("game");
        let file = source.join(datapack);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"folder datapack").unwrap();
        for relative in custom_files {
            let file = source.join(relative);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"custom folder data").unwrap();
        }
        std::fs::write(source.join("launch.json"), b"old launch metadata").unwrap();
        std::fs::create_dir_all(source.join(".aurum")).unwrap();
        std::fs::write(
            source.join(".aurum/native-build.json"),
            b"old runtime metadata",
        )
        .unwrap();
        let id = engine
            .import_folder(
                &source,
                "Folder datapack".into(),
                "1.21.1".into(),
                Loader::Vanilla,
                None,
                &task,
            )
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(engine.instance(&id).unwrap().join(datapack)).unwrap(),
            b"folder datapack"
        );
        assert!(file.exists());
        let game = engine.instance(&id).unwrap();
        for relative in custom_files {
            assert_eq!(
                std::fs::read(game.join(relative)).unwrap(),
                b"custom folder data"
            );
        }
        assert!(!game.join("launch.json").exists());
        assert!(!game.join(".aurum").exists());
    }

    #[tokio::test]
    async fn managed_and_unsafe_overrides_fail_before_provider_requests() {
        let (dir, task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        for relative in [
            "launch.json",
            "LAUNCH.JSON",
            "launch.json.tmp",
            "client/game.jar",
            "natives/unsafe.dll",
            ".aurum/native-build.json",
            ".AURUM/quickplay/world.json",
            "datapacks/../../escape.txt",
            "../escape.txt",
            "datapacks/C:/escape.txt",
            "/absolute/path.json",
            "fancymenu_data/../../escape.json",
            "fancymenu_data/file.json:stream",
            "fancymenu_data/CON.json",
            "fancymenu_data/file.json.",
        ] {
            let path = dir.path().join("bad.zip");
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("manifest.json", options).unwrap();
            zip.write_all(
                json!({"name":"Bad paths","minecraft":{"version":"1.21.1"},
                "files":[{"projectID":1,"fileID":11}]})
                .to_string()
                .as_bytes(),
            )
            .unwrap();
            zip.start_file(format!("overrides/{relative}"), options)
                .unwrap();
            zip.write_all(b"bad override").unwrap();
            zip.finish().unwrap();
            let mut requests = 0;
            let result = engine
                .import_pack_with(&path, &task, |_| {
                    requests += 1;
                    async { bail!("Provider should not be called") }
                })
                .await;
            assert!(result.is_err(), "{relative}");
            assert_eq!(requests, 0, "{relative}");
            assert!(engine.snapshot().await.database.profiles.is_empty());
            assert!(!engine.root.join("staging").join(&task.id).exists());
        }
    }

    #[tokio::test]
    async fn custom_mrpack_index_paths_import_and_archive_symlinks_still_fail() {
        let (dir, task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let file_path = "fancymenu_data/buddy/buddy_leveling.json";
        let bytes = b"custom indexed data";
        let staged = engine
            .root
            .join("staging")
            .join(&task.id)
            .join("pack")
            .join(file_path);
        std::fs::create_dir_all(staged.parent().unwrap()).unwrap();
        std::fs::write(&staged, bytes).unwrap();
        let path = dir.path().join("custom.mrpack");
        let options = zip::write::SimpleFileOptions::default();
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        zip.start_file("modrinth.index.json", options).unwrap();
        zip.write_all(
            json!({"formatVersion":1,"game":"minecraft","name":"Indexed custom data",
            "dependencies":{"minecraft":"1.21.1"},"files":[{"path":file_path,
                "hashes":{"sha1":format!("{:x}", Sha1::digest(bytes))},
                "downloads":["https://cdn.modrinth.com/not-requested"]}]})
            .to_string()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();
        let id = engine.import_pack(&path, &task).await.unwrap();
        assert_eq!(
            std::fs::read(engine.instance(&id).unwrap().join(file_path)).unwrap(),
            bytes
        );

        let bad = dir.path().join("symlink.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&bad).unwrap());
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(
            json!({"name":"Linked custom data","minecraft":{"version":"1.21.1"},
            "files":[{"projectID":1,"fileID":11}]})
            .to_string()
            .as_bytes(),
        )
        .unwrap();
        zip.add_symlink("overrides/fancymenu_data/link", "../../outside", options)
            .unwrap();
        zip.finish().unwrap();
        let mut requests = 0;
        let error = engine
            .import_pack_with(&bad, &task, |_| {
                requests += 1;
                async { bail!("Provider should not be called") }
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("символическую ссылку"));
        assert_eq!(requests, 0);
        assert_eq!(engine.snapshot().await.database.profiles.len(), 1);
    }

    #[tokio::test]
    async fn rate_limited_import_retries_current_lookup_and_preserves_progress() {
        let (dir, mut task) = fixture();
        let events = Arc::new(std::sync::Mutex::new(vec![]));
        let recorded = events.clone();
        task.emit = Arc::new(move |event| recorded.lock().unwrap().push(event));
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let pack = dir.path().join("pack.zip");
        archive(&pack);
        prepare(&engine, &task).await;
        let mut calls = std::collections::HashMap::new();
        let id = engine
            .import_pack_with(&pack, &task, |path| {
                let count = calls.entry(path.clone()).or_insert(0);
                *count += 1;
                let limited =
                    *count == 1 && matches!(path.as_str(), "/mods/2/files/22" | "/mods/2");
                async move {
                    if limited {
                        return Err(crate::aurum_api::CurseForgeRateLimited {
                            retry_after: std::time::Duration::ZERO,
                        }
                        .into());
                    }
                    metadata(path).await
                }
            })
            .await
            .unwrap();
        assert_eq!(calls["/mods/1/files/11"], 1);
        assert_eq!(calls["/mods/2/files/22"], 2);
        assert_eq!(calls["/mods/2"], 2);
        let waits = events.lock().unwrap();
        let waits: Vec<_> = waits
            .iter()
            .filter(|event| event.message.contains("Ожидаем"))
            .collect();
        assert_eq!(waits.len(), 2);
        assert!(waits.iter().all(|event| event.done == 1
            && event.total == 4
            && event.pack_name.as_deref() == Some("Manual pack")));
        assert_eq!(
            std::fs::read(engine.instance(&id).unwrap().join("mods/mod-2.jar")).unwrap(),
            b"correct mod"
        );
        assert!(engine
            .instance(&id)
            .unwrap()
            .join("config/test.txt")
            .exists());
    }

    #[tokio::test]
    async fn rate_limit_wait_is_cancellable_and_persistent_failures_are_bounded() {
        let (dir, mut task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let pack = dir.path().join("pack.zip");
        archive(&pack);
        let cancel = task.cancel.clone();
        task.emit = Arc::new(move |event| {
            if event.message.contains("Ожидаем") {
                cancel.store(true, Ordering::Relaxed);
            }
        });
        let started = std::time::Instant::now();
        let error = engine
            .import_pack_with(&pack, &task, |_| async {
                Err(crate::aurum_api::CurseForgeRateLimited {
                    retry_after: std::time::Duration::from_secs(60),
                }
                .into())
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("отменена"));
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        assert!(engine.snapshot().await.database.profiles.is_empty());
        assert!(!engine.root.join("staging").join(&task.id).exists());

        task.cancel.store(false, Ordering::Relaxed);
        task.emit = Arc::new(|_| {});
        let mut attempts = 0;
        let error = engine
            .import_pack_with(&pack, &task, |_| {
                attempts += 1;
                async {
                    Err(crate::aurum_api::CurseForgeRateLimited {
                        retry_after: std::time::Duration::ZERO,
                    }
                    .into())
                }
            })
            .await
            .unwrap_err();
        assert!(error
            .downcast_ref::<crate::aurum_api::CurseForgeRateLimited>()
            .is_some());
        assert_eq!(attempts, 4);
        assert!(!engine.root.join("staging").join(&task.id).exists());
    }

    #[tokio::test]
    async fn non_rate_limit_errors_are_not_retried() {
        let (_dir, task) = fixture();
        let mut attempts = 0;
        let error = pack_cf(
            &mut |_| {
                attempts += 1;
                async { bail!("Not found") }
            },
            "/mods/1",
            &task,
            "Pack",
            0,
            1,
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "Not found");
        assert_eq!(attempts, 1);
    }

    #[tokio::test]
    async fn partial_import_preserves_files_overrides_and_manual_list_after_restart() {
        let (dir, task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let pack = dir.path().join("pack.zip");
        archive(&pack);
        prepare(&engine, &task).await;
        let id = engine
            .import_pack_with(&pack, &task, metadata)
            .await
            .unwrap();
        let game = engine.instance(&id).unwrap();
        for project in [2, 4] {
            assert_eq!(
                std::fs::read(game.join(format!("mods/mod-{project}.jar"))).unwrap(),
                b"correct mod"
            );
        }
        assert_eq!(
            std::fs::read(game.join("config/test.txt")).unwrap(),
            b"pack settings"
        );
        let engine = Engine::new(engine.root.clone(), |_| {}).await.unwrap();
        let profile = engine.profile(&id).await.unwrap();
        assert_eq!(profile.manual_downloads.len(), 2);
        assert_eq!(profile.manual_downloads[0].name, "Restricted Mod");
        assert_eq!(
            profile.manual_downloads[0].url,
            "https://www.curseforge.com/minecraft/mc-mods/restricted-mod/files/11"
        );
        assert_eq!(profile.manual_downloads[0].reason, "restricted");
        assert_eq!(profile.manual_downloads[1].path, "mods/mod-3.jar");
        assert_eq!(profile.manual_downloads[1].reason, "download");
        assert_eq!(
            profile.manual_downloads[1].url,
            "https://www.curseforge.com/projects/3/files/33"
        );
        assert!(!engine.root.join("staging").join(&task.id).exists());

        let local = dir.path().join("download.jar");
        std::fs::write(&local, b"wrong version").unwrap();
        assert!(engine
            .import_pack_manual_file(&id, "mods/mod-1.jar", &local)
            .await
            .is_err());
        assert!(!game.join("mods/mod-1.jar").exists());
        assert_eq!(engine.profile(&id).await.unwrap().manual_downloads.len(), 2);
        std::fs::write(&local, b"correct mod").unwrap();
        engine
            .import_pack_manual_file(&id, "mods/mod-1.jar", &local)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(game.join("mods/mod-1.jar")).unwrap(),
            b"correct mod"
        );
        let engine = Engine::new(engine.root.clone(), |_| {}).await.unwrap();
        assert_eq!(engine.profile(&id).await.unwrap().manual_downloads.len(), 1);
        assert!(engine
            .import_pack_manual_file(&id, "../escape.jar", &local)
            .await
            .is_err());
        assert_eq!(
            std::fs::read(game.join("mods/mod-2.jar")).unwrap(),
            b"correct mod"
        );
    }

    #[tokio::test]
    async fn overrides_can_supply_a_restricted_file_without_manual_installation() {
        let (dir, task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let pack = dir.path().join("pack.zip");
        archive(&pack);
        let mut zip = zip::ZipWriter::new_append(
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&pack)
                .unwrap(),
        )
        .unwrap();
        zip.start_file(
            "overrides/mods/mod-1.jar",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(b"correct mod").unwrap();
        zip.finish().unwrap();
        prepare(&engine, &task).await;
        let id = engine
            .import_pack_with(&pack, &task, metadata)
            .await
            .unwrap();
        let profile = engine.profile(&id).await.unwrap();
        assert_eq!(profile.manual_downloads.len(), 1);
        assert_eq!(profile.manual_downloads[0].path, "mods/mod-3.jar");
    }

    #[tokio::test]
    async fn curseforge_routes_project_types_and_inspects_unknown_archives() {
        let (dir, task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let pack = dir.path().join("pack.zip");
        archive(&pack);
        let stage = engine.root.join("staging").join(&task.id).join("pack");
        let shader = stage.join("mods/mod-3.zip");
        std::fs::create_dir_all(shader.parent().unwrap()).unwrap();
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&shader).unwrap());
        zip.start_file("shaders/test.fsh", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"shader source").unwrap();
        zip.finish().unwrap();
        let shader_hash = format!("{:x}", Sha1::digest(std::fs::read(&shader).unwrap()));
        std::fs::create_dir_all(stage.join("shaderpacks")).unwrap();
        std::fs::write(stage.join("shaderpacks/mod-2.zip"), b"correct mod").unwrap();
        let id = engine
            .import_pack_with(&pack, &task, |path| {
                let shader_hash = shader_hash.clone();
                async move {
                    if path == "/mods/1" {
                        return Ok(json!({"data":{"classId":12,"name":"Textures"}}));
                    }
                    if path == "/mods/2" {
                        return Ok(json!({"data":{"classId":6552}}));
                    }
                    let mut raw = metadata(path.clone()).await?;
                    if path.contains("/files/") {
                        let project = raw["data"]["modId"].as_u64().unwrap();
                        if project < 4 {
                            raw["data"]["fileName"] = json!(format!("mod-{project}.zip"));
                        }
                        if project == 3 {
                            raw["data"]["hashes"][0]["value"] = json!(shader_hash);
                        }
                    }
                    Ok(raw)
                }
            })
            .await
            .unwrap();
        let profile = engine.profile(&id).await.unwrap();
        assert_eq!(profile.manual_downloads[0].path, "resourcepacks/mod-1.zip");
        let game = engine.instance(&id).unwrap();
        assert!(game.join("shaderpacks/mod-2.zip").exists());
        assert!(game.join("shaderpacks/mod-3.zip").exists());
        assert!(!game.join("mods/mod-2.zip").exists());
        assert!(!game.join("mods/mod-3.zip").exists());
        let resource = dir.path().join("textures.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&resource).unwrap());
        zip.start_file("pack.mcmeta", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"{}").unwrap();
        zip.finish().unwrap();
        assert_eq!(archive_content_folder(&resource), Some("resourcepacks"));
    }

    #[tokio::test]
    async fn manual_zip_is_routed_by_contents_when_project_metadata_is_unavailable() {
        let (dir, task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let pack = dir.path().join("pack.zip");
        archive(&pack);
        prepare(&engine, &task).await;
        let resource = dir.path().join("textures.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&resource).unwrap());
        zip.start_file("pack.mcmeta", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"{}").unwrap();
        zip.finish().unwrap();
        let hash = format!("{:x}", Sha1::digest(std::fs::read(&resource).unwrap()));
        let id = engine
            .import_pack_with(&pack, &task, |path| {
                let hash = hash.clone();
                async move {
                    if path == "/mods/1" {
                        bail!("Project unavailable");
                    }
                    let mut raw = metadata(path.clone()).await?;
                    if path == "/mods/1/files/11" {
                        raw["data"]["fileName"] = json!("textures.zip");
                        raw["data"]["hashes"][0]["value"] = json!(hash);
                    }
                    Ok(raw)
                }
            })
            .await
            .unwrap();
        engine
            .import_pack_manual_file(&id, "mods/textures.zip", &resource)
            .await
            .unwrap();
        let game = engine.instance(&id).unwrap();
        assert!(game.join("resourcepacks/textures.zip").exists());
        assert!(!game.join("mods/textures.zip").exists());
        assert!(!engine
            .profile(&id)
            .await
            .unwrap()
            .manual_downloads
            .iter()
            .any(|file| file.path == "mods/textures.zip"));
    }

    #[tokio::test]
    async fn downloads_scan_checks_versions_ignores_partial_files_and_optionally_cleans_up() {
        let (dir, task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let pack = dir.path().join("pack.zip");
        archive(&pack);
        prepare(&engine, &task).await;
        let id = engine
            .import_pack_with(&pack, &task, |path| async move {
                let mut raw = metadata(path.clone()).await?;
                if path == "/mods/3/files/33" {
                    raw["data"]["hashes"][0]["value"] =
                        json!(format!("{:x}", Sha1::digest(b"third mod")));
                }
                Ok(raw)
            })
            .await
            .unwrap();
        let downloads = dir.path().join("Downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        std::fs::write(downloads.join("mod-1.jar"), b"wrong version").unwrap();
        std::fs::write(downloads.join("mod-1 (1).jar"), b"correct mod").unwrap();
        std::fs::write(downloads.join("mod-3.jar.crdownload"), b"third mod").unwrap();
        std::fs::write(downloads.join("unrelated.jar"), b"unrelated mod").unwrap();
        assert_eq!(
            engine
                .scan_pack_downloads(&id, &downloads, false)
                .await
                .unwrap(),
            1
        );
        assert!(downloads.join("mod-1 (1).jar").exists());
        assert_eq!(
            engine
                .scan_pack_downloads(&id, &downloads, false)
                .await
                .unwrap(),
            0
        );
        std::fs::write(downloads.join("mod-3.jar"), b"third mod").unwrap();
        assert_eq!(
            engine
                .scan_pack_downloads(&id, &downloads, true)
                .await
                .unwrap(),
            1
        );
        assert!(!downloads.join("mod-3.jar").exists());
        assert!(downloads.join("mod-1.jar").exists());
        assert!(downloads.join("mod-3.jar.crdownload").exists());
        assert!(downloads.join("unrelated.jar").exists());
        let engine = Engine::new(engine.root.clone(), |_| {}).await.unwrap();
        assert!(engine
            .profile(&id)
            .await
            .unwrap()
            .manual_downloads
            .is_empty());
        assert!(engine
            .instance(&id)
            .unwrap()
            .join("mods/mod-3.jar")
            .exists());
    }

    async fn missing_resource(engine: &Engine, name: &str) -> Profile {
        let mut profile = engine
            .create_profile(name.into(), "1.21.1".into(), Loader::Vanilla, None, 0)
            .await
            .unwrap();
        profile.manual_downloads = vec![PackManualDownload {
            name: "Required resource pack".into(),
            path: "resourcepacks/Required Pack.zip".into(),
            url: "https://www.curseforge.com/minecraft/texture-packs/example/files/1".into(),
            sha1: format!("{:x}", Sha1::digest(b"required resource pack")),
            sha256: None,
            reason: "restricted".into(),
        }];
        let mut db = engine.db.lock().await;
        db.profiles
            .iter_mut()
            .find(|saved| saved.id == profile.id)
            .unwrap()
            .manual_downloads = profile.manual_downloads.clone();
        crate::store::persist(&engine.root, &db).await.unwrap();
        profile
    }

    #[tokio::test]
    async fn renamed_resource_download_moves_only_the_verified_version() {
        let (dir, _task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let profile = missing_resource(&engine, "Renamed resource").await;
        let downloads = dir.path().join("Downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        let wrong = downloads.join("Required Pack.zip");
        std::fs::write(&wrong, b"different resource version").unwrap();
        let partial = downloads.join("Required Pack.zip.crdownload");
        std::fs::write(&partial, b"required resource pack").unwrap();
        assert_eq!(
            engine
                .scan_pack_downloads(&profile.id, &downloads, true)
                .await
                .unwrap(),
            0
        );
        let renamed = downloads.join("browser+renamed (2).ZIP");
        std::fs::write(&renamed, b"required resource pack").unwrap();
        assert_eq!(
            engine
                .scan_pack_downloads(&profile.id, &downloads, true)
                .await
                .unwrap(),
            1
        );
        assert!(!renamed.exists());
        assert!(wrong.exists());
        assert!(partial.exists());
        assert_eq!(
            std::fs::read(
                engine
                    .instance(&profile.id)
                    .unwrap()
                    .join("resourcepacks/Required Pack.zip")
            )
            .unwrap(),
            b"required resource pack"
        );
        assert!(engine
            .profile(&profile.id)
            .await
            .unwrap()
            .manual_downloads
            .is_empty());
    }

    #[tokio::test]
    async fn manually_placed_resource_is_recognized_and_never_deleted() {
        let (dir, _task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let profile = missing_resource(&engine, "Already placed resource").await;
        let game = engine.instance(&profile.id).unwrap();
        std::fs::create_dir_all(game.join("resourcepacks")).unwrap();
        let existing = game.join("resourcepacks/Required Pack.zip");
        std::fs::write(&existing, b"wrong resource").unwrap();
        let downloads = dir.path().join("absent-downloads");
        assert_eq!(
            engine
                .scan_pack_downloads(&profile.id, &downloads, true)
                .await
                .unwrap(),
            0
        );
        std::fs::write(&existing, b"required resource pack").unwrap();
        assert_eq!(
            engine
                .scan_pack_downloads(&profile.id, &downloads, true)
                .await
                .unwrap(),
            1
        );
        assert_eq!(std::fs::read(&existing).unwrap(), b"required resource pack");
        assert!(engine
            .profile(&profile.id)
            .await
            .unwrap()
            .manual_downloads
            .is_empty());
    }

    #[tokio::test]
    async fn selected_manual_file_moves_after_publication_and_wrong_files_stay() {
        let (dir, _task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let profile = missing_resource(&engine, "Selected resource").await;
        let source = dir.path().join("Selected.zip");
        std::fs::write(&source, b"different version").unwrap();
        assert!(engine
            .import_pack_manual_file_with_cleanup(
                &profile.id,
                "resourcepacks/Required Pack.zip",
                &source,
                true
            )
            .await
            .is_err());
        assert!(source.exists());
        std::fs::write(&source, b"required resource pack").unwrap();
        engine
            .import_pack_manual_file_with_cleanup(
                &profile.id,
                "resourcepacks/Required Pack.zip",
                &source,
                true,
            )
            .await
            .unwrap();
        assert!(!source.exists());
        let restored = Engine::new(engine.root.clone(), |_| {}).await.unwrap();
        assert!(restored
            .profile(&profile.id)
            .await
            .unwrap()
            .manual_downloads
            .is_empty());
        assert!(restored
            .instance(&profile.id)
            .unwrap()
            .join("resourcepacks/Required Pack.zip")
            .exists());
    }

    #[tokio::test]
    async fn cancellation_and_unsafe_metadata_still_abort_import() {
        let (dir, task) = fixture();
        let engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let pack = dir.path().join("pack.zip");
        archive(&pack);
        task.cancel.store(true, Ordering::Relaxed);
        assert!(engine
            .import_pack_with(&pack, &task, metadata)
            .await
            .is_err());
        assert!(engine.snapshot().await.database.profiles.is_empty());
        assert!(!engine.root.join("staging").join(&task.id).exists());
        task.cancel.store(false, Ordering::Relaxed);
        let result = engine
            .import_pack_with(&pack, &task, |path| async move {
                let mut raw = metadata(path).await?;
                raw["data"]["fileName"] = json!("..\\escape.jar");
                Ok(raw)
            })
            .await;
        assert!(result.is_err());
        assert!(engine.snapshot().await.database.profiles.is_empty());
        let result = engine
            .import_pack_with(&pack, &task, |path| {
                if path == "/mods/1" {
                    task.cancel.store(true, Ordering::Relaxed);
                }
                metadata(path)
            })
            .await;
        assert!(result.is_err());
        assert!(engine.snapshot().await.database.profiles.is_empty());
        assert!(!engine.root.join("staging").join(&task.id).exists());
    }
}
