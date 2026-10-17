use crate::{minecraft::extract_zip, Engine, Task};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FileStamp {
    length: u64,
    modified: SystemTime,
}

impl FileStamp {
    fn read(path: &Path) -> Result<Self> {
        let metadata = std::fs::metadata(path)?;
        if !metadata.is_file() {
            bail!("Ожидался файл: {}", path.display());
        }
        Ok(Self {
            length: metadata.len(),
            modified: metadata.modified()?,
        })
    }
}

pub(crate) type JavaVersionCache = HashMap<PathBuf, (FileStamp, Option<FileStamp>, u32)>;

impl Engine {
    pub(crate) async fn cached_java_version(&self, path: &Path) -> Result<u32> {
        let executable = FileStamp::read(path)?;
        let release = path
            .parent()
            .and_then(Path::parent)
            .and_then(|root| FileStamp::read(&root.join("release")).ok());
        if let Some((cached_executable, cached_release, version)) =
            self.java_versions.lock().await.get(path)
        {
            if *cached_executable == executable && *cached_release == release {
                return Ok(*version);
            }
        }
        let version = crate::minecraft::java_version(path).await?;
        self.java_versions
            .lock()
            .await
            .insert(path.into(), (executable, release, version));
        Ok(version)
    }
}

#[derive(Serialize, Deserialize)]
struct NativeCache {
    version: u32,
    sources: Vec<(PathBuf, FileStamp)>,
    files: HashMap<PathBuf, FileStamp>,
}

pub(crate) fn native_entry(name: &str) -> bool {
    !name.starts_with("META-INF/")
        && [".dll", ".so", ".dylib", ".jnilib"]
            .iter()
            .any(|extension| name.ends_with(extension))
}

pub(crate) fn prepare_natives(archives: &[PathBuf], target: &Path, task: &Task) -> Result<()> {
    task.check()?;
    if archives.is_empty() {
        std::fs::create_dir_all(target)?;
        return Ok(());
    }
    let sources = archives
        .iter()
        .map(|path| Ok((path.clone(), FileStamp::read(path)?)))
        .collect::<Result<Vec<_>>>()?;
    let marker = target.join(".aurum-native-cache.json");
    if let Ok(bytes) = std::fs::read(&marker) {
        if let Ok(cache) = serde_json::from_slice::<NativeCache>(&bytes) {
            if cache.version == 1
                && cache.sources == sources
                && cache.files.iter().all(|(relative, expected)| {
                    crate::safe_join(target, &relative.to_string_lossy())
                        .and_then(|path| FileStamp::read(&path))
                        .is_ok_and(|actual| actual == *expected)
                })
            {
                return Ok(());
            }
        }
    }
    match std::fs::remove_file(&marker) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let mut files = HashMap::new();
    for archive in archives {
        extract_zip(archive, target, Some("native"), task)?;
        let mut zip = zip::ZipArchive::new(std::fs::File::open(archive)?)?;
        for index in 0..zip.len() {
            let entry = zip.by_index(index)?;
            if native_entry(entry.name()) {
                files.insert(PathBuf::from(entry.name()), ());
            }
        }
    }
    let files = files
        .into_keys()
        .map(|relative| {
            let path = crate::safe_join(target, &relative.to_string_lossy())?;
            Ok((relative, FileStamp::read(&path)?))
        })
        .collect::<Result<HashMap<_, _>>>()?;
    for (path, expected) in &sources {
        if FileStamp::read(path)? != *expected {
            bail!("Библиотека изменилась во время подготовки запуска; попробуйте снова")
        }
    }
    task.check()?;
    std::fs::write(
        marker,
        serde_json::to_vec(&NativeCache {
            version: 1,
            sources,
            files,
        })?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Write,
        sync::{atomic::AtomicBool, Arc},
        time::{Duration, UNIX_EPOCH},
    };

    fn task() -> Task {
        Task {
            id: uuid::Uuid::new_v4().to_string(),
            profile_id: None,
            cancel: Arc::new(AtomicBool::new(false)),
            emit: Arc::new(|_| {}),
        }
    }

    fn archive(path: &Path, content: &[u8]) {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        for name in ["bin/example.dll", "META-INF/ignored.dll", "readme.txt"] {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(content).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn native_cache_preserves_files_and_survives_reopening() {
        let root = tempfile::tempdir().unwrap();
        let archive_path = root.path().join("natives.jar");
        archive(&archive_path, b"original");
        let archives = vec![archive_path];
        let target = root.path().join("natives");
        prepare_natives(&archives, &target, &task()).unwrap();
        let extracted = target.join("bin/example.dll");
        let stamp = FileStamp::read(&extracted).unwrap();
        assert!(!target.join("META-INF/ignored.dll").exists());
        assert!(!target.join("readme.txt").exists());
        prepare_natives(&archives, &target, &task()).unwrap();
        assert_eq!(FileStamp::read(&extracted).unwrap(), stamp);
        assert_eq!(std::fs::read(extracted).unwrap(), b"original");
    }

    #[test]
    fn native_cache_repairs_deleted_and_modified_outputs() {
        let root = tempfile::tempdir().unwrap();
        let archive_path = root.path().join("natives.jar");
        archive(&archive_path, b"original");
        let archives = vec![archive_path];
        let target = root.path().join("natives");
        let extracted = target.join("bin/example.dll");
        prepare_natives(&archives, &target, &task()).unwrap();
        std::fs::remove_file(&extracted).unwrap();
        prepare_natives(&archives, &target, &task()).unwrap();
        assert_eq!(std::fs::read(&extracted).unwrap(), b"original");
        std::fs::write(&extracted, b"modified").unwrap();
        std::fs::OpenOptions::new()
            .write(true)
            .open(&extracted)
            .unwrap()
            .set_modified(UNIX_EPOCH + Duration::from_secs(100))
            .unwrap();
        prepare_natives(&archives, &target, &task()).unwrap();
        assert_eq!(std::fs::read(extracted).unwrap(), b"original");
    }

    #[test]
    fn native_cache_invalidates_changed_archives_and_broken_markers() {
        let root = tempfile::tempdir().unwrap();
        let archive_path = root.path().join("natives.jar");
        archive(&archive_path, b"original");
        let archives = vec![archive_path.clone()];
        let target = root.path().join("natives");
        prepare_natives(&archives, &target, &task()).unwrap();
        archive(&archive_path, b"updated content");
        prepare_natives(&archives, &target, &task()).unwrap();
        assert_eq!(
            std::fs::read(target.join("bin/example.dll")).unwrap(),
            b"updated content"
        );
        std::fs::write(target.join(".aurum-native-cache.json"), b"broken").unwrap();
        prepare_natives(&archives, &target, &task()).unwrap();
        let marker = std::fs::read(target.join(".aurum-native-cache.json")).unwrap();
        assert!(serde_json::from_slice::<NativeCache>(&marker).is_ok());
        std::fs::remove_file(archive_path).unwrap();
        assert!(prepare_natives(&archives, &target, &task()).is_err());
    }

    #[test]
    fn failed_extraction_is_not_cached_and_can_be_retried() {
        let root = tempfile::tempdir().unwrap();
        let archive_path = root.path().join("natives.jar");
        let archives = vec![archive_path.clone()];
        let target = root.path().join("natives");
        archive(&archive_path, b"original");
        prepare_natives(&archives, &target, &task()).unwrap();
        std::fs::write(&archive_path, b"invalid zip").unwrap();
        assert!(prepare_natives(&archives, &target, &task()).is_err());
        assert!(!target.join(".aurum-native-cache.json").exists());
        archive(&archive_path, b"repaired");
        prepare_natives(&archives, &target, &task()).unwrap();
        assert_eq!(
            std::fs::read(target.join("bin/example.dll")).unwrap(),
            b"repaired"
        );
    }

    #[test]
    fn native_cache_respects_archive_order_and_cancellation() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("first.jar");
        let second = root.path().join("second.jar");
        archive(&first, b"first");
        archive(&second, b"second");
        let target = root.path().join("natives");
        prepare_natives(&[first.clone(), second.clone()], &target, &task()).unwrap();
        assert_eq!(
            std::fs::read(target.join("bin/example.dll")).unwrap(),
            b"second"
        );
        prepare_natives(&[second, first], &target, &task()).unwrap();
        assert_eq!(
            std::fs::read(target.join("bin/example.dll")).unwrap(),
            b"first"
        );
        let task = task();
        task.cancel
            .store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(prepare_natives(&[], &target, &task).is_err());
    }

    #[tokio::test]
    async fn java_cache_reuses_version_but_rejects_changed_or_missing_executables() {
        let root = tempfile::tempdir().unwrap();
        let engine = Engine::new(root.path().join("data"), |_| {}).await.unwrap();
        let executable = root.path().join("java.fixture");
        std::fs::write(&executable, b"not executable").unwrap();
        let stamp = FileStamp::read(&executable).unwrap();
        engine
            .java_versions
            .lock()
            .await
            .insert(executable.clone(), (stamp, None, 8));
        assert_eq!(engine.cached_java_version(&executable).await.unwrap(), 8);
        engine.db.lock().await.settings.java_path = executable.to_string_lossy().into();
        assert!(engine
            .java(21, &task())
            .await
            .unwrap_err()
            .to_string()
            .contains("Java 8"));
        std::fs::write(&executable, b"changed executable").unwrap();
        assert!(engine.cached_java_version(&executable).await.is_err());
        std::fs::remove_file(&executable).unwrap();
        assert!(engine.cached_java_version(&executable).await.is_err());
    }

    #[tokio::test]
    async fn java_cache_invalidates_runtime_release_changes() {
        let root = tempfile::tempdir().unwrap();
        let engine = Engine::new(root.path().join("data"), |_| {}).await.unwrap();
        let runtime = root.path().join("runtime");
        std::fs::create_dir_all(runtime.join("bin")).unwrap();
        let executable = runtime.join("bin/java.fixture");
        std::fs::write(&executable, b"not executable").unwrap();
        let release = runtime.join("release");
        std::fs::write(&release, b"JAVA_VERSION=21").unwrap();
        engine.java_versions.lock().await.insert(
            executable.clone(),
            (
                FileStamp::read(&executable).unwrap(),
                Some(FileStamp::read(&release).unwrap()),
                21,
            ),
        );
        assert_eq!(engine.cached_java_version(&executable).await.unwrap(), 21);
        std::fs::write(release, b"JAVA_VERSION=25.0.1").unwrap();
        assert!(engine.cached_java_version(&executable).await.is_err());
    }
}
