//! Avatars are normalized JPEG bytes carried in signed control messages, never URLs.
use anyhow::{bail, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
pub fn validate_avatar(value: &Option<String>) -> Result<()> {
    if let Some(value) = value {
        if value.len() > 3250 {
            bail!("Avatar exceeds limit");
        }
        let encoded = value
            .strip_prefix("data:image/jpeg;base64,")
            .ok_or_else(|| anyhow::anyhow!("Unsupported avatar format"))?;
        let bytes = STANDARD.decode(encoded)?;
        if bytes.len() > 2400 {
            bail!("Avatar exceeds limit");
        }
        let mut reader =
            image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Jpeg);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(64);
        limits.max_image_height = Some(64);
        limits.max_alloc = Some(1024 * 1024);
        reader.limits(limits);
        reader.decode()?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_urls_invalid_images_and_oversized_dimensions() {
        for value in [
            "https://example.com/a.jpg",
            "data:image/svg+xml;base64,PHN2Zz4=",
            "data:image/jpeg;base64,AA==",
        ] {
            assert!(validate_avatar(&Some(value.into())).is_err());
        }
        for dimension in [64, 65] {
            let image = image::RgbImage::new(dimension, dimension);
            let mut bytes = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 40)
                .encode_image(&image)
                .unwrap();
            let value = Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
            assert_eq!(validate_avatar(&value).is_ok(), dimension == 64);
        }
        assert!(validate_avatar(&Some("x".repeat(3251))).is_err());
    }
}
