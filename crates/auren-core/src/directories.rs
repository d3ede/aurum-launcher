//! Human-readable instance directories with a durable journal for interrupted renames.
use crate::{model::*, Engine};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    io::Write,
    path::{Path, PathBuf},
};

const JOURNAL: &str = "instance-move.json";

pub(crate) fn instance_path(root: &Path, directory: &str) -> Result<PathBuf> {
    if directory.contains('/') {
        bail!("Неверное имя папки сборки")
    }
    crate::safe_join(&root.join("instances"), directory)
}

fn folder_name(name: &str) -> String {
    let name: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let name = name.trim_matches([' ', '.']);
    let name = if name.is_empty() { "Profile" } else { name };
    // Include Windows' superscript aliases for reserved COM/LPT device names.
    let base = name.split('.').next().unwrap_or("").to_uppercase();
    if instance_path(Path::new(""), name).is_err()
        || ["COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³"].contains(&base.as_str())
    {
        format!("_{name}")
    } else {
        name.to_owned()
    }
}

fn available_directory(root: &Path, db: &Database, name: &str) -> Result<String> {
    let base = folder_name(name);
    let mut occupied: HashSet<_> = db
        .instance_directories
        .values()
        .map(|s| s.to_lowercase())
        .collect();
    occupied.extend(db.profiles.iter().map(|p| p.id.to_lowercase()));
    let instances = root.join("instances");
    if instances.exists() {
        for entry in std::fs::read_dir(instances)? {
            occupied.insert(entry?.file_name().to_string_lossy().to_lowercase());
        }
    }
    for number in 1u64.. {
        let candidate = if number == 1 {
            base.clone()
        } else {
            format!("{base} ({number})")
        };
        if !occupied.contains(&candidate.to_lowercase()) {
            return Ok(candidate);
        }
    }
    unreachable!()
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let temporary = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&temporary)?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(temporary, path)?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct Move {
    source: Option<String>,
    target: String,
    before: Database,
    after: Database,
}

pub(crate) fn validate(root: &Path, db: &Database) -> Result<()> {
    let mut occupied = HashSet::new();
    for profile in &db.profiles {
        uuid::Uuid::parse_str(&profile.id).context("Неверный идентификатор сборки")?;
        let directory = db
            .instance_directories
            .get(&profile.id)
            .unwrap_or(&profile.id);
        instance_path(root, directory)?;
        if !occupied.insert(directory.to_lowercase()) {
            bail!("Несколько профилей ссылаются на одну папку; данные сохранены")
        }
    }
    Ok(())
}

fn move_files(root: &Path, movement: &Move, resume: bool) -> Result<()> {
    let target = instance_path(root, &movement.target)?;
    let source = movement
        .source
        .as_deref()
        .map(|s| crate::safe_join(root, s))
        .transpose()?;
    match source {
        Some(source) if source.try_exists()? => {
            if target.try_exists()? {
                let same_folder = source.parent() == target.parent()
                    && source
                        .file_name()
                        .map(|s| s.to_string_lossy().to_lowercase())
                        == target
                            .file_name()
                            .map(|s| s.to_string_lossy().to_lowercase())
                    && std::fs::canonicalize(&source)? == std::fs::canonicalize(&target)?;
                if !same_folder {
                    bail!(
                        "Папка {} уже существует; файлы не изменены",
                        target.display()
                    )
                }
            }
            std::fs::create_dir_all(target.parent().context("Нет папки сборок")?)?;
            std::fs::rename(&source, &target).with_context(|| {
                format!(
                    "Не удалось перенести {} в {}",
                    source.display(),
                    target.display()
                )
            })?;
        }
        // A previous rename may have succeeded before state.json was saved.
        _ if target.try_exists()? => {
            if !resume {
                bail!(
                    "Папка {} уже существует; файлы не изменены",
                    target.display()
                )
            }
        }
        _ => std::fs::create_dir_all(target)?,
    }
    Ok(())
}

pub(crate) fn recover(root: &Path, db: &mut Database) -> Result<()> {
    let journal = root.join(JOURNAL);
    if !journal.try_exists()? {
        return Ok(());
    }
    let movement: Move = serde_json::from_slice(&std::fs::read(&journal)?)
        .context("Не удалось прочитать журнал переноса; данные сохранены")?;
    validate(root, &movement.after)?;
    let current = serde_json::to_value(&db)?;
    if current == serde_json::to_value(&movement.after)? {
        std::fs::remove_file(journal)?;
        return Ok(());
    }
    if current != serde_json::to_value(&movement.before)? {
        bail!("Состояние профилей изменилось во время переноса; журнал и файлы сохранены")
    }
    let mut paths = vec![instance_path(root, &movement.target)?];
    if let Some(source) = &movement.source {
        paths.push(crate::safe_join(root, source)?);
    }
    if crate::processes::directories_running(paths) {
        bail!("Завершите Minecraft для продолжения переноса профилей")
    }
    move_files(root, &movement, true)?;
    write_json(&root.join("state.json"), &movement.after)?;
    *db = movement.after;
    std::fs::remove_file(journal)?;
    Ok(())
}

impl Engine {
    fn commit_directory(
        &self,
        db: &mut Database,
        next: Database,
        source: Option<&Path>,
        target: String,
    ) -> Result<()> {
        let journal = self.root.join(JOURNAL);
        if journal.try_exists()? {
            bail!("Перезапустите лаунчер для завершения предыдущего переноса")
        }
        let movement = Move {
            source: source
                .map(|p| {
                    p.strip_prefix(&self.root)
                        .map(|s| s.to_string_lossy().replace('\\', "/"))
                })
                .transpose()?,
            target,
            before: db.clone(),
            after: next,
        };
        write_json(&journal, &movement)?;
        if let Err(error) = move_files(&self.root, &movement, false) {
            std::fs::remove_file(&journal)?;
            return Err(error);
        }
        // Keep the journal and published files if saving fails. Startup completes the move.
        if let Err(error) = write_json(&self.root.join("state.json"), &movement.after) {
            // Imports still own a staging directory and can roll back safely. Keep the
            // journal if rollback fails so cleanup can never discard the published files.
            if let Some(source) = movement
                .source
                .as_deref()
                .filter(|s| s.starts_with("staging/"))
            {
                let source = crate::safe_join(&self.root, source)?;
                std::fs::rename(instance_path(&self.root, &movement.target)?, source).context(
                    "Не удалось отменить перенос; перезапустите лаунчер для восстановления",
                )?;
                std::fs::remove_file(journal)?;
            }
            return Err(error);
        }
        *db = movement.after;
        *self.instance_directories.write().unwrap() = db.instance_directories.clone();
        std::fs::remove_file(journal)?;
        Ok(())
    }

    /// Publish every kind of imported profile through the same directory allocator.
    pub(crate) async fn publish_profile(
        &self,
        profile: Profile,
        stage: Option<&Path>,
    ) -> Result<()> {
        let mut db = self.db.lock().await;
        let directory = available_directory(&self.root, &db, &profile.name)?;
        let mut next = db.clone();
        next.instance_directories
            .insert(profile.id.clone(), directory.clone());
        next.profiles.push(profile);
        self.commit_directory(&mut db, next, stage, directory)
    }

    pub(crate) async fn migrate_instance_directories(&self) -> Result<()> {
        let running = self.running.lock().await;
        let mut db = self.db.lock().await;
        for profile in db.profiles.clone() {
            if db.instance_directories.contains_key(&profile.id)
                || running.contains_key(&profile.id)
            {
                continue;
            }
            let source = instance_path(&self.root, &profile.id)?;
            let directory = available_directory(&self.root, &db, &profile.name)?;
            let mut next = db.clone();
            next.instance_directories
                .insert(profile.id, directory.clone());
            self.commit_directory(&mut db, next, Some(&source), directory)?;
        }
        Ok(())
    }

    pub(crate) fn save_profile_update(
        &self,
        db: &mut Database,
        mut next: Database,
        id: &str,
    ) -> Result<bool> {
        let old = db
            .profiles
            .iter()
            .find(|p| p.id == id)
            .context("Сборка не найдена")?;
        let profile = next
            .profiles
            .iter()
            .find(|p| p.id == id)
            .context("Сборка не найдена")?;
        if old.name == profile.name {
            return Ok(false);
        }
        let current = self.instance(id)?;
        let desired = folder_name(&profile.name);
        if current.file_name().is_some_and(|s| s == desired.as_str()) {
            return Ok(false);
        }
        let directory = if current
            .file_name()
            .is_some_and(|s| s.to_string_lossy().to_lowercase() == desired.to_lowercase())
        {
            desired
        } else {
            available_directory(&self.root, &next, &profile.name)?
        };
        next.instance_directories
            .insert(id.to_owned(), directory.clone());
        self.commit_directory(db, next, Some(&current), directory)?;
        Ok(true)
    }
}

/// Preserve the application identity while giving its default data directory a readable name.
/// Explicit custom data locations are handled by the caller and never come through here.
pub fn default_data_directory(legacy: &Path) -> Result<PathBuf> {
    let target = legacy
        .parent()
        .context("Нет папки данных приложений")?
        .join("Aurum Launcher");
    if !legacy.try_exists()? {
        return Ok(target);
    }
    // Tauri may recreate the identity directory solely for data-location.json.
    // A skin library or other data can exist before the first profile/state save.
    let mut has_data = false;
    for entry in std::fs::read_dir(legacy)? {
        let name = entry?.file_name();
        if name != "data-location.json" && name != "data-location.json.tmp" {
            has_data = true;
            break;
        }
    }
    if !has_data {
        return Ok(target);
    }
    let db: Database = if legacy.join("state.json").try_exists()? {
        serde_json::from_slice(&std::fs::read(legacy.join("state.json"))?)
            .context("Не удалось прочитать прежние профили; данные сохранены")?
    } else {
        Database::default()
    };
    validate(legacy, &db)?;
    let mut paths = Vec::new();
    for profile in &db.profiles {
        paths.push(instance_path(
            legacy,
            db.instance_directories
                .get(&profile.id)
                .unwrap_or(&profile.id),
        )?);
    }
    // Also protect unregistered instance folders and either side of a pending move.
    if legacy.join("instances").try_exists()? {
        for entry in std::fs::read_dir(legacy.join("instances"))? {
            paths.push(entry?.path());
        }
    }
    if crate::processes::directories_running(paths) {
        return Ok(legacy.to_owned());
    }
    if target.try_exists()? {
        if std::fs::read_dir(&target)?.next().is_some() {
            bail!("Обе папки данных содержат файлы: {} и {}. Автоматическое объединение остановлено для сохранности данных", legacy.display(), target.display())
        }
        std::fs::remove_dir(&target)?;
    }
    std::fs::rename(legacy, &target)
        .context("Не удалось перенести данные в Aurum Launcher; прежняя папка сохранена")?;
    Ok(target)
}
