//! Reuse exact-major runtimes; only discard an archive after its extracted Java works.
use crate::{minecraft::java_version, Engine};
use anyhow::Result;
use std::path::{Path, PathBuf};

pub(crate) fn find_java(root: &Path) -> Option<PathBuf> {
    walkdir::WalkDir::new(root)
        .max_depth(4)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .find(|e| {
            e.file_type().is_file()
                && e.file_name() == if cfg!(windows) { "java.exe" } else { "java" }
        })
        .map(|e| e.into_path())
}

pub(crate) fn installed_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![];
    for name in ["JAVA_HOME", "JDK_HOME"] {
        if let Some(root) = std::env::var_os(name) {
            candidates.push(PathBuf::from(root).join("bin").join(if cfg!(windows) {
                "java.exe"
            } else {
                "java"
            }));
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&paths).filter(|p| p.is_absolute()) {
            candidates.push(path.join(if cfg!(windows) { "java.exe" } else { "java" }));
        }
    }
    #[cfg(windows)]
    if let Some(programs) = std::env::var_os("ProgramFiles") {
        for vendor in [
            "Eclipse Adoptium",
            "Java",
            "Microsoft",
            "Amazon Corretto",
            "BellSoft",
            "Zulu",
        ] {
            let root = PathBuf::from(&programs).join(vendor);
            if let Ok(entries) = std::fs::read_dir(&root) {
                for entry in entries.flatten() {
                    candidates.push(entry.path().join("bin/java.exe"));
                }
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|p| {
        p.is_file() && seen.insert(std::fs::canonicalize(p).unwrap_or_else(|_| p.clone()))
    });
    candidates
}

fn matching_architecture(path: &Path) -> bool {
    let Ok(executable) = std::fs::canonicalize(path) else {
        return false;
    };
    let Some(home) = executable.parent().and_then(Path::parent) else {
        return false;
    };
    let Ok(release) = std::fs::read_to_string(home.join("release")) else {
        return false;
    };
    let architecture = release
        .lines()
        .find_map(|line| line.strip_prefix("OS_ARCH="))
        .unwrap_or("")
        .trim_matches('"');
    match std::env::consts::ARCH {
        "x86_64" => matches!(architecture, "amd64" | "x86_64"),
        "aarch64" => matches!(architecture, "aarch64" | "arm64"),
        arch => architecture == arch,
    }
}

impl Engine {
    async fn compatible_installed_java(&self, path: &Path, major: u32) -> bool {
        matching_architecture(path) && self.cached_java_version(path).await.ok() == Some(major)
    }
    pub(crate) async fn installed_java(&self, major: u32) -> Option<PathBuf> {
        for path in installed_candidates() {
            // A newer major is not interchangeable with the major Minecraft requested.
            if self.compatible_installed_java(&path, major).await {
                return Some(path);
            }
        }
        None
    }

    pub async fn clean_java_archives(&self) -> Result<u64> {
        let directory = self.root.join("runtimes");
        if directory.exists()
            && !std::fs::canonicalize(&directory)?.starts_with(std::fs::canonicalize(&self.root)?)
        {
            return Ok(0);
        }
        let Ok(entries) = std::fs::read_dir(&directory) else {
            return Ok(0);
        };
        let mut removed = 0;
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name();
            let Some(major) = name
                .to_str()
                .and_then(|s| s.strip_prefix("java-"))
                .and_then(|s| s.strip_suffix(".zip"))
                .and_then(|s| s.parse::<u32>().ok())
            else {
                continue;
            };
            if !entry.file_type()?.is_file() {
                continue;
            }
            let runtime = directory.join(format!("java-{major}"));
            let Some(java) = find_java(&runtime) else {
                continue;
            };
            // Preserve archives for incomplete/broken installations and never follow a linked runtime.
            let resolved = std::fs::canonicalize(&runtime)?;
            let java_resolved = std::fs::canonicalize(&java)?;
            if !resolved.starts_with(std::fs::canonicalize(&directory)?)
                || !java_resolved.starts_with(&resolved)
                || java_version(&java).await.ok() != Some(major)
            {
                continue;
            }
            let bytes = entry.metadata()?.len();
            if std::fs::remove_file(entry.path()).is_ok() {
                removed += bytes;
            }
        }
        Ok(removed)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    fn fixture_java(root: &Path, major: u32, exit: i32) -> PathBuf {
        std::fs::create_dir_all(root.join("bin")).unwrap();
        let source = root.join("fixture.cs");
        std::fs::write(&source, format!(r#"class Fixture {{ static int Main() {{ System.Console.Error.WriteLine("openjdk version \"{major}.0.1\""); return {exit}; }} }}"#)).unwrap();
        let executable = root.join("bin/java.exe");
        let compiler = PathBuf::from(std::env::var_os("WINDIR").unwrap())
            .join("Microsoft.NET/Framework64/v4.0.30319/csc.exe");
        let output = std::process::Command::new(compiler)
            .creation_flags(0x08000000)
            .args(["/nologo", "/target:exe"])
            .arg(format!("/out:{}", executable.display()))
            .arg(source)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        std::fs::write(
            root.join("release"),
            format!("OS_ARCH=\"{}\"", std::env::consts::ARCH),
        )
        .unwrap();
        executable
    }
    #[tokio::test]
    async fn cleanup_requires_a_working_matching_runtime_and_preserves_other_archives() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/java-storage");
        std::fs::create_dir_all(&fixtures).unwrap();
        let temp = tempfile::tempdir_in(fixtures).unwrap();
        let engine = Engine::new(temp.path().to_path_buf(), |_| {})
            .await
            .unwrap();
        let runtimes = temp.path().join("runtimes");
        let java = fixture_java(&runtimes.join("java-21"), 21, 0);
        fixture_java(&runtimes.join("java-17"), 17, 1);
        for file in ["java-21.zip", "java-17.zip", "java-8.zip", "keep.zip"] {
            std::fs::write(runtimes.join(file), b"archive").unwrap();
        }
        assert!(engine.compatible_installed_java(&java, 21).await);
        assert!(!engine.compatible_installed_java(&java, 8).await);
        assert_eq!(engine.clean_java_archives().await.unwrap(), 7);
        assert!(!runtimes.join("java-21.zip").exists());
        for file in ["java-17.zip", "java-8.zip", "keep.zip"] {
            assert!(runtimes.join(file).exists());
        }
        assert!(java.exists());
        std::fs::write(runtimes.join("java-21/release"), "OS_ARCH=\"unsupported\"").unwrap();
        assert!(!engine.compatible_installed_java(&java, 21).await);
    }
}
