#[cfg(target_os = "linux")]
mod platform {
    use base64::Engine as _;

    fn clipboard() -> gtk::Clipboard {
        gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD)
    }

    pub(super) fn has_image() -> bool {
        clipboard().wait_for_image().is_some()
    }

    pub(super) fn read_text() -> Option<String> {
        clipboard().wait_for_text().map(|text| text.to_string())
    }

    pub(super) fn read_png() -> Result<String, String> {
        let image = clipboard()
            .wait_for_image()
            .ok_or_else(|| "剪贴板中没有可读取的图片".to_string())?;
        let png = image
            .save_to_bufferv("png", &[])
            .map_err(|error| format!("编码剪贴板图片失败：{error}"))?;
        if png.len() > 128 * 1024 * 1024 {
            return Err("剪贴板图片超过 128 MiB 限制".into());
        }
        Ok(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        ))
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use base64::Engine as _;
    use windows_sys::Win32::System::{DataExchange::*, Memory::*};

    const CF_DIB: u32 = 8;
    const CF_UNICODETEXT: u32 = 13;
    const CF_DIBV5: u32 = 17;
    const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

    fn png_format() -> u32 {
        const NAME: [u16; 4] = ['P' as u16, 'N' as u16, 'G' as u16, 0];
        unsafe { RegisterClipboardFormatW(NAME.as_ptr()) }
    }

    struct Clipboard;

    impl Clipboard {
        fn open() -> Result<Self, String> {
            for _ in 0..5 {
                if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                    return Ok(Self);
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err("无法打开剪贴板".into())
        }

        fn bytes(&self, format: u32) -> Option<Vec<u8>> {
            let handle = unsafe { GetClipboardData(format) };
            if handle.is_null() {
                return None;
            }
            let size = unsafe { GlobalSize(handle) };
            if size == 0 || size > 128 * 1024 * 1024 {
                return None;
            }
            let pointer = unsafe { GlobalLock(handle) };
            if pointer.is_null() {
                return None;
            }
            let bytes = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), size).to_vec() };
            unsafe { GlobalUnlock(handle) };
            Some(bytes)
        }
    }

    impl Drop for Clipboard {
        fn drop(&mut self) {
            unsafe { CloseClipboard() };
        }
    }

    pub(super) fn has_image() -> bool {
        let png = png_format();
        unsafe {
            (png != 0 && IsClipboardFormatAvailable(png) != 0)
                || IsClipboardFormatAvailable(CF_DIBV5) != 0
                || IsClipboardFormatAvailable(CF_DIB) != 0
        }
    }

    pub(super) fn read_text() -> Option<String> {
        let bytes = Clipboard::open().ok()?.bytes(CF_UNICODETEXT)?;
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .take_while(|unit| *unit != 0)
            .collect();
        String::from_utf16(&units).ok()
    }

    pub(super) fn read_png() -> Result<String, String> {
        let clipboard = Clipboard::open()?;
        let format = png_format();
        let png = (format != 0)
            .then(|| clipboard.bytes(format))
            .flatten()
            .filter(|bytes| bytes.starts_with(PNG_SIGNATURE));
        let png = if let Some(png) = png {
            png
        } else {
            let mut failure = "剪贴板中没有可读取的图片".to_string();
            let mut converted = None;
            for format in [CF_DIBV5, CF_DIB] {
                if let Some(dib) = clipboard.bytes(format) {
                    match dib_to_png(&dib) {
                        Ok(png) => {
                            converted = Some(png);
                            break;
                        }
                        Err(error) => failure = error,
                    }
                }
            }
            converted.ok_or(failure)?
        };
        Ok(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        ))
    }

    fn field(bytes: &[u8], offset: usize) -> Result<u32, String> {
        let raw: [u8; 4] = bytes
            .get(offset..offset + 4)
            .ok_or("剪贴板图片数据不完整")?
            .try_into()
            .map_err(|_| "剪贴板图片数据不完整")?;
        Ok(u32::from_le_bytes(raw))
    }

    fn channel(pixel: u32, mask: u32) -> u8 {
        if mask == 0 {
            return 255;
        }
        let shift = mask.trailing_zeros();
        let max = mask >> shift;
        (((pixel & mask) >> shift) as u64 * 255 / max as u64) as u8
    }

    fn dib_to_png(dib: &[u8]) -> Result<Vec<u8>, String> {
        let header_size = field(dib, 0)? as usize;
        if header_size < 40 || header_size > dib.len() {
            return Err("不支持的剪贴板图片格式".into());
        }
        let width = field(dib, 4)? as i32;
        let height = field(dib, 8)? as i32;
        let planes = u16::from_le_bytes([dib[12], dib[13]]);
        let depth = u16::from_le_bytes([dib[14], dib[15]]);
        let compression = field(dib, 16)?;
        if width <= 0
            || height == 0
            || planes != 1
            || !matches!(depth, 24 | 32)
            || !matches!(compression, 0 | 3)
        {
            return Err("不支持的剪贴板图片格式".into());
        }
        let rows = height.checked_abs().ok_or("剪贴板图片尺寸无效")? as usize;
        let width = width as usize;
        let pixel_count = width.checked_mul(rows).ok_or("剪贴板图片尺寸无效")?;
        let output_size = pixel_count.checked_mul(4).ok_or("剪贴板图片尺寸无效")?;
        if output_size > 128 * 1024 * 1024 {
            return Err("剪贴板图片超过 128 MiB 限制".into());
        }
        let stride = width
            .checked_mul(depth as usize)
            .and_then(|bits| bits.checked_add(31))
            .map(|bits| bits / 32 * 4)
            .ok_or("剪贴板图片尺寸无效")?;
        let mask_bytes = if compression == 3 && header_size == 40 {
            12
        } else {
            0
        };
        let palette_bytes = (field(dib, 32)? as usize)
            .checked_mul(4)
            .ok_or("剪贴板图片尺寸无效")?;
        let offset = header_size
            .checked_add(mask_bytes)
            .and_then(|size| size.checked_add(palette_bytes))
            .ok_or("剪贴板图片尺寸无效")?;
        let data_size = stride.checked_mul(rows).ok_or("剪贴板图片尺寸无效")?;
        if dib
            .get(offset..offset.checked_add(data_size).ok_or("剪贴板图片尺寸无效")?)
            .is_none()
        {
            return Err("剪贴板图片数据不完整".into());
        }
        let masks = if compression == 3 {
            [
                field(dib, 40)?,
                field(dib, 44)?,
                field(dib, 48)?,
                if header_size >= 108 {
                    field(dib, 52)?
                } else {
                    0
                },
            ]
        } else {
            [0x00ff0000, 0x0000ff00, 0x000000ff, 0]
        };
        let mut rgba = vec![0; output_size];
        for y in 0..rows {
            let source_y = if height > 0 { rows - 1 - y } else { y };
            for x in 0..width {
                let from = offset + source_y * stride + x * usize::from(depth / 8);
                let pixel = if depth == 32 {
                    u32::from_le_bytes(dib[from..from + 4].try_into().unwrap())
                } else {
                    u32::from_le_bytes([dib[from], dib[from + 1], dib[from + 2], 0])
                };
                let to = (y * width + x) * 4;
                rgba[to] = channel(pixel, masks[0]);
                rgba[to + 1] = channel(pixel, masks[1]);
                rgba[to + 2] = channel(pixel, masks[2]);
                rgba[to + 3] = channel(pixel, masks[3]);
            }
        }
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, width as u32, rows as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .and_then(|mut writer| writer.write_image_data(&rgba))
                .map_err(|error| format!("编码剪贴板图片失败：{error}"))?;
        }
        Ok(png)
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use base64::Engine as _;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSPasteboard, NSPasteboardTypePNG,
        NSPasteboardTypeString, NSPasteboardTypeTIFF,
    };
    use objc2_foundation::NSDictionary;

    pub(super) fn has_image() -> bool {
        let clipboard = NSPasteboard::generalPasteboard();
        clipboard
            .dataForType(unsafe { NSPasteboardTypePNG })
            .is_some()
            || clipboard
                .dataForType(unsafe { NSPasteboardTypeTIFF })
                .is_some()
    }

    pub(super) fn read_text() -> Option<String> {
        NSPasteboard::generalPasteboard()
            .stringForType(unsafe { NSPasteboardTypeString })
            .map(|text| text.to_string())
    }

    pub(super) fn read_png() -> Result<String, String> {
        let clipboard = NSPasteboard::generalPasteboard();
        let data = if let Some(png) = clipboard.dataForType(unsafe { NSPasteboardTypePNG }) {
            png
        } else {
            let tiff = clipboard
                .dataForType(unsafe { NSPasteboardTypeTIFF })
                .ok_or("剪贴板中没有可读取的图片")?;
            let image = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("无法读取剪贴板图片")?;
            let properties = NSDictionary::new();
            // Empty encoding options are valid for PNG output.
            unsafe {
                image.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
            }
            .ok_or("编码剪贴板图片失败")?
        };
        if data.len() > 128 * 1024 * 1024 {
            return Err("剪贴板图片超过 128 MiB 限制".into());
        }
        Ok(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(data.to_vec())
        ))
    }
}

pub(super) fn has_image() -> bool {
    platform::has_image()
}

pub(super) fn read_text() -> Option<String> {
    platform::read_text()
}

pub(super) fn read_png() -> Result<String, String> {
    platform::read_png()
}
