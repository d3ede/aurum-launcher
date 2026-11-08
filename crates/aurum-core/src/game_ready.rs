//! Only the current JVM's unobstructed title-screen signal means it is ready.
use std::path::Path;
use tokio::io::AsyncReadExt;

pub(crate) async fn consume(path: &Path) -> bool {
    let Ok(file) = tokio::fs::File::open(path).await else {
        return false;
    };
    let mut bytes = Vec::with_capacity(7);
    if file.take(7).read_to_end(&mut bytes).await.is_err() || bytes != b"ready\n" {
        return false;
    }
    let _ = tokio::fs::remove_file(path).await;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn only_the_current_sessions_exact_signal_is_consumed() {
        let directory = tempfile::tempdir().unwrap();
        let old = directory.path().join("old-session.ready");
        let current = directory.path().join("current-session.ready");
        tokio::fs::write(&old, b"ready\n").await.unwrap();
        assert!(!consume(&current).await);
        for incomplete in [b"running".as_slice(), b"ready", b"ready\nextra", b""] {
            tokio::fs::write(&current, incomplete).await.unwrap();
            assert!(!consume(&current).await);
        }
        tokio::fs::write(&current, b"ready\n").await.unwrap();
        assert!(consume(&current).await);
        assert!(!consume(&current).await);
        assert!(old.is_file());
    }
}
