use crate::{model::*, Engine, Task};
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{io::Read, path::Path};

// Used only when the provider cannot identify a ZIP's project type.
fn archive_content_folder(path: &Path) -> Option<&'static str> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).ok()?).ok()?;
    let mut resources = false;
    let mut shaders = false;
    for index in 0..zip.len() {
        let file = zip.by_index(index).ok()?;
        let name = file.name();
        if matches!(
            name,
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

fn validate_pack_path(path: &str) -> Result<()> {
    crate::safe_join(Path::new("pack"), path)?;
    let first = path.split('/').next().unwrap_or("");
    if ![
        "mods",
        "config",
        "resourcepacks",
        "shaderpacks",
        "saves",
        "defaultconfigs",
        "scripts",
        "kubejs",
        "options.txt",
        "servers.dat",
    ]
    .contains(&first)
    {
        bail!("Пакет пытается записать неподдерживаемый путь: {path}")
    }
    Ok(())
}
impl Engine {
    pub async fn import_pack(&self, path: &Path, task: &Task) -> Result<String> {
        self.import_pack_with(path, task, |path| async move { self.cf(&path).await })
            .await
    }

    async fn import_pack_with<F, Fut>(&self, path: &Path, task: &Task, mut cf: F) -> Result<String>
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
                    let raw=cf(format!("/mods/{project}/files/{version}")).await?;
                    if let std::collections::hash_map::Entry::Vacant(entry) = projects.entry(project) {
                        entry.insert(cf(format!("/mods/{project}")).await.ok());
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
            let overrides=if mr {vec!["overrides/".to_string(),"client-overrides/".to_string()]}else{vec![format!("{}/",manifest["overrides"].as_str().unwrap_or("overrides").trim_end_matches('/'))]};
            let mut total=0u64;
            for prefix in overrides { for i in 0..zip.len() {task.check()?;let mut f=zip.by_index(i)?;let name=f.name().to_string();let Some(relative)=name.strip_prefix(&prefix)else{continue};if relative.is_empty() || f.is_dir(){continue}validate_pack_path(relative)?;total+=f.size();if total>1_000_000_000{bail!("Слишком большой архив")};if f.unix_mode().is_some_and(|m|m&0o170000==0o120000){bail!("Архив содержит символическую ссылку")};let path=crate::safe_join(&stage,relative)?;std::fs::create_dir_all(path.parent().unwrap())?;std::io::copy(&mut f,&mut std::fs::File::create(path)?)?; } }
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
            let p=Profile{id:id.clone(),name,minecraft:mc,loader,loader_version:lv,installed_version:None,ram_mb:None,jvm_args:String::new(),last_played:None,cover:0,icon:None,icon_style:None,manual_downloads,content:vec![]};
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
            reason: reason.into(),
        }))
    }

    pub async fn import_pack_manual_file(
        &self,
        id: &str,
        file_path: &str,
        source: &Path,
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
            if !crate::net::verify(&temp, Some(("sha1", &missing.sha1))).await? {
                bail!("Выбран другой файл. Скачайте указанную версию мода")
            }
            let mut destination = missing.path.clone();
            if let Some(name) = missing
                .path
                .strip_prefix("mods/")
                .filter(|name| name.ends_with(".zip"))
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
            Ok(())
        }
        .await;
        let _ = tokio::fs::remove_dir_all(&stage).await;
        result
    }

    /// Only inspect completed files matching the requested names, directly in Downloads.
    /// Every candidate is verified again by import_pack_manual_file before publication.
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
        let mut entries = match tokio::fs::read_dir(downloads).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(error.into()),
        };
        let mut candidates = vec![];
        while let Some(entry) = entries.next_entry().await? {
            if entry.file_type().await?.is_file() {
                candidates.push(entry.path());
            }
        }
        let mut imported = 0;
        for missing in profile.manual_downloads {
            let expected = missing.path.rsplit('/').next().context("Нет имени файла")?;
            for source in &candidates {
                if !source
                    .file_name()
                    .and_then(|s| s.to_str())
                    .is_some_and(|name| download_name_matches(name, expected))
                {
                    continue;
                }
                if !crate::net::verify(source, Some(("sha1", &missing.sha1)))
                    .await
                    .unwrap_or(false)
                {
                    continue;
                }
                self.import_pack_manual_file(id, &missing.path, source)
                    .await?;
                imported += 1;
                // Cleanup is optional and happens only after the file and database are saved.
                if remove_imported
                    && crate::net::verify(source, Some(("sha1", &missing.sha1)))
                        .await
                        .unwrap_or(false)
                {
                    let _ = tokio::fs::remove_file(source).await;
                }
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
            let raw = self.cf(&format!("/mods/{project}/files/{version}")).await?;
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
        self.import_pack(&path, task).await
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
        let id = uuid::Uuid::new_v4().to_string();
        let stage = self.root.join("staging").join(&task.id).join("folder");
        tokio::fs::create_dir_all(&stage).await?;
        let result: Result<()> = async {
            for kind in [
                "mods",
                "config",
                "resourcepacks",
                "shaderpacks",
                "saves",
                "defaultconfigs",
                "scripts",
                "kubejs",
                "options.txt",
                "servers.dat",
            ] {
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
        Ok(id)
    }
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
            .import_pack_with(&pack, &task, metadata)
            .await
            .unwrap();
        let downloads = dir.path().join("Downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        std::fs::write(downloads.join("mod-1.jar"), b"wrong version").unwrap();
        std::fs::write(downloads.join("mod-1 (1).jar"), b"correct mod").unwrap();
        std::fs::write(downloads.join("mod-3.jar.crdownload"), b"correct mod").unwrap();
        std::fs::write(downloads.join("unrelated.jar"), b"correct mod").unwrap();
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
        std::fs::write(downloads.join("mod-3.jar"), b"correct mod").unwrap();
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
