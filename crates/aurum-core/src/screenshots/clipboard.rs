//! Native image clipboard support using the existing image decoder.
use anyhow::{bail, Context, Result};
use image::ImageReader;
use std::{io::Cursor, ptr, time::Duration};
use windows_sys::Win32::{
    Foundation::{GlobalFree, HGLOBAL},
    System::{
        DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
        Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
    },
};

fn prepare(bytes: &[u8]) -> Result<([u8; 124], Vec<u8>)> {
    let (width, height) = super::dimensions(bytes)?;
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(width);
    limits.max_image_height = Some(height);
    limits.max_alloc = Some(192 * 1024 * 1024);
    reader.limits(limits);
    let mut pixels = reader.decode()?.into_rgba8().into_raw();
    for pixel in pixels.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
    }
    // BITMAPV5HEADER: top-down BGRA with explicit alpha and sRGB masks.
    let mut header = [0u8; 124];
    for (offset, value) in [
        (0, 124),
        (4, width),
        (8, (-(height as i32)) as u32),
        (12, 1 | (32 << 16)),
        (16, 3), // BI_BITFIELDS
        (20, pixels.len() as u32),
        (40, 0x00ff0000),
        (44, 0x0000ff00),
        (48, 0x000000ff),
        (52, 0xff000000),
        (56, 0x73524742), // LCS_sRGB
        (108, 4),         // LCS_GM_IMAGES
    ] {
        header[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    Ok((header, pixels))
}

struct Allocation(HGLOBAL);
impl Drop for Allocation {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: this guard owns the unlocked allocation until Windows takes it.
            unsafe { GlobalFree(self.0) };
        }
    }
}
struct Clipboard;
impl Drop for Clipboard {
    fn drop(&mut self) {
        // SAFETY: constructed only after successfully opening this thread's clipboard.
        unsafe { CloseClipboard() };
    }
}

/// Copies actual pixels. `owner` must be the live launcher window handle.
pub fn copy_image(bytes: &[u8], owner: isize) -> Result<()> {
    if owner == 0 {
        bail!("Screenshot clipboard requires a launcher window");
    }
    let (header, pixels) = prepare(bytes)?;
    // SAFETY: allocate the exact combined size; all writes stay within the locked block.
    let mut allocation =
        Allocation(unsafe { GlobalAlloc(GMEM_MOVEABLE, header.len() + pixels.len()) });
    if allocation.0.is_null() {
        return Err(std::io::Error::last_os_error()).context("Allocate screenshot clipboard");
    }
    let target = unsafe { GlobalLock(allocation.0) } as *mut u8;
    if target.is_null() {
        return Err(std::io::Error::last_os_error()).context("Lock screenshot clipboard");
    }
    unsafe {
        ptr::copy_nonoverlapping(header.as_ptr(), target, header.len());
        ptr::copy_nonoverlapping(pixels.as_ptr(), target.add(header.len()), pixels.len());
        GlobalUnlock(allocation.0);
    }
    let mut opened = false;
    for _ in 0..10 {
        // SAFETY: the caller supplies the live launcher HWND, never a null owner.
        if unsafe { OpenClipboard(owner as _) } != 0 {
            opened = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    if !opened {
        bail!("Clipboard is busy; try copying the screenshot again");
    }
    let _clipboard = Clipboard;
    // Prepare and allocate everything before replacing the user's previous clipboard.
    if unsafe { EmptyClipboard() } == 0 {
        return Err(std::io::Error::last_os_error()).context("Empty screenshot clipboard");
    }
    // CF_DIBV5 transfers ownership of the movable allocation to Windows on success.
    if unsafe { SetClipboardData(17, allocation.0) }.is_null() {
        return Err(std::io::Error::last_os_error()).context("Copy screenshot pixels");
    }
    allocation.0 = ptr::null_mut();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clipboard_pixels_preserve_orientation_channels_and_alpha() {
        let image = image::RgbaImage::from_raw(1, 2, vec![1, 2, 3, 4, 10, 20, 30, 255]).unwrap();
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let (header, pixels) = prepare(bytes.get_ref()).unwrap();
        let field = |offset| u32::from_le_bytes(header[offset..offset + 4].try_into().unwrap());
        assert_eq!(field(0), 124);
        assert_eq!(field(4), 1);
        assert_eq!(field(8) as i32, -2);
        assert_eq!(field(12), 1 | (32 << 16));
        assert_eq!(field(20), 8);
        assert_eq!(field(52), 0xff000000);
        assert_eq!(pixels, [3, 2, 1, 4, 30, 20, 10, 255]);
    }
    #[test]
    fn invalid_images_and_missing_owner_fail_before_clipboard_access() {
        assert!(prepare(b"not an image").is_err());
        assert!(copy_image(b"", 0).is_err());
    }
}
