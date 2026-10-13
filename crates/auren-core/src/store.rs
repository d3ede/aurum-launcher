use crate::{model::*, Engine};
use anyhow::{bail, Context, Result};
use md5::{Digest, Md5};

pub async fn persist(root: &std::path::Path, db: &Database) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(db)?;
    let temp = root.join("state.json.tmp");
    let mut file = tokio::fs::File::create(&temp).await?;
    tokio::io::AsyncWriteExt::write_all(&mut file, &bytes).await?;
    file.sync_all().await?;
    drop(file);
    tokio::fs::rename(temp, root.join("state.json")).await?;
    Ok(())
}
impl Engine {
    pub async fn create_profile(
        &self,
        name: String,
        minecraft: String,
        loader: Loader,
        loader_version: Option<String>,
        cover: u8,
    ) -> Result<Profile> {
        validate_name(&name)?;
        validate_version(&minecraft)?;
        if loader != Loader::Vanilla {
            validate_version(
                loader_version
                    .as_deref()
                    .context("Выберите версию загрузчика")?,
            )?;
        }
        let p = Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.trim().into(),
            minecraft,
            loader,
            loader_version,
            installed_version: None,
            ram_mb: None,
            jvm_args: String::new(),
            last_played: None,
            cover: cover % 4,
            content: vec![],
        };
        tokio::fs::create_dir_all(self.instance(&p.id)?).await?;
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        next.profiles.push(p.clone());
        persist(&self.root, &next).await?;
        *db = next;
        Ok(p)
    }
    pub async fn update_profile(&self, profile: Profile) -> Result<()> {
        self.ensure_idle(&profile.id).await?;
        validate_name(&profile.name)?;
        if let Some(ram) = profile.ram_mb {
            if !(512..=65536).contains(&ram) {
                bail!("RAM должна быть от 512 до 65536 МБ")
            }
        }
        validate_jvm(&profile.jvm_args)?;
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        let old = next
            .profiles
            .iter_mut()
            .find(|p| p.id == profile.id)
            .context("Сборка не найдена")?;
        // Metadata that describes installed content cannot be overwritten by the webview.
        old.name = profile.name.trim().into();
        old.ram_mb = profile.ram_mb;
        old.jvm_args = profile.jvm_args;
        old.cover = profile.cover % 4;
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }
    pub async fn delete_profile(&self, id: &str) -> Result<()> {
        self.ensure_idle(id).await?;
        self.profile(id).await?;
        // Preserve deleted worlds in a recoverable trash folder.
        let path = self.instance(id)?;
        if path.exists() {
            let trash = self.root.join("trash");
            tokio::fs::create_dir_all(&trash).await?;
            tokio::fs::rename(path, trash.join(format!("{}-{id}", crate::now()))).await?;
        }
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        next.profiles.retain(|p| p.id != id);
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }
    pub async fn save_settings(&self, settings: Settings) -> Result<()> {
        if !(512..=65536).contains(&settings.ram_mb)
            || !(320..=7680).contains(&settings.resolution_width)
            || !(240..=4320).contains(&settings.resolution_height)
        {
            bail!("Недопустимые параметры памяти или окна")
        }
        if !["light", "dark", "system"].contains(&settings.theme.as_str()) {
            bail!("Неизвестная тема")
        }
        validate_jvm(&settings.jvm_args)?;
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        next.settings = settings;
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }
    pub async fn add_offline(&self, name: String) -> Result<Account> {
        if !regex::Regex::new(r"^[A-Za-z0-9_]{3,16}$")?.is_match(&name) {
            bail!("Ник: 3–16 латинских букв, цифр или _")
        }
        let mut bytes: [u8; 16] = Md5::digest(format!("OfflinePlayer:{name}").as_bytes()).into();
        bytes[6] = (bytes[6] & 0x0f) | 0x30;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        let uuid = uuid::Uuid::from_bytes(bytes).simple().to_string();
        let a = Account {
            id: uuid.clone(),
            name,
            uuid,
            kind: "offline".into(),
            skin_model: "steve".into(),
            has_skin: false,
        };
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        if next.accounts.iter().any(|v| v.id == a.id) {
            bail!("Такой аккаунт уже добавлен")
        }
        next.accounts.push(a.clone());
        next.selected_account = Some(a.id.clone());
        persist(&self.root, &next).await?;
        *db = next;
        Ok(a)
    }
    pub async fn select_account(&self, id: String) -> Result<()> {
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        if !next.accounts.iter().any(|a| a.id == id) {
            bail!("Аккаунт не найден")
        }
        next.selected_account = Some(id);
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }
    pub async fn delete_account(&self, id: String) -> Result<()> {
        if !self.running.lock().await.is_empty() {
            bail!("Сначала остановите игру")
        }
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        next.accounts.retain(|a| a.id != id);
        if next.selected_account.as_deref() == Some(&id) {
            next.selected_account = next.accounts.first().map(|a| a.id.clone())
        }
        persist(&self.root, &next).await?;
        *db = next;
        let _ = crate::auth::delete_secret(&id);
        Ok(())
    }
}
pub fn validate_name(s: &str) -> Result<()> {
    if s.trim().is_empty() || s.len() > 120 {
        bail!("Название должно содержать от 1 до 120 символов")
    }
    Ok(())
}
pub fn validate_version(s: &str) -> Result<()> {
    if s.is_empty()
        || s.len() > 100
        || !s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-_+".contains(c))
    {
        bail!("Некорректная версия")
    }
    Ok(())
}
pub fn validate_jvm(s: &str) -> Result<()> {
    let args = shlex::split(s).context("Незакрытая кавычка в JVM-аргументах")?;
    for a in args {
        if !a.starts_with('-')
            || [
                "-cp",
                "-classpath",
                "--class-path",
                "-jar",
                "--module-path",
                "-p",
            ]
            .contains(&a.as_str())
            || a.starts_with("-Xmx")
            || a.starts_with("-Xms")
        {
            bail!("Путь запуска и память задаются отдельно; разрешены только JVM-параметры")
        }
    }
    Ok(())
}
