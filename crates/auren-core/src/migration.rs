use crate::{Engine, Task};
use anyhow::{bail, Context, Result};
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

impl Engine {
    /// Copies data into an empty, user-selected directory. The original is retained.
    pub async fn copy_data(&self, target: &Path, task: &Task) -> Result<()> {
        let _hosting_guard = self.hosting.gate.lock().await;
        if !self.hosting_running().is_empty() {
            bail!("Сначала остановите локальные серверы")
        }
        if !self.running.lock().await.is_empty() {
            bail!("Сначала остановите все игры")
        }
        let source = std::fs::canonicalize(&self.root)?;
        let target = std::fs::canonicalize(target)?;
        if source.starts_with(&target) || target.starts_with(&source) {
            bail!("Новая папка должна находиться отдельно от текущей")
        }
        if std::fs::read_dir(&target)?.next().is_some() {
            bail!("Выберите пустую папку для данных Aurum")
        }
        let mut entries: Vec<_> = walkdir::WalkDir::new(&source)
            .follow_links(false)
            .into_iter()
            .map(|entry| {
                let entry = entry?;
                let relative = entry.path().strip_prefix(&source)?.to_path_buf();
                Ok((entry, relative))
            })
            .collect::<Result<_>>()?;
        let application = crate::layout::application(&source);
        if application != source {
            for name in crate::layout::APP_ENTRIES {
                if name.ends_with(".tmp") || *name == "instance-move.json" { continue; }
                let path = application.join(name);
                if !path.exists() { continue; }
                for entry in walkdir::WalkDir::new(&path).follow_links(false) {
                    let entry = entry?;
                    let relative = entry.path().strip_prefix(&application)?.to_path_buf();
                    entries.push((entry, relative));
                }
            }
        }
        let stage = target.join(format!(".aurum-copy-{}", task.id));
        tokio::fs::create_dir(&stage).await?;
        let _stage = crate::temporary::Temporary::directory(&stage);
        let result: Result<()> = async {
            for (i, (entry, relative)) in entries.iter().enumerate() {
                task.check()?;
                if entry.file_type().is_symlink() {
                    bail!("Папка данных содержит символическую ссылку")
                }
                if relative.as_os_str().is_empty() {
                    continue;
                }
                let destination = stage.join(relative);
                if entry.file_type().is_dir() {
                    tokio::fs::create_dir_all(destination).await?;
                } else {
                    tokio::fs::create_dir_all(
                        destination.parent().context("Нет родительской папки")?,
                    )
                    .await?;
                    let mut input = tokio::fs::File::open(entry.path()).await?;
                    let mut output = tokio::fs::File::create(destination).await?;
                    let mut buffer = vec![0u8; 262144];
                    loop {
                        task.check()?;
                        let n = input.read(&mut buffer).await?;
                        if n == 0 {
                            break;
                        }
                        output.write_all(&buffer[..n]).await?;
                    }
                    output.sync_all().await?;
                }
                if i % 20 == 0 || i + 1 == entries.len() {
                    task.progress(
                        "migration",
                        format!("Копируем {}", relative.display()),
                        i as u64 + 1,
                        entries.len() as u64,
                    );
                }
            }
            let db = self.db.lock().await;
            crate::store::persist(&stage, &db).await?;
            self.hosting_rebase_copy(&stage).await?;
            let hosting = stage.join("hosting/profiles.json");
            if hosting.exists() {
                let mut profiles: Vec<crate::hosting::HostingProfile> = serde_json::from_slice(&tokio::fs::read(&hosting).await?)?;
                for profile in &mut profiles {
                    if let Ok(relative) = profile.root.strip_prefix(&stage) { profile.root = target.join(relative); }
                }
                tokio::fs::write(hosting, serde_json::to_vec_pretty(&profiles)?).await?;
            }
            task.check()?;
            let publish = std::fs::read_dir(&stage)?.map(|entry| Ok(entry?.path())).collect::<Result<Vec<_>>>()?;
            for source in &publish {
                if target.join(source.file_name().unwrap()).exists() { bail!("Новая папка изменилась во время копирования") }
            }
            let mut moved = vec![];
            for source in publish {
                let destination = target.join(source.file_name().unwrap());
                if let Err(error) = std::fs::rename(&source, &destination) {
                    for (source, destination) in moved.into_iter().rev() { std::fs::rename(destination, source)?; }
                    return Err(error.into());
                }
                moved.push((source, destination));
            }
            Ok(())
        }
        .await;
        // The staging guard removes partial copies on error, cancellation or future drop.
        result
    }
}
