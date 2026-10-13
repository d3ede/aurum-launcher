use crate::{Engine, Task};
use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

impl Engine {
    pub async fn json(&self, url: &str) -> Result<serde_json::Value> {
        Ok(self
            .http
            .get(url)
            .send()
            .await
            .context("Нет связи с сервером")?
            .error_for_status()?
            .json()
            .await?)
    }
    pub async fn download(
        &self,
        url: &str,
        path: &Path,
        hash: Option<(&str, &str)>,
        task: &Task,
    ) -> Result<()> {
        task.check()?;
        if path.exists() && hash.is_some() && verify(path, hash).await? {
            return Ok(());
        }
        if let Some(p) = path.parent() {
            tokio::fs::create_dir_all(p).await?;
        }
        let temp = path.with_file_name(format!(
            "{}.{}.part",
            path.file_name()
                .context("Не задано имя файла")?
                .to_string_lossy(),
            task.id
        ));
        let result: Result<()> = async {
            let response = self.http.get(url).send().await?.error_for_status()?;
            let mut stream = response.bytes_stream();
            let mut file = tokio::fs::File::create(&temp).await?;
            loop {
                let next=tokio::select! {next=stream.next()=>next,_=tokio::time::sleep(std::time::Duration::from_millis(250))=>{task.check()?;continue}};
                let Some(bytes)=next else{break};
                task.check()?;
                file.write_all(&bytes?).await?;
            }
            file.sync_all().await?;
            drop(file);
            task.check()?;
            if !verify(&temp, hash).await? {
                bail!(
                    "Контрольная сумма не совпадает: {}",
                    path.file_name().unwrap().to_string_lossy()
                )
            }
            tokio::fs::rename(&temp, path).await?;
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(&temp).await;
        }
        result
    }
}
pub async fn verify(path: &Path, expected: Option<(&str, &str)>) -> Result<bool> {
    let Some((algorithm, expected)) = expected else {
        return Ok(true);
    };
    let mut file = tokio::fs::File::open(path).await?;
    let mut buffer = vec![0u8; 65536];
    let mut sha1 = Sha1::new();
    let mut sha256 = Sha256::new();
    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        match algorithm {
            "sha1" => sha1.update(&buffer[..n]),
            "sha256" => sha256.update(&buffer[..n]),
            _ => bail!("Неизвестная контрольная сумма"),
        }
    }
    let actual = if algorithm == "sha1" {
        format!("{:x}", sha1.finalize())
    } else {
        format!("{:x}", sha256.finalize())
    };
    Ok(actual.eq_ignore_ascii_case(expected))
}
