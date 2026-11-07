//! Drop guards also run when a parallel sibling fails or an async future is cancelled.
use std::path::{Path, PathBuf};

pub(crate) struct Temporary {
    path: PathBuf,
    directory: bool,
}
impl Temporary {
    pub(crate) fn file(path: &Path) -> Self {
        Self {
            path: path.into(),
            directory: false,
        }
    }
    pub(crate) fn directory(path: &Path) -> Self {
        Self {
            path: path.into(),
            directory: true,
        }
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        if self.directory {
            let _ = std::fs::remove_dir_all(&self.path);
        } else {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn dropping_an_unfinished_future_removes_its_file() {
        let dir = {
            let test_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../.test-data/storage-maintenance");
            std::fs::create_dir_all(&test_root).unwrap();
            tempfile::tempdir_in(test_root).unwrap()
        };
        let file = dir.path().join("download.part");
        let future = async {
            let _guard = Temporary::file(&file);
            std::fs::write(&file, b"incomplete").unwrap();
            std::future::pending::<()>().await;
        };
        let mut future = Box::pin(future);
        assert!(futures_util::poll!(&mut future).is_pending());
        assert!(file.exists());
        drop(future);
        assert!(!file.exists());
    }
}
