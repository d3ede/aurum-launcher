//! Optional, explicit disposal of an imported original, after content verification.
use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(PartialEq, Eq)]
struct Stamp {
    length: u64,
    modified: std::time::SystemTime,
    digest: Option<Vec<u8>>,
}

pub(crate) struct ImportSnapshot {
    source: PathBuf,
    entries: BTreeMap<PathBuf, Stamp>,
}

fn digest(path: &Path) -> Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hash.finalize().to_vec())
}

impl ImportSnapshot {
    pub(crate) fn capture(source: &Path) -> Result<Self> {
        if std::fs::symlink_metadata(source)?.file_type().is_symlink() {
            bail!("Оригинал со ссылками нужно удалить вручную")
        }
        let source = std::fs::canonicalize(source)?;
        if source.parent().is_none() {
            bail!("Нельзя удалять корень диска")
        }
        if crate::processes::directories_running(vec![source.clone()]) {
            bail!("Закройте игру перед импортом с удалением оригинала")
        }
        let mut entries = BTreeMap::new();
        for entry in walkdir::WalkDir::new(&source).follow_links(false) {
            let entry = entry?;
            if entry.file_type().is_symlink() {
                bail!("Оригинал со ссылками нужно удалить вручную")
            }
            let metadata = entry.metadata()?;
            entries.insert(
                entry.path().strip_prefix(&source)?.to_path_buf(),
                Stamp {
                    length: if metadata.is_file() {
                        metadata.len()
                    } else {
                        0
                    },
                    modified: metadata.modified()?,
                    digest: if metadata.is_file() {
                        Some(digest(entry.path())?)
                    } else {
                        None
                    },
                },
            );
        }
        Ok(Self { source, entries })
    }

    pub(crate) fn verify(&self, destination: &Path, skipped: impl Fn(&Path) -> bool) -> Result<()> {
        let current = Self::capture(&self.source)?;
        if current.entries != self.entries {
            bail!("Оригинал изменился; он сохранён. Копия в Aurum доступна")
        }
        for (relative, stamp) in &self.entries {
            if skipped(relative) {
                continue;
            }
            if let Some(expected) = &stamp.digest {
                if digest(&destination.join(relative)).ok().as_ref() != Some(expected) {
                    bail!(
                        "Копия {} не прошла проверку; оригинал сохранён",
                        relative.display()
                    )
                }
            }
        }
        Ok(())
    }

    pub(crate) fn recycle(
        self,
        destination: &Path,
        skipped: impl Fn(&Path) -> bool,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<()> {
        self.verify(destination, skipped)?;
        // Verification may take time for large worlds; honour cancellation again at the commit boundary.
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            bail!("Удаление оригинала отменено; обе копии сохранены")
        }
        recycle(&self.source)
            .context("Не удалось отправить оригинал в корзину; копия в Aurum сохранена")
    }
}

#[cfg(windows)]
fn recycle(path: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::{System::Com::*, UI::Shell::*},
    };
    // Shell parsing names must not contain Rust's canonical verbatim prefix.
    let shell_path = path.to_string_lossy();
    let shell_path = if let Some(unc) = shell_path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        shell_path
            .strip_prefix(r"\\?\")
            .unwrap_or(&shell_path)
            .to_owned()
    };
    let wide: Vec<u16> = std::ffi::OsStr::new(&shell_path)
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let result = (|| -> Result<()> {
            let operation: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)?;
            // Never silently fall back to permanent deletion on a volume without a recycle bin.
            operation.SetOperationFlags(
                FOF_NO_UI | FOF_WANTNUKEWARNING | FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE,
            )?;
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)?;
            operation.DeleteItem(&item, None)?;
            operation.PerformOperations()?;
            if operation.GetAnyOperationsAborted()?.as_bool() {
                bail!("Windows отменил удаление оригинала")
            }
            Ok(())
        })();
        CoUninitialize();
        result
    }
}

#[cfg(not(windows))]
fn recycle(_: &Path) -> Result<()> {
    bail!("Удалите оригинал вручную: корзина поддерживается только в Windows")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changed_missing_or_different_files_preserve_original() {
        let fixtures =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/import-cleanup");
        std::fs::create_dir_all(&fixtures).unwrap();
        let temp = tempfile::tempdir_in(fixtures).unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(source.join("world"), b"save").unwrap();
        let snapshot = ImportSnapshot::capture(&source).unwrap();
        assert!(snapshot.verify(&target, |_| false).is_err());
        std::fs::write(target.join("world"), b"save").unwrap();
        snapshot.verify(&target, |_| false).unwrap();
        std::fs::write(source.join("world"), b"edit").unwrap();
        assert!(snapshot.verify(&target, |_| false).is_err());
        assert!(source.join("world").exists());
    }

    #[test]
    fn cancelled_disposal_keeps_both_verified_copies() {
        let fixtures =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/import-cleanup");
        std::fs::create_dir_all(&fixtures).unwrap();
        let temp = tempfile::tempdir_in(fixtures).unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(source.join("world"), b"save").unwrap();
        std::fs::write(target.join("world"), b"save").unwrap();
        let snapshot = ImportSnapshot::capture(&source).unwrap();
        let cancel = std::sync::atomic::AtomicBool::new(true);
        assert!(snapshot
            .recycle(&target, |_| false, &cancel)
            .unwrap_err()
            .to_string()
            .contains("отменено"));
        assert!(source.join("world").is_file());
        assert!(target.join("world").is_file());
    }
}
