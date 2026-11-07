//! Optional executable downloads are pinned by the manifest embedded in the launcher.
//! No remote manifest, archive paths, or remote executable URLs are accepted.
use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

pub const WORKER: &str = "aurum-social-worker.exe";
pub const FIREWALL: &str = "aurum-social-firewall.exe";
const MAX_FILE: u64 = 512 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeFile {
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
    pub download_bytes: u64,
    pub download_sha256: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub version: String,
    pub revision: String,
    pub files: Vec<RuntimeFile>,
}

impl Manifest {
    pub fn decode(text: &str) -> Result<Self> {
        let manifest: Self = serde_json::from_str(text)?;
        let version: Vec<_> = manifest.version.split('.').collect();
        if version.len() != 3
            || version
                .iter()
                .any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()))
            || manifest.files.len() != 2
            || manifest.files[0].name != WORKER
            || manifest.files[1].name != FIREWALL
        {
            bail!("Invalid embedded Social runtime manifest");
        }
        for file in &manifest.files {
            if file.bytes == 0
                || file.bytes > MAX_FILE
                || file.download_bytes == 0
                || file.download_bytes > MAX_FILE
                || !valid_hash(&file.sha256)
                || !valid_hash(&file.download_sha256)
            {
                bail!("Invalid embedded Social runtime file");
            }
        }
        let revision = manifest
            .files
            .iter()
            .map(|file| format!("{}:{}:{}", file.name, file.sha256, file.bytes))
            .collect::<Vec<_>>()
            .join("\n");
        if manifest.revision != hash(revision.as_bytes()) {
            bail!("Invalid embedded Social runtime revision");
        }
        Ok(manifest)
    }

    pub fn directory(&self, root: &Path) -> PathBuf {
        root.join(&self.revision)
    }

    pub fn installed(&self, root: &Path) -> Result<Option<PathBuf>> {
        let directory = self.directory(root);
        self.in_directory(&directory)
    }

    pub fn in_directory(&self, directory: &Path) -> Result<Option<PathBuf>> {
        if self
            .files
            .iter()
            .all(|file| verified(&directory.join(&file.name), file).unwrap_or(false))
        {
            Ok(Some(directory.join(WORKER)))
        } else {
            Ok(None)
        }
    }

    pub async fn install(
        &self,
        client: &reqwest::Client,
        root: &Path,
        cancel: &AtomicBool,
        progress: impl Fn(u64, u64),
    ) -> Result<PathBuf> {
        let base = format!(
            "https://github.com/d3ede/aurum-launcher/releases/download/v{}",
            self.version
        );
        self.install_from(client, root, cancel, progress, &base)
            .await
    }

    async fn install_from(
        &self,
        client: &reqwest::Client,
        root: &Path,
        cancel: &AtomicBool,
        progress: impl Fn(u64, u64),
        base: &str,
    ) -> Result<PathBuf> {
        check(cancel)?;
        if let Some(path) = self.installed(root)? {
            return Ok(path);
        }
        std::fs::create_dir_all(root)?;
        let staging = root.join(format!("{}.{}.part", self.revision, uuid::Uuid::new_v4()));
        std::fs::create_dir(&staging)?;
        // Drop also cleans up if the future is cancelled while awaiting the network.
        let staging = Staging(staging);
        let files: Vec<_> = self
            .files
            .iter()
            .map(|file| (file, reusable(root, file)))
            .collect();
        let total = files
            .iter()
            .filter(|(_, cached)| cached.is_none())
            .map(|(file, _)| file.download_bytes)
            .sum();
        let mut done = 0;
        progress(done, total);
        for (file, cached) in files {
            check(cancel)?;
            if let Some(cached) = cached {
                let path = staging.0.join(&file.name);
                std::fs::copy(cached, &path)?;
                if !verified(&path, file)? {
                    bail!("Cached Social component changed during setup");
                }
                continue;
            }
            let response = tokio::select! {
                response = client.get(format!("{base}/{}.gz", file.name)).send() => response?.error_for_status()?,
                _ = cancelled(cancel) => bail!("Social component download cancelled"),
            };
            if response
                .content_length()
                .is_some_and(|n| n != file.download_bytes)
            {
                bail!("Social component download size mismatch");
            }
            let mut stream = response.bytes_stream();
            let mut compressed = Vec::new();
            loop {
                let chunk = tokio::select! {
                    chunk = stream.next() => chunk,
                    _ = cancelled(cancel) => bail!("Social component download cancelled"),
                };
                let Some(chunk) = chunk else { break };
                let chunk = chunk?;
                if compressed.len() as u64 + chunk.len() as u64 > file.download_bytes {
                    bail!("Social component exceeds its pinned download size");
                }
                compressed.extend_from_slice(&chunk);
                progress(done + compressed.len() as u64, total);
            }
            check(cancel)?;
            unpack(&compressed, &staging.0.join(&file.name), file, cancel)?;
            done += file.download_bytes;
        }
        check(cancel)?;
        let destination = self.directory(root);
        if destination.exists() {
            // Only our content-addressed runtime directory is ever replaced.
            std::fs::remove_dir_all(&destination)
                .context("Close Social before repairing its component")?;
        }
        std::fs::rename(&staging.0, &destination)?;
        // Keep only this revision. Never recursively remove unrelated cache entries.
        for entry in std::fs::read_dir(root)?.flatten() {
            if entry.path() != destination
                && entry.file_name().to_str().is_some_and(valid_hash)
                && entry
                    .file_type()
                    .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
            {
                for name in [WORKER, FIREWALL] {
                    let _ = std::fs::remove_file(entry.path().join(name));
                }
                let _ = std::fs::remove_dir(entry.path());
            }
        }
        progress(total, total);
        Ok(destination.join(WORKER))
    }
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn reusable(root: &Path, file: &RuntimeFile) -> Option<PathBuf> {
    std::fs::read_dir(root).ok()?.flatten().find_map(|entry| {
        if !entry.file_name().to_str().is_some_and(valid_hash)
            || !entry
                .file_type()
                .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
        {
            return None;
        }
        let path = entry.path().join(&file.name);
        verified(&path, file).unwrap_or(false).then_some(path)
    })
}
fn check(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Acquire) {
        bail!("Social component download cancelled");
    }
    Ok(())
}
async fn cancelled(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Acquire) {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}
fn verified(path: &Path, expected: &RuntimeFile) -> Result<bool> {
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() != expected.bytes
    {
        return Ok(false);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Ok(false);
        }
    }
    let mut reader = std::fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()) == expected.sha256)
}
fn unpack(
    compressed: &[u8],
    path: &Path,
    expected: &RuntimeFile,
    cancel: &AtomicBool,
) -> Result<()> {
    if compressed.len() as u64 != expected.download_bytes
        || hash(compressed) != expected.download_sha256
    {
        bail!("Social component download checksum mismatch");
    }
    let mut decoder = flate2::read::GzDecoder::new(compressed).take(expected.bytes + 1);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    let mut digest = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0; 65536];
    loop {
        check(cancel)?;
        let count = decoder.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > expected.bytes {
            bail!("Social component exceeds its pinned executable size");
        }
        digest.update(&buffer[..count]);
        file.write_all(&buffer[..count])?;
    }
    if bytes != expected.bytes || format!("{:x}", digest.finalize()) != expected.sha256 {
        bail!("Social component executable checksum mismatch");
    }
    file.sync_all()?;
    Ok(())
}
struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn fixture() -> (Manifest, Vec<Vec<u8>>) {
        let raw = [b"test worker".to_vec(), b"test firewall helper".to_vec()];
        let compressed: Vec<_> = raw
            .iter()
            .map(|bytes| {
                let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
                encoder.write_all(bytes).unwrap();
                encoder.finish().unwrap()
            })
            .collect();
        let files: Vec<_> = [WORKER, FIREWALL]
            .iter()
            .enumerate()
            .map(|(i, name)| RuntimeFile {
                name: name.to_string(),
                bytes: raw[i].len() as u64,
                sha256: hash(&raw[i]),
                download_bytes: compressed[i].len() as u64,
                download_sha256: hash(&compressed[i]),
            })
            .collect();
        let revision = hash(
            files
                .iter()
                .map(|file| format!("{}:{}:{}", file.name, file.sha256, file.bytes))
                .collect::<Vec<_>>()
                .join("\n")
                .as_bytes(),
        );
        (
            Manifest {
                version: "1.2.3".into(),
                revision,
                files,
            },
            compressed,
        )
    }

    async fn server(responses: Vec<Vec<u8>>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            for response in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 4096];
                let _ = socket.read(&mut request).await.unwrap();
                socket
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            response.len()
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
                let _ = socket.write_all(&response).await;
            }
        });
        format!("http://{address}")
    }

    #[test]
    fn rejects_untrusted_names_versions_revisions_and_sizes() {
        let (manifest, _) = fixture();
        assert!(Manifest::decode(&serde_json::to_string(&manifest).unwrap()).is_ok());
        for (key, value) in [("version", "../../latest"), ("revision", "../../outside")] {
            let mut json = serde_json::to_value(&manifest).unwrap();
            json[key] = value.into();
            assert!(Manifest::decode(&json.to_string()).is_err());
        }
        let mut json = serde_json::to_value(&manifest).unwrap();
        json["files"][0]["name"] = "../evil.exe".into();
        assert!(Manifest::decode(&json.to_string()).is_err());
        json["files"][0]["name"] = WORKER.into();
        json["files"][0]["bytes"] = (MAX_FILE + 1).into();
        assert!(Manifest::decode(&json.to_string()).is_err());
    }

    #[tokio::test]
    async fn installs_verified_files_reuses_offline_and_repairs_corruption() {
        let (manifest, compressed) = fixture();
        let directory = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        let http = reqwest::Client::new();
        let base = server(compressed.clone()).await;
        let path = manifest
            .install_from(&http, directory.path(), &cancel, |_, _| {}, &base)
            .await
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"test worker");
        assert_eq!(
            manifest.installed(directory.path()).unwrap(),
            Some(path.clone())
        );
        // No reachable server is needed for an already verified runtime.
        assert_eq!(
            manifest
                .install_from(
                    &http,
                    directory.path(),
                    &cancel,
                    |_, _| {},
                    "http://127.0.0.1:1"
                )
                .await
                .unwrap(),
            path
        );
        std::fs::write(&path, b"bad worker!").unwrap();
        assert!(manifest.installed(directory.path()).unwrap().is_none());
        let base = server(compressed).await;
        manifest
            .install_from(&http, directory.path(), &cancel, |_, _| {}, &base)
            .await
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"test worker");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn refuses_tampered_download_and_cleans_partial_files() {
        let (manifest, mut compressed) = fixture();
        compressed[0][12] ^= 1;
        let base = server(vec![compressed[0].clone()]).await;
        let directory = tempfile::tempdir().unwrap();
        let error = manifest
            .install_from(
                &reqwest::Client::new(),
                directory.path(),
                &AtomicBool::new(false),
                |_, _| {},
                &base,
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("checksum mismatch"));
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn component_updates_only_download_changed_files_and_prune_old_binaries() {
        let (old, _) = fixture();
        let directory = tempfile::tempdir().unwrap();
        let old_path = old.directory(directory.path());
        std::fs::create_dir(&old_path).unwrap();
        std::fs::write(old_path.join(WORKER), b"test worker").unwrap();
        std::fs::write(old_path.join(FIREWALL), b"test firewall helper").unwrap();
        let (mut new, mut compressed) = fixture();
        let raw = b"updated firewall helper";
        let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(raw).unwrap();
        compressed[1] = encoder.finish().unwrap();
        new.files[1].sha256 = hash(raw);
        new.files[1].bytes = raw.len() as u64;
        new.files[1].download_sha256 = hash(&compressed[1]);
        new.files[1].download_bytes = compressed[1].len() as u64;
        new.revision = hash(
            new.files
                .iter()
                .map(|file| format!("{}:{}:{}", file.name, file.sha256, file.bytes))
                .collect::<Vec<_>>()
                .join("\n")
                .as_bytes(),
        );
        let base = server(vec![compressed[1].clone()]).await;
        let total = std::sync::atomic::AtomicU64::new(0);
        new.install_from(
            &reqwest::Client::new(),
            directory.path(),
            &AtomicBool::new(false),
            |_, size| {
                total.store(size, Ordering::Relaxed);
            },
            &base,
        )
        .await
        .unwrap();
        assert_eq!(total.load(Ordering::Relaxed), compressed[1].len() as u64);
        assert!(new.installed(directory.path()).unwrap().is_some());
        assert!(!old_path.exists());
    }

    #[test]
    fn rejects_wrong_unpacked_hash_and_decompression_bombs() {
        let (manifest, compressed) = fixture();
        let directory = tempfile::tempdir().unwrap();
        let mut file = manifest.files[0].clone();
        file.sha256 = "0".repeat(64);
        assert!(unpack(
            &compressed[0],
            &directory.path().join("hash.exe"),
            &file,
            &AtomicBool::new(false)
        )
        .unwrap_err()
        .to_string()
        .contains("executable checksum"));
        file.bytes = 1;
        assert!(unpack(
            &compressed[0],
            &directory.path().join("bomb.exe"),
            &file,
            &AtomicBool::new(false)
        )
        .unwrap_err()
        .to_string()
        .contains("pinned executable size"));
    }

    #[tokio::test]
    async fn cancels_stalled_download_and_leaves_no_installation() {
        let (manifest, _) = fixture();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let directory = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        let http = reqwest::Client::new();
        let install = manifest.install_from(&http, directory.path(), &cancel, |_, _| {}, &base);
        let trigger = async {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            cancel.store(true, Ordering::Release);
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        };
        let (result, _) = tokio::join!(install, trigger);
        assert!(result.unwrap_err().to_string().contains("cancelled"));
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }
}
