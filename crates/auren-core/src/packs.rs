use crate::{model::*, store::persist, Engine, Task};
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{io::Read, path::Path};

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
        let result:Result<()>=async {
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
                    task.progress("pack",format!("Файлы пакета · {file_path}"),i as u64+1,files.len() as u64);
                }
            } else {
                let files=manifest["files"].as_array().context("Нет файлов CurseForge")?;
                for (i,file) in files.iter().enumerate() {task.check()?; let project=file["projectID"].as_u64().context("Нет projectID")?;let version=file["fileID"].as_u64().context("Нет fileID")?;
                    let raw=self.cf(&format!("/mods/{project}/files/{version}")).await?;let f=&raw["data"];
                    let name=f["fileName"].as_str().context("Нет имени файла")?;if name.contains('/') {bail!("Неверное имя файла")}
                    let hash=f["hashes"].as_array().and_then(|a|a.iter().find(|h|h["algo"]==1)).and_then(|v|v["value"].as_str()).context("Нет SHA1")?;
                    self.download(f["downloadUrl"].as_str().context("Автор запретил загрузку через сторонние приложения; скачайте файл вручную")?,&crate::safe_join(&stage.join("mods"),name)?,Some(("sha1",hash)),task).await?;
                    task.progress("pack","Файлы CurseForge",i as u64+1,files.len() as u64);
                }
            }
            let overrides=if mr {vec!["overrides/".to_string(),"client-overrides/".to_string()]}else{vec![format!("{}/",manifest["overrides"].as_str().unwrap_or("overrides").trim_end_matches('/'))]};
            let mut total=0u64;
            for prefix in overrides { for i in 0..zip.len() {task.check()?;let mut f=zip.by_index(i)?;let name=f.name().to_string();let Some(relative)=name.strip_prefix(&prefix)else{continue};if relative.is_empty() || f.is_dir(){continue}validate_pack_path(relative)?;total+=f.size();if total>1_000_000_000{bail!("Слишком большой архив")};if f.unix_mode().is_some_and(|m|m&0o170000==0o120000){bail!("Архив содержит символическую ссылку")};let path=crate::safe_join(&stage,relative)?;std::fs::create_dir_all(path.parent().unwrap())?;std::io::copy(&mut f,&mut std::fs::File::create(path)?)?; } }
            task.check()?;let instance=self.instance(&id)?;tokio::fs::create_dir_all(instance.parent().unwrap()).await?;tokio::fs::rename(&stage,&instance).await?;
            let p=Profile{id:id.clone(),name,minecraft:mc,loader,loader_version:lv,installed_version:None,ram_mb:None,jvm_args:String::new(),last_played:None,cover:0,content:vec![]};
            let mut db=self.db.lock().await;let mut next=db.clone();next.profiles.push(p);if let Err(e)=persist(&self.root,&next).await{let _=tokio::fs::rename(instance,&stage).await;return Err(e)}*db=next;Ok(())
        }.await;
        let _ = tokio::fs::remove_dir_all(self.root.join("staging").join(&task.id)).await;
        result?;
        Ok(id)
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
            let instance = self.instance(&id)?;
            tokio::fs::create_dir_all(instance.parent().unwrap()).await?;
            tokio::fs::rename(&stage, &instance).await?;
            let p = Profile {
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
                content: vec![],
            };
            let mut db = self.db.lock().await;
            let mut next = db.clone();
            next.profiles.push(p);
            if let Err(e) = persist(&self.root, &next).await {
                let _ = tokio::fs::rename(instance, &stage).await;
                return Err(e);
            }
            *db = next;
            Ok(())
        }
        .await;
        let _ = tokio::fs::remove_dir_all(self.root.join("staging").join(&task.id)).await;
        result?;
        Ok(id)
    }
}
