use super::render::{PageRect, RenderedDocument};
use crate::document::{ProjectDocument, ResourceBundle};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy)]
pub enum ImageFormat {
    Png,
    Jpeg,
}

impl ImageFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
        }
    }
}

/// Return the number of physical pages written. A multi-page document uses
/// `name-1.png`, `name-2.png`, etc.; a single page uses the chosen path.
pub fn export_images(
    target: &Path,
    document: &ProjectDocument,
    resources: &ResourceBundle,
    format: ImageFormat,
) -> Result<usize, String> {
    let directory = temporary_directory()?;
    let result = (|| {
        let seamless = document.layout.paper.mode == crate::document::PaperMode::Seamless;
        if seamless && matches!(format, ImageFormat::Png) {
            export_long_image(target, document, resources)?;
            return Ok(1);
        }
        let mut rendered = RenderedDocument::new(document, resources, seamless)?;
        for index in 0..rendered.pages.len() {
            let rect = rendered.pages[index];
            let bytes =
                rendered.capture(rect, matches!(format, ImageFormat::Jpeg), 150.0 / 96.0)?;
            std::fs::write(
                directory.join(format!("page-{}.{}", index + 1, format.extension())),
                bytes,
            )
            .map_err(|error| format!("生成第 {} 页图片失败：{error}", index + 1))?;
        }
        let pages = collect_pages(&directory, format)?;
        let count = pages.len();
        let mut staged_pages = Vec::with_capacity(count);
        for (index, source) in pages.into_iter().enumerate() {
            let destination = page_destination(target, index + 1, count, format);
            let staged = crate::storage::temporary_sibling(&destination);
            if let Err(error) = std::fs::copy(&source, &staged) {
                for (previous, _) in &staged_pages {
                    let _ = std::fs::remove_file(previous);
                }
                return Err(format!("暂存第 {} 页图片失败：{error}", index + 1));
            }
            if !staged.metadata().is_ok_and(|metadata| metadata.len() > 0) {
                let _ = std::fs::remove_file(&staged);
                for (previous, _) in &staged_pages {
                    let _ = std::fs::remove_file(previous);
                }
                return Err(format!("第 {} 页图片为空", index + 1));
            }
            staged_pages.push((staged, destination));
        }
        for (staged, destination) in staged_pages {
            crate::storage::replace_file(&staged, &destination)?;
        }
        Ok(count)
    })();
    let _ = std::fs::remove_dir_all(directory);
    result
}

/// Render in the editor's Seamless layout and stream vertical tiles into one
/// PNG. Neither paper gaps nor per-page furniture enter the continuous image.
pub fn export_long_image(
    target: &Path,
    document: &ProjectDocument,
    resources: &ResourceBundle,
) -> Result<(), String> {
    let mut rendered = RenderedDocument::new(document, resources, true)?;
    let page = rendered.pages[0];
    let css_width = page.width.ceil() as u32;
    let css_height = page.height.ceil() as u32;
    let width = css_width.checked_mul(2).ok_or("长图宽度超出限制")?;
    let height = css_height.checked_mul(2).ok_or("长图高度超出限制")?;
    if width > 16384 || height > 200_000 {
        return Err("长图尺寸过大，请减少内容后导出（最大高度 200000 像素）".into());
    }
    let staged = crate::storage::temporary_sibling(target);
    let result = (|| {
        let file =
            std::fs::File::create(&staged).map_err(|error| format!("创建长图失败：{error}"))?;
        let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        {
            let mut stream = writer.stream_writer().map_err(|error| error.to_string())?;
            let mut top = 0;
            while top < css_height {
                let tile_height = (css_height - top).min(1024);
                let rect = PageRect {
                    x: page.x,
                    y: page.y + top as f64,
                    width: css_width as f64,
                    height: tile_height as f64,
                };
                let bytes = rendered.capture(rect, false, 2.0)?;
                let (tile_width, decoded_height, rgba) = decode_png(&bytes)?;
                if tile_width != width || decoded_height != tile_height * 2 {
                    return Err("浏览器返回的长图分块尺寸不一致".into());
                }
                stream
                    .write_all(&rgba)
                    .map_err(|error| format!("写入长图分块失败：{error}"))?;
                top += tile_height;
            }
            stream
                .finish()
                .map_err(|error| format!("完成长图失败：{error}"))?;
        }
        writer
            .finish()
            .map_err(|error| format!("完成 PNG 失败：{error}"))?;
        crate::storage::replace_file(&staged, target)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&staged);
    }
    result
}

pub(super) fn decode_png(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|error| error.to_string())?;
    buffer.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buffer,
        png::ColorType::Rgb => buffer
            .chunks_exact(3)
            .flat_map(|pixel| [pixel[0], pixel[1], pixel[2], 255])
            .collect(),
        _ => return Err("浏览器 PNG 颜色格式不受支持".into()),
    };
    Ok((info.width, info.height, rgba))
}

fn page_destination(target: &Path, page: usize, total: usize, format: ImageFormat) -> PathBuf {
    if total == 1 {
        return target.to_path_buf();
    }
    let stem = target
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("document");
    target.with_file_name(format!("{stem}-{page}.{}", format.extension()))
}

fn collect_pages(directory: &Path, format: ImageFormat) -> Result<Vec<PathBuf>, String> {
    let mut pages = Vec::new();
    for entry in
        std::fs::read_dir(directory).map_err(|error| format!("读取逐页图片失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("读取逐页图片失败：{error}"))?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let suffix = match format {
            ImageFormat::Png => name.strip_suffix(".png"),
            ImageFormat::Jpeg => name.strip_suffix(".jpg"),
        };
        let Some(number) = suffix
            .and_then(|suffix| suffix.strip_prefix("page-"))
            .and_then(|number| number.parse::<usize>().ok())
        else {
            continue;
        };
        pages.push((number, path));
    }
    pages.sort_by_key(|(number, _)| *number);
    if pages.is_empty()
        || pages.iter().enumerate().any(|(index, (number, path))| {
            *number != index + 1 || !path.metadata().is_ok_and(|metadata| metadata.len() > 0)
        })
    {
        return Err("逐页图片未完整生成".to_string());
    }
    Ok(pages.into_iter().map(|(_, path)| path).collect())
}

fn temporary_directory() -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间异常：{error}"))?
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "infinite-editor-image-{}-{nanos}",
        std::process::id()
    ));
    std::fs::create_dir(&directory).map_err(|error| format!("创建图片临时目录失败：{error}"))?;
    Ok(directory)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multi_page_names_are_numbered_and_ordered() {
        let directory = temporary_directory().unwrap();
        std::fs::write(directory.join("page-2.png"), b"second").unwrap();
        std::fs::write(directory.join("page-1.png"), b"first").unwrap();
        let pages = collect_pages(&directory, ImageFormat::Png).unwrap();
        assert_eq!(pages[0], directory.join("page-1.png"));
        assert_eq!(pages[1], directory.join("page-2.png"));
        assert_eq!(
            page_destination(Path::new("note.png"), 2, 2, ImageFormat::Png),
            Path::new("note-2.png")
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "requires a locally installed Chromium"]
    fn exports_real_page_images() {
        let directory = temporary_directory().unwrap();
        let document =
            ProjectDocument::new("第一页\n\n<!-- infinite-editor:page-break -->\n\n第二页".into());
        for (format, extension, signature) in [
            (ImageFormat::Png, "png", b"\x89PNG".as_slice()),
            (ImageFormat::Jpeg, "jpg", b"\xff\xd8".as_slice()),
        ] {
            let target = directory.join(format!("test.{extension}"));
            assert_eq!(
                export_images(&target, &document, &ResourceBundle::default(), format).unwrap(),
                2
            );
            for number in 1..=2 {
                let bytes =
                    std::fs::read(directory.join(format!("test-{number}.{extension}"))).unwrap();
                assert!(bytes.len() > 100);
                assert!(bytes.starts_with(signature));
            }
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "requires a locally installed Chromium"]
    fn exports_seamless_long_image_as_one_complete_png() {
        let directory = temporary_directory().unwrap();
        let mut document = ProjectDocument::new(
            (0..100)
                .map(|index| format!("第 {index} 段：长图导出验证。\n\n"))
                .collect(),
        );
        document
            .markdown
            .push_str("<!-- infinite-editor:page-break -->\n\n长图末尾标记");
        document.layout.page_furniture.header.enabled = true;
        document.layout.page_furniture.header.left =
            serde_json::from_value(serde_json::json!([{"kind":"text","value":"分页页眉"}]))
                .unwrap();
        let target = directory.join("long.png");
        export_long_image(&target, &document, &ResourceBundle::default()).unwrap();
        let mut reader = png::Decoder::new(std::fs::File::open(&target).unwrap())
            .read_info()
            .unwrap();
        assert_eq!(reader.info().width, 2240);
        assert!(reader.info().height > 5000);
        let height = reader.info().height;
        let mut painted = 0;
        let mut rows = 0;
        while let Some(row) = reader.next_row().unwrap() {
            if row
                .data()
                .chunks_exact(4)
                .any(|pixel| pixel[..3] != [255, 255, 255])
            {
                painted = rows;
            }
            rows += 1;
        }
        assert_eq!(rows, height);
        assert!(
            height - painted < 350,
            "末尾正文应出现在完整长图底部，不能截断后补白"
        );
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        document.layout.paper.mode = crate::document::PaperMode::Seamless;
        let automatic = directory.join("automatic.png");
        assert_eq!(
            export_images(
                &automatic,
                &document,
                &ResourceBundle::default(),
                ImageFormat::Png
            )
            .unwrap(),
            1
        );
        assert_eq!(
            std::fs::read(&target).unwrap(),
            std::fs::read(&automatic).unwrap()
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
