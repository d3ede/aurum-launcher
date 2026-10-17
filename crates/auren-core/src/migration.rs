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
        let entries: Vec<_> = walkdir::WalkDir::new(&source)
            .follow_links(false)
            .into_iter()
            .collect::<std::result::Result<_, _>>()?;
        let result: Result<()> = async {
            for (i, entry) in entries.iter().enumerate() {
                task.check()?;
                if entry.file_type().is_symlink() {
                    bail!("Папка данных содержит символическую ссылку")
                }
                let relative = entry.path().strip_prefix(&source)?;
                if relative.as_os_str().is_empty() {
                    continue;
                }
                let destination = target.join(relative);
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
            crate::store::persist(&target, &db).await?;
            self.hosting_rebase_copy(&target).await?;
            Ok(())
        }
        .await;
        // On cancellation, partial copies are kept for inspection. They are never selected as active data.
        result
    }
}
