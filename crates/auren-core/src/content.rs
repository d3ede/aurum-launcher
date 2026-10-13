use crate::{
    catalog::{cf_version, mr_version, MODRINTH},
    model::*,
    store::persist,
    Engine, Task,
};
use anyhow::{bail, Context, Result};
use std::collections::HashSet;

pub fn folder(kind: &str) -> Result<&'static str> {
    match kind {
        "mod" => Ok("mods"),
        "shader" => Ok("shaderpacks"),
        "resourcepack" => Ok("resourcepacks"),
        _ => bail!("Этот тип контента нельзя установить в существующую сборку"),
    }
}
pub fn compatible(version: &ProjectVersion, p: &Profile, kind: &str) -> bool {
    version.game_versions.contains(&p.minecraft)
        && (kind != "mod"
            || (p.loader != Loader::Vanilla
                && version.loaders.contains(&p.loader.key().to_string())))
}
impl Engine {
    pub async fn install_content(
        &self,
        profile_id: &str,
        source: &str,
        project_id: &str,
        version_id: &str,
        task: &Task,
    ) -> Result<()> {
        if self.running.lock().await.contains_key(profile_id) {
            bail!("Сначала остановите игру")
        }
        crate::store::validate_version(project_id)?;
        crate::store::validate_version(version_id)?;
        let profile = self.profile(profile_id).await?;
        let instance = self.instance(profile_id)?;
        let stage = self.root.join("staging").join(&task.id);
        tokio::fs::create_dir_all(&stage).await?;
        let result:Result<()>=async {
            let mut queue=vec![(project_id.to_string(),version_id.to_string())]; let mut seen=HashSet::new(); let mut plan=vec![]; let mut conflicts=vec![];
            while let Some((project,version))=queue.pop() {
                task.check()?; if !seen.insert(project.clone()) { if plan.iter().any(|c:&Content|c.project_id==project && c.version_id!=version) { bail!("Конфликт версий зависимости {project}") } continue }
                if seen.len()>150 { bail!("Слишком много зависимостей") }
                let (raw,kind,name)=if source=="modrinth" { let raw=self.json(&format!("{MODRINTH}/version/{version}")).await?; let project_data=self.json(&format!("{MODRINTH}/project/{project}")).await?; if raw["project_id"]!=project { bail!("Версия относится к другому проекту") } (raw,project_data["project_type"].as_str().context("Нет типа")?.to_string(),project_data["title"].as_str().unwrap_or(&project).to_string()) }
                else if source=="curseforge" {
                    let raw=self.cf(&format!("/mods/{project}/files/{version}")).await?;
                    let project_data=self.cf(&format!("/mods/{project}")).await?;
                    if raw["data"]["modId"].as_u64()!=Some(project.parse::<u64>()?) { bail!("Файл относится к другому проекту") }
                    let p=crate::catalog::cf_project(&project_data["data"]);
                    (raw["data"].clone(),p.kind,p.title)
                } else { bail!("Неизвестный источник") };
                let pv=if source=="modrinth" {mr_version(&raw)}else{cf_version(&raw)};
                if !compatible(&pv,&profile,&kind) { bail!("{name}: версия несовместима с Minecraft {} / {}",profile.minecraft,profile.loader.key()) }
                let directory=folder(&kind)?;
                if let Some(deps)=raw["dependencies"].as_array() { for dep in deps {
                    let required=if source=="modrinth" {dep["dependency_type"]=="required"}else{dep["relationType"]==3};
                    let incompatible=source=="modrinth" && dep["dependency_type"]=="incompatible";
                    if incompatible { if let Some(p)=dep["project_id"].as_str() {conflicts.push(p.to_string());} }
                    if !required { continue }
                    if source=="modrinth" {
                        if let Some(v)=dep["version_id"].as_str() { let r=self.json(&format!("{MODRINTH}/version/{v}")).await?; queue.push((r["project_id"].as_str().context("Нет project ID зависимости")?.into(),v.into())); }
                        else if let Some(p)=dep["project_id"].as_str() { let options=self.mr_versions(p,Some(&profile.minecraft),Some(profile.loader.key())).await?; let v=options.first().context("Нет совместимой обязательной зависимости")?; queue.push((p.into(),v["id"].as_str().context("Нет версии зависимости")?.into())); }
                        else { bail!("Зависимость доступна только как локальный файл; добавьте её вручную") }
                    } else { let p=dep["modId"].to_string(); let options=self.cf_versions(&p,Some(&profile.minecraft),Some(profile.loader.key())).await?; let v=options.first().context("Нет совместимой зависимости CurseForge")?; queue.push((p,v["id"].to_string())); }
                } }
                let (filename,url,hash)=if source=="modrinth" {
                    let files=raw["files"].as_array().context("Нет файлов версии")?; let file=files.iter().find(|f|f["primary"]==true).or(files.first()).context("Версия не содержит файлов")?;
                    (file["filename"].as_str().context("Нет имени файла")?.to_string(),file["url"].as_str().context("Нет URL")?.to_string(),Some(("sha1".to_string(),file["hashes"]["sha1"].as_str().context("Нет контрольной суммы")?.to_string())))
                } else {
                    let url=raw["downloadUrl"].as_str().context("Автор запретил распространение файла через сторонние приложения. Загрузите файл на CurseForge и добавьте вручную")?.to_string();
                    let hash=raw["hashes"].as_array().and_then(|a|a.iter().find(|h|h["algo"]==1)).and_then(|h|h["value"].as_str()).context("Нет SHA1 файла CurseForge")?;
                    (raw["fileName"].as_str().context("Нет имени файла")?.to_string(),url,Some(("sha1".to_string(),hash.to_string())))
                };
                if filename.contains('/') { bail!("Неверное имя файла контента") } crate::safe_join(&instance,&filename)?;
                if profile.content.iter().any(|c|c.filename==filename && c.project_id!=project && c.kind==kind) || plan.iter().any(|c:&Content|c.filename==filename && c.project_id!=project && c.kind==kind) { bail!("Конфликт имён файлов: {filename}") }
                task.progress("content",format!("Загружаем {name}"),plan.len() as u64,0);
                self.download(&url,&stage.join(directory).join(&filename),hash.as_ref().map(|(a,h)|(a.as_str(),h.as_str())),task).await?;
                plan.push(Content {id:format!("{source}:{project}"),source:source.into(),project_id:project,version_id:version,name,filename,kind,enabled:true});
            }
            for incompatible in conflicts { if plan.iter().any(|c|c.project_id==incompatible) || profile.content.iter().any(|c|c.project_id==incompatible && c.enabled) { bail!("Установка конфликтует с проектом {incompatible}") } }
            task.check()?;
            // Prepare rollback copies before publishing the new content set.
            let backup=stage.join("backup"); let mut moved:Vec<(std::path::PathBuf,std::path::PathBuf)>=vec![]; let mut published=vec![];
            let commit:Result<()>=async {
                for new in &plan {
                    let dir=folder(&new.kind)?; tokio::fs::create_dir_all(instance.join(dir)).await?;
                    let old=profile.content.iter().find(|c|c.project_id==new.project_id && c.source==source);
                    let mut files=vec![instance.join(dir).join(&new.filename)];
                    if let Some(old)=old { files.push(instance.join(folder(&old.kind)?).join(format!("{}{}",old.filename,if old.enabled{""}else{".disabled"}))); }
                    files.sort();files.dedup();
                    for path in files { if path.exists() { let saved=backup.join(format!("{}-{}",moved.len(),path.file_name().unwrap().to_string_lossy())); tokio::fs::create_dir_all(&backup).await?; tokio::fs::rename(&path,&saved).await?; moved.push((saved,path)); } }
                    let path=instance.join(dir).join(&new.filename); tokio::fs::rename(stage.join(dir).join(&new.filename),&path).await?; published.push(path);
                }
                let mut db=self.db.lock().await; let mut next=db.clone(); let p=next.profiles.iter_mut().find(|p|p.id==profile_id).context("Сборка удалена")?;
                for new in plan { p.content.retain(|c| !(c.project_id==new.project_id && c.source==source)); p.content.push(new); }
                persist(&self.root,&next).await?; *db=next; Ok(())
            }.await;
            if commit.is_err() { for path in published { let _=tokio::fs::remove_file(path).await; } for (saved,path) in moved.into_iter().rev() { tokio::fs::rename(saved,path).await.context("Не удалось восстановить резервную копию")?; } }
            commit
        }.await;
        if result.is_ok() || !stage.join("backup").exists() {
            let _ = tokio::fs::remove_dir_all(stage).await;
        }
        result
    }
    pub async fn list_content(&self, id: &str) -> Result<Vec<Content>> {
        let profile = self.profile(id).await?;
        let mut content = vec![];
        let instance = self.instance(id)?;
        for kind in ["mod", "shader", "resourcepack"] {
            let dir = instance.join(folder(kind)?);
            if !dir.exists() {
                continue;
            }
            let mut files = tokio::fs::read_dir(dir).await?;
            while let Some(file) = files.next_entry().await? {
                if !file.file_type().await?.is_file() {
                    continue;
                }
                let name = file.file_name().to_string_lossy().into_owned();
                let enabled = !name.ends_with(".disabled");
                let filename = name.trim_end_matches(".disabled").to_string();
                if !filename.ends_with(".jar") && !filename.ends_with(".zip") {
                    continue;
                }
                let mut c = profile
                    .content
                    .iter()
                    .find(|c| c.filename == filename && c.kind == kind)
                    .cloned()
                    .unwrap_or(Content {
                        id: format!("local:{kind}:{filename}"),
                        source: "local".into(),
                        project_id: String::new(),
                        version_id: String::new(),
                        name: filename.clone(),
                        filename,
                        kind: kind.into(),
                        enabled,
                    });
                c.enabled = enabled;
                content.push(c);
            }
        }
        Ok(content)
    }
    pub async fn manage_content(&self, id: &str, content_id: &str, action: &str) -> Result<()> {
        self.ensure_idle(id).await?;
        let list = self.list_content(id).await?;
        let item = list
            .iter()
            .find(|c| c.id == content_id)
            .context("Файл не найден")?;
        let base = self.instance(id)?.join(folder(&item.kind)?);
        let source = crate::safe_join(
            &base,
            &format!(
                "{}{}",
                item.filename,
                if item.enabled { "" } else { ".disabled" }
            ),
        )?;
        match action {
            "toggle" => {
                let dest = crate::safe_join(
                    &base,
                    &format!(
                        "{}{}",
                        item.filename,
                        if item.enabled { ".disabled" } else { "" }
                    ),
                )?;
                if dest.exists() {
                    bail!("Файл назначения уже существует")
                }
                tokio::fs::rename(source, dest).await?;
            }
            "remove" => {
                let trash = self
                    .root
                    .join("trash/content")
                    .join(uuid::Uuid::new_v4().to_string());
                tokio::fs::create_dir_all(&trash).await?;
                tokio::fs::rename(source, trash.join(&item.filename)).await?;
            }
            _ => bail!("Неизвестное действие"),
        }
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        let p = next
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .context("Сборка удалена")?;
        if action == "remove" {
            p.content.retain(|c| c.id != content_id)
        } else if let Some(c) = p.content.iter_mut().find(|c| c.id == content_id) {
            c.enabled = !item.enabled
        }
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }
    pub async fn import_content(&self, id: &str, kind: &str, path: &std::path::Path) -> Result<()> {
        self.ensure_idle(id).await?;
        self.profile(id).await?;
        let name = path
            .file_name()
            .context("Нет имени файла")?
            .to_string_lossy();
        if (kind == "mod" && !name.ends_with(".jar")) || (kind != "mod" && !name.ends_with(".zip"))
        {
            bail!("Выберите JAR для мода или ZIP для ресурспака/шейдера")
        }
        let dest = crate::safe_join(&self.instance(id)?.join(folder(kind)?), &name)?;
        if dest.exists() {
            bail!("Файл уже установлен")
        }
        tokio::fs::create_dir_all(dest.parent().unwrap()).await?;
        tokio::fs::copy(path, dest).await?;
        Ok(())
    }
    pub async fn update_content(&self, id: &str, content_id: &str, task: &Task) -> Result<()> {
        let p = self.profile(id).await?;
        let item = p
            .content
            .iter()
            .find(|c| c.id == content_id)
            .context("Для локального файла обновление через API недоступно")?;
        let versions = if item.source == "modrinth" {
            self.mr_versions(
                &item.project_id,
                Some(&p.minecraft),
                if item.kind == "mod" {
                    Some(p.loader.key())
                } else {
                    None
                },
            )
            .await?
        } else {
            self.cf_versions(
                &item.project_id,
                Some(&p.minecraft),
                if item.kind == "mod" {
                    Some(p.loader.key())
                } else {
                    None
                },
            )
            .await?
        };
        let latest = versions.first().context("Совместимых версий нет")?;
        let version = if item.source == "modrinth" {
            mr_version(latest)
        } else {
            cf_version(latest)
        };
        if version.id == item.version_id {
            task.progress("content", "Установлена последняя совместимая версия", 1, 1);
            return Ok(());
        }
        self.install_content(id, &item.source, &item.project_id, &version.id, task)
            .await
    }
}
