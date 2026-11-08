//! Read-only discovery of screenshots belonging to registered instances.
use crate::Engine;
use anyhow::{bail, Context, Result};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use image::{ImageFormat, ImageReader};
use serde::Serialize;
use std::{
    io::Cursor,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

pub const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_PIXELS: u64 = 36_000_000;
// Do not decode a screenful of large PNGs concurrently while Minecraft is running.
static IMAGE_JOBS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
// Opening full images only reads/encodes bytes; it must not queue behind gallery decoders.
static FULL_IMAGE_JOBS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    pub id: String,
    pub profile_id: String,
    pub profile_name: String,
    pub name: String,
    pub created_at: u64,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub source: &'static str,
    pub from: Option<String>,
}
#[derive(Serialize)]
pub struct Library {
    pub items: Vec<Screenshot>,
    pub warnings: Vec<String>,
}

fn regular(path: &Path, directory: bool) -> Result<()> {
    let m = std::fs::symlink_metadata(path)?;
    if m.file_type().is_symlink() || (directory && !m.is_dir()) || (!directory && !m.is_file()) {
        bail!("Screenshot path is not a regular file or directory");
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            bail!("Linked screenshot paths are not supported");
        }
    }
    Ok(())
}
fn filename(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 240
        || value.contains(['/', '\\', ':', '\0'])
        || !Path::new(value)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        || !matches!(
            Path::new(value)
                .extension()
                .and_then(|v| v.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("png" | "jpg" | "jpeg" | "webp")
        )
    {
        bail!("Invalid screenshot filename");
    }
    Ok(())
}
fn token(profile: &str, name: &str) -> String {
    format!(
        "local:{profile}:{}",
        URL_SAFE_NO_PAD.encode(name.as_bytes())
    )
}
fn parse(id: &str) -> Result<(String, String)> {
    let parts: Vec<_> = id.split(':').collect();
    if parts.len() != 3 || parts[0] != "local" || id.len() > 512 {
        bail!("Invalid screenshot ID");
    }
    uuid::Uuid::parse_str(parts[1])?;
    let name = String::from_utf8(URL_SAFE_NO_PAD.decode(parts[2])?)?;
    filename(&name)?;
    Ok((parts[1].into(), name))
}

pub fn dimensions(bytes: &[u8]) -> Result<(u32, u32)> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_IMAGE_BYTES {
        bail!("Screenshot exceeds 25 MiB");
    }
    let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP)
    ) {
        bail!("Unsupported screenshot image");
    }
    let (w, h) = reader.into_dimensions()?;
    if w == 0 || h == 0 || w > 16384 || h > 16384 || u64::from(w) * u64::from(h) > MAX_PIXELS {
        bail!("Screenshot dimensions exceed the image limit");
    }
    Ok((w, h))
}

pub fn image_url(bytes: &[u8], thumbnail: bool) -> Result<String> {
    let (w, h) = dimensions(bytes)?;
    if !thumbnail {
        let mime = match image::guess_format(bytes)? {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpeg => "image/jpeg",
            _ => "image/webp",
        };
        return Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)));
    }
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(w);
    limits.max_image_height = Some(h);
    limits.max_alloc = Some(192 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode()?.thumbnail(640, 400).to_rgb8();
    let mut output = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 78).encode_image(&image)?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        STANDARD.encode(output)
    ))
}

impl Engine {
    fn screenshot_file(&self, id: &str) -> Result<(String, String, PathBuf)> {
        let (profile, name) = parse(id)?;
        let instance = self.instance(&profile)?;
        let directory = instance.join("screenshots");
        regular(&directory, true)?;
        let path = directory.join(&name);
        regular(&path, false)?;
        if std::fs::metadata(&path)?.len() > MAX_IMAGE_BYTES {
            bail!("Screenshot exceeds 25 MiB");
        }
        Ok((profile, name, path))
    }
    pub async fn screenshots(&self, profile_id: Option<&str>) -> Result<Library> {
        if let Some(id) = profile_id {
            self.profile(id).await?;
        }
        let profiles = self.db.lock().await.profiles.clone();
        let engine = self.clone();
        let filter = profile_id.map(str::to_owned);
        tokio::task::spawn_blocking(move || {
            let mut items = Vec::new();
            let mut warnings = Vec::new();
            for profile in profiles
                .iter()
                .filter(|p| filter.as_ref().is_none_or(|id| id == &p.id))
            {
                let result = (|| -> Result<()> {
                    let directory = engine.instance(&profile.id)?.join("screenshots");
                    if !directory.try_exists()? {
                        return Ok(());
                    }
                    regular(&directory, true)?;
                    for entry in std::fs::read_dir(directory)? {
                        let Ok(entry) = entry else { continue };
                        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                            continue;
                        };
                        if filename(&name).is_err() || regular(&entry.path(), false).is_err() {
                            continue;
                        }
                        let Ok(m) = entry.metadata() else { continue };
                        if m.len() > MAX_IMAGE_BYTES {
                            continue;
                        }
                        // Header inspection avoids decoding every image just to list it.
                        let Ok(reader) = ImageReader::open(entry.path())
                            .and_then(|reader| reader.with_guessed_format())
                        else {
                            continue;
                        };
                        let Ok((width, height)) = reader.into_dimensions() else {
                            continue;
                        };
                        if width == 0
                            || height == 0
                            || u64::from(width) * u64::from(height) > MAX_PIXELS
                        {
                            continue;
                        }
                        let created_at = m
                            .modified()
                            .unwrap_or(UNIX_EPOCH)
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        items.push(Screenshot {
                            id: token(&profile.id, &name),
                            profile_id: profile.id.clone(),
                            profile_name: profile.name.clone(),
                            name,
                            created_at,
                            bytes: m.len(),
                            width,
                            height,
                            source: "local",
                            from: None,
                        });
                        if items.len() >= 20_000 {
                            break;
                        }
                    }
                    Ok(())
                })();
                if result.is_err() {
                    warnings.push(profile.name.clone());
                }
                if items.len() >= 20_000 {
                    break;
                }
            }
            items.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(a.id.cmp(&b.id)));
            Ok(Library { items, warnings })
        })
        .await?
    }
    pub async fn screenshot_bytes(&self, id: &str) -> Result<Vec<u8>> {
        let (profile, _, path) = self.screenshot_file(id)?;
        self.profile(&profile).await?;
        let bytes = tokio::fs::read(path).await?;
        dimensions(&bytes)?;
        Ok(bytes)
    }
    pub async fn screenshot_image(&self, id: &str, thumbnail: bool) -> Result<String> {
        let jobs = if thumbnail {
            &IMAGE_JOBS
        } else {
            &FULL_IMAGE_JOBS
        };
        let _permit = jobs
            .acquire()
            .await
            .context("Screenshot decoder unavailable")?;
        let bytes = if let Some(id) = id.strip_prefix("received:") {
            #[cfg(windows)]
            {
                self.social.received_screenshot(id)?
            }
            #[cfg(not(windows))]
            {
                let _ = id;
                bail!("Social screenshots require Windows");
            }
        } else {
            self.screenshot_bytes(id).await?
        };
        tokio::task::spawn_blocking(move || image_url(&bytes, thumbnail)).await?
    }
    #[cfg(windows)]
    pub async fn send_screenshots(&self, friend: &str, ids: &[String]) -> Result<Vec<String>> {
        if ids.is_empty() || ids.len() > 10 {
            bail!("Select between 1 and 10 screenshots");
        }
        if ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len() {
            bail!("Duplicate screenshot selection");
        }
        let profiles = self.db.lock().await.profiles.clone();
        let mut images = Vec::new();
        let mut total = 0;
        for id in ids {
            let (profile, name, _) = self.screenshot_file(id)?;
            let bytes = self.screenshot_bytes(id).await?;
            total += bytes.len();
            if total > 100 * 1024 * 1024 {
                bail!("Screenshot batch exceeds 100 MiB");
            }
            let profile_name = profiles
                .iter()
                .find(|p| p.id == profile)
                .context("Screenshot instance no longer exists")?
                .name
                .clone();
            let (width, height) = dimensions(&bytes)?;
            images.push(aurum_social::photos::NewPhoto {
                source_id: Some(id.clone()),
                name,
                profile_name,
                width,
                height,
                bytes,
            });
        }
        let social = self.social.clone();
        let friend = friend.to_owned();
        tokio::task::spawn_blocking(move || social.queue_screenshots(&friend, images)).await?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn full_images_do_not_wait_for_busy_thumbnail_decoders() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../.test-data/screenshot-priority");
        std::fs::create_dir_all(&root).unwrap();
        let root = tempfile::tempdir_in(root).unwrap();
        let engine = Engine::new(root.path().into(), |_| {}).await.unwrap();
        let profile = engine
            .create_profile(
                "Preview priority".into(),
                "1.21.1".into(),
                crate::model::Loader::Vanilla,
                None,
                0,
            )
            .await
            .unwrap();
        let directory = engine.instance(&profile.id).unwrap().join("screenshots");
        std::fs::create_dir_all(&directory).unwrap();
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(64, 32)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        std::fs::write(directory.join("fixture.png"), bytes.into_inner()).unwrap();
        let id = token(&profile.id, "fixture.png");
        let _busy = IMAGE_JOBS.acquire_many(2).await.unwrap();
        let full = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            engine.screenshot_image(&id, false),
        )
        .await
        .expect("Full-size preview was blocked by gallery thumbnails")
        .unwrap();
        assert!(full.starts_with("data:image/png;base64,"));
    }
    #[test]
    fn screenshot_ids_reject_traversal_and_arbitrary_paths() {
        let id = uuid::Uuid::new_v4().to_string();
        for name in [
            "../secret.png",
            "a\\secret.png",
            "C:secret.png",
            "..",
            "x.exe",
        ] {
            assert!(parse(&token(&id, name)).is_err());
        }
        assert_eq!(
            parse(&token(&id, "2026-11-07_22.00.00.png")).unwrap().1,
            "2026-11-07_22.00.00.png"
        );
    }
    #[test]
    fn validates_real_images_and_generates_bounded_thumbnails() {
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1280, 720)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        assert_eq!(dimensions(bytes.get_ref()).unwrap(), (1280, 720));
        let url = image_url(bytes.get_ref(), true).unwrap();
        let output = STANDARD.decode(url.split_once(',').unwrap().1).unwrap();
        let image = image::load_from_memory(&output).unwrap();
        assert_eq!((image.width(), image.height()), (640, 360));
        assert!(dimensions(b"not an image").is_err());
    }
}
