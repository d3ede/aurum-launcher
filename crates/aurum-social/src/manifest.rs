//! A strict portable Java manifest, intentionally separate from general pack import.
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::Read,
    path::{Component, Path},
};
pub const MAX_MANIFEST: usize = 2 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub version: u8,
    pub name: String,
    pub minecraft: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub files: Vec<SharedFile>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub provider: String,
    pub project_id: String,
    pub version_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
    pub source: Option<Source>,
    pub config: Option<Vec<u8>>,
}
impl Manifest {
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_MANIFEST {
            bail!("Shared manifest exceeds 2 MiB");
        }
        let manifest: Self = serde_json::from_slice(bytes)?;
        manifest.validate()?;
        Ok(manifest)
    }
    pub fn validate(&self) -> Result<()> {
        if self.version != 1
            || self.name.chars().count() > 80
            || self.name.chars().any(char::is_control)
            || self.minecraft.is_empty()
            || self.minecraft.len() > 64
            || !self
                .minecraft
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        {
            bail!("Invalid shared profile metadata");
        }
        if !["vanilla", "fabric", "forge", "neoforge", "quilt"].contains(&self.loader.as_str()) {
            bail!("Social currently supports Java profiles only");
        }
        if let Some(v) = &self.loader_version {
            if v.len() > 100
                || !v
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-+".contains(&c))
            {
                bail!("Invalid loader version");
            }
        }
        if self.files.len() > 2000 {
            bail!("Shared profile exceeds 2000 files");
        }
        let mut paths = HashSet::new();
        let mut config_bytes = 0usize;
        let mut total = 0u64;
        for file in &self.files {
            safe_path(&file.path)?;
            if !paths.insert(file.path.to_ascii_lowercase()) {
                bail!("Duplicate or case-colliding shared path");
            }
            if file.sha256.len() != 64 || !file.sha256.bytes().all(|c| c.is_ascii_hexdigit()) {
                bail!("Missing SHA-256 integrity hash");
            }
            if file.bytes > 2 * 1024 * 1024 * 1024 {
                bail!("Shared file exceeds 2 GiB");
            }
            total = total
                .checked_add(file.bytes)
                .context("Shared size overflow")?;
            let config =
                file.path.starts_with("config/") || file.path.starts_with("defaultconfigs/");
            match (&file.config, config) {
                (Some(bytes), true) => {
                    if bytes.len() > 64 * 1024
                        || bytes.len() as u64 != file.bytes
                        || format!("{:x}", Sha256::digest(bytes))
                            != file.sha256.to_ascii_lowercase()
                    {
                        bail!("Invalid shared config bytes or hash");
                    }
                    config_bytes += bytes.len();
                    if config_bytes > 256 * 1024 {
                        bail!("Shared configs exceed 256 KiB");
                    }
                }
                (None, false) => {}
                _ => bail!("Shared config payload does not match its allowed root"),
            }
            if let Some(source) = &file.source {
                if config {
                    bail!("Configs cannot select a download source");
                }
                let valid = |s: &str| {
                    !s.is_empty()
                        && s.len() <= 128
                        && s.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                };
                if !["modrinth", "curseforge"].contains(&source.provider.as_str())
                    || !valid(&source.project_id)
                    || !valid(&source.version_id)
                {
                    bail!("Unsupported shared content source");
                }
                if source.provider == "curseforge"
                    && (!source.project_id.bytes().all(|c| c.is_ascii_digit())
                        || !source.version_id.bytes().all(|c| c.is_ascii_digit()))
                {
                    bail!("Invalid CurseForge source IDs");
                }
            }
        }
        if total > 32 * 1024 * 1024 * 1024 {
            bail!("Shared profile exceeds 32 GiB");
        }
        if serde_json::to_vec(self)?.len() > MAX_MANIFEST {
            bail!("Shared manifest exceeds 2 MiB");
        }
        Ok(())
    }
    pub fn digest(&self) -> Result<String> {
        self.validate()?;
        Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(self)?)))
    }
}
pub fn safe_path(value: &str) -> Result<()> {
    if value.len() > 240
        || value.contains(['\\', ':', '\0'])
        || value.starts_with('/')
        || !value.contains('/')
    {
        bail!("Invalid shared relative path");
    }
    let mut parts = value.split('/');
    let root = parts.next().unwrap_or_default();
    if ![
        "mods",
        "resourcepacks",
        "shaderpacks",
        "config",
        "defaultconfigs",
    ]
    .contains(&root)
    {
        bail!("Shared path is outside allowed roots");
    }
    for part in parts {
        let stem = part
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with([' ', '.'])
            || part
                .chars()
                .any(|c| c.is_control() || "<>\"|?*".contains(c))
            || [
                "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
                "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
                "LPT9",
            ]
            .contains(&stem.as_str())
        {
            bail!("Unsafe shared path segment");
        }
    }
    if !Path::new(value)
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
    {
        bail!("Unsafe shared path");
    }
    Ok(())
}
pub fn no_links(root: &Path, relative: &str) -> Result<std::path::PathBuf> {
    safe_path(relative)?;
    let mut path = root.to_owned();
    check_regular(&path, true)?;
    for component in Path::new(relative).components() {
        path.push(component);
        check_regular(&path, false)?;
    }
    Ok(path)
}
fn check_regular(path: &Path, root: bool) -> Result<()> {
    let m = std::fs::symlink_metadata(path)?;
    if m.file_type().is_symlink() {
        bail!("Linked files cannot be shared");
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            bail!("Reparse points cannot be shared");
        }
    }
    if root && !m.is_dir() {
        bail!("Shared profile root is not a directory");
    }
    Ok(())
}
pub fn hash_file(path: &Path) -> Result<String> {
    hash_file_checked(path, || Ok(()))
}
pub fn hash_file_checked(path: &Path, check: impl Fn() -> Result<()>) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        check()?;
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn potential_secret(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    [
        "access_token",
        "refresh_token",
        "api_key",
        "apikey",
        "authorization",
        "bearer ",
        "password",
        "private_key",
        "private key",
        "client_secret",
        "webhook",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn refuses_real_directory_junctions() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("instance");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(root.join("config")).unwrap();
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("secret.toml"), b"test secret").unwrap();
        let junction = root.join("config/linked");
        let cmd = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let status = std::process::Command::new(cmd)
            .args(["-NoProfile","-NonInteractive","-Command","New-Item -ItemType Junction -Path $env:AURUM_TEST_JUNCTION -Value $env:AURUM_TEST_TARGET -ErrorAction Stop | Out-Null"])
            .env("AURUM_TEST_JUNCTION",&junction)
            .env("AURUM_TEST_TARGET",&outside)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
        assert!(no_links(&root, "config/linked/secret.toml").is_err());
        std::fs::remove_dir(&junction).unwrap();
        assert!(outside.join("secret.toml").exists());
    }
    #[test]
    fn rejects_windows_paths_traversal_and_secrets() {
        for path in [
            "../token",
            "config/../auth.json",
            "mods/x.jar:evil",
            "mods/NUL.jar",
            "saves/world/level.dat",
            "config/a\\b",
            "mods/a.",
            "/mods/a",
            "mods//a",
        ] {
            assert!(safe_path(path).is_err(), "{path}");
        }
        assert!(safe_path("mods/fabric-api.jar").is_ok());
        assert!(potential_secret(b"api_key = 'fixture'"));
    }
    #[test]
    fn rejects_unexpected_fields_and_oversize() {
        assert!(Manifest::decode(&vec![0; MAX_MANIFEST + 1]).is_err());
        assert!(Manifest::decode(br#"{"version":1,"name":"x","minecraft":"1.21","loader":"vanilla","loaderVersion":null,"files":[],"command":"cmd.exe"}"#).is_err());
    }
    #[test]
    fn config_hash_is_required() {
        let mut m = Manifest {
            version: 1,
            name: "fixture".into(),
            minecraft: "1.21".into(),
            loader: "vanilla".into(),
            loader_version: None,
            files: vec![SharedFile {
                path: "config/test.toml".into(),
                bytes: 1,
                sha256: "0".repeat(64),
                source: None,
                config: Some(vec![1]),
            }],
        };
        assert!(m.validate().is_err());
        m.files[0].sha256 = format!("{:x}", Sha256::digest([1]));
        assert!(m.validate().is_ok());
    }
    proptest::proptest! {#[test]fn path_parser_never_panics(value in ".{0,300}"){let _=safe_path(&value);}}
}
