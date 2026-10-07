use crate::document::{ProjectDocument, ResourceBundle};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy)]
pub enum OfficeFormat {
    Docx,
    Odt,
}

impl OfficeFormat {
    fn pandoc_name(self) -> &'static str {
        match self {
            Self::Docx => "docx",
            Self::Odt => "odt",
        }
    }
}

pub fn export_office(
    target: &Path,
    document: &ProjectDocument,
    resources: &ResourceBundle,
    format: OfficeFormat,
) -> Result<(), String> {
    let work = temporary_directory()?;
    let result = (|| {
        write_resources(&work, resources)?;
        let mut export_document = document.clone();
        if export_document.layout.paper.mode == crate::document::PaperMode::Seamless {
            export_document.layout.paper.mode = crate::document::PaperMode::A4;
        }
        let mut rendered =
            super::render::RenderedDocument::new(&export_document, resources, false)?;
        let source = work.join("document.html");
        std::fs::write(&source, rendered.editable_html()?)
            .map_err(|error| format!("写入 Office 转换源文件失败：{error}"))?;
        let staged = crate::storage::temporary_sibling(target);
        let _ = std::fs::remove_file(&staged);
        let mut command = Command::new("pandoc");
        command
            .current_dir(&work)
            .arg("document.html")
            .arg("--from=html+tex_math_single_backslash+empty_paragraphs")
            .arg("--lua-filter=page-breaks.lua")
            .arg(format!("--to={}", format.pandoc_name()))
            .arg("--resource-path=.")
            .arg("--standalone")
            .arg("--output")
            .arg(&staged);
        std::fs::write(work.join("page-breaks.lua"), r#"
function Div(el)
  for _, class in ipairs(el.classes) do
    if class == 'infinite-office-page-break' then
      if FORMAT == 'docx' then
        return pandoc.RawBlock('openxml', '<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr></w:p>')
      else
        return pandoc.RawBlock('opendocument', '<text:p text:style-name="InfinitePageBreak"/>')
      end
    end
  end
end
"#).map_err(|error| error.to_string())?;
        let output = command.output().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "未找到 Pandoc，无法导出 DOCX 或 ODT".to_string()
            } else {
                format!("启动 Pandoc 失败：{error}")
            }
        })?;
        if !output.status.success() {
            let _ = std::fs::remove_file(&staged);
            return Err(format!(
                "Pandoc 导出 {} 失败：{}",
                format.pandoc_name().to_uppercase(),
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        if !staged.metadata().is_ok_and(|metadata| metadata.len() > 0) {
            let _ = std::fs::remove_file(&staged);
            return Err("Office 文件未生成或为空".to_string());
        }
        if let Err(error) = super::office_layout::apply(
            &staged,
            &export_document.layout,
            matches!(format, OfficeFormat::Docx),
            rendered.pages.len(),
        ) {
            let _ = std::fs::remove_file(&staged);
            return Err(format!("写入 Office 版式失败：{error}"));
        }
        crate::storage::replace_file(&staged, target)
    })();
    let _ = std::fs::remove_dir_all(work);
    result
}

fn temporary_directory() -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间异常：{error}"))?
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "infinite-editor-office-{}-{nanos}",
        std::process::id()
    ));
    std::fs::create_dir(&directory)
        .map_err(|error| format!("创建 Office 临时目录失败：{error}"))?;
    Ok(directory)
}

fn write_resources(directory: &Path, resources: &ResourceBundle) -> Result<(), String> {
    for (name, data_url) in resources.entries() {
        let relative = Path::new(name);
        if relative.as_os_str().is_empty()
            || relative.is_absolute()
            || relative
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(format!("导出资源路径无效：{name}"));
        }
        let (_, encoded) = data_url
            .split_once(";base64,")
            .filter(|(header, _)| header.starts_with("data:"))
            .ok_or_else(|| format!("导出资源格式无效：{name}"))?;
        let bytes = BASE64
            .decode(encoded)
            .map_err(|error| format!("解码导出资源 {name} 失败：{error}"))?;
        let destination = directory.join(relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建导出资源目录失败：{error}"))?;
        }
        std::fs::write(destination, bytes)
            .map_err(|error| format!("写入导出资源 {name} 失败：{error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_resource_path_escape() {
        let mut resources = ResourceBundle::default();
        resources.insert("../outside.png".into(), "data:image/png;base64,AA==".into());
        let directory = temporary_directory().unwrap();
        assert!(write_resources(&directory, &resources).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "requires a locally installed Pandoc and Chromium"]
    fn exports_editable_office_files_with_embedded_image() {
        let directory = temporary_directory().unwrap();
        let document = ProjectDocument::new(
            "# 导出验证\n\n这是**正文**。\n\n![标识](document.assets/logo.png)".into(),
        );
        let mut resources = ResourceBundle::default();
        resources.insert(
            "document.assets/logo.png".into(),
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQiO0DAAGsAQzvOxmOAAAAAElFTkSuQmCC".into(),
        );
        for (extension, format) in [("docx", OfficeFormat::Docx), ("odt", OfficeFormat::Odt)] {
            let target = directory.join(format!("test.{extension}"));
            export_office(&target, &document, &resources, format).unwrap();
            let file = std::fs::File::open(target).unwrap();
            let mut archive = zip::ZipArchive::new(file).unwrap();
            let body = if extension == "docx" {
                "word/document.xml"
            } else {
                "content.xml"
            };
            let mut xml = String::new();
            std::io::Read::read_to_string(&mut archive.by_name(body).unwrap(), &mut xml).unwrap();
            assert!(xml.contains("导出验证"));
            assert!(archive.file_names().any(|name| {
                (name.starts_with("word/media/") || name.starts_with("Pictures/"))
                    && name.ends_with(".png")
            }));
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "requires Chromium, Pandoc, LibreOffice, pdfinfo and pdftotext"]
    fn office_round_trip_preserves_native_furniture_and_physical_pages() {
        let directory = temporary_directory().unwrap();
        let mut document = ProjectDocument::new("# 第一页\n\n可编辑正文。\n\n<!-- infinite-editor:page-break -->\n\n# 第二页\n\n第二页正文与 $x^2$ 公式。".into());
        document.layout.paper.mode = crate::document::PaperMode::Custom;
        document.layout.paper.width_mm = 180.0;
        document.layout.paper.height_mm = 130.0;
        document.layout.margins.top_mm = 20.0;
        document.layout.margins.bottom_mm = 20.0;
        document.layout.typography.body_font = "Noto Sans".into();
        let header = &mut document.layout.page_furniture.header;
        header.enabled = true;
        header.hide_first_page = true;
        header.style.separator = true;
        header.left = serde_json::from_value(
            serde_json::json!([{"kind":"text","value":"页眉标记&公司","marks":["bold"]}]),
        )
        .unwrap();
        header.right = serde_json::from_value(serde_json::json!([
            {"kind":"page"},
            {"kind":"image","src":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQiO0DAAGsAQzvOxmOAAAAAElFTkSuQmCC","alt":"页眉标识","width_mm":3.0,"height_mm":3.0}
        ])).unwrap();
        let footer = &mut document.layout.page_furniture.footer;
        footer.enabled = true;
        footer.center = serde_json::from_value(serde_json::json!([{"kind":"text","value":"页脚标记 "},{"kind":"page"},{"kind":"text","value":"/"},{"kind":"pages"}])).unwrap();
        for (extension, format) in [("docx", OfficeFormat::Docx), ("odt", OfficeFormat::Odt)] {
            let target = directory.join(format!("native.{extension}"));
            export_office(&target, &document, &ResourceBundle::default(), format).unwrap();
            let output_dir = directory.join(extension);
            std::fs::create_dir(&output_dir).unwrap();
            let profile =
                url::Url::from_file_path(directory.join(format!("profile-{extension}"))).unwrap();
            let converted = Command::new("libreoffice")
                .arg(format!("-env:UserInstallation={profile}"))
                .args(["--headless", "--convert-to", "pdf", "--outdir"])
                .arg(&output_dir)
                .arg(&target)
                .output()
                .unwrap();
            assert!(
                converted.status.success(),
                "{}",
                String::from_utf8_lossy(&converted.stderr)
            );
            let pdf = output_dir.join("native.pdf");
            let info = Command::new("pdfinfo").arg(&pdf).output().unwrap();
            let info = String::from_utf8_lossy(&info.stdout);
            assert!(
                info.lines().any(|line| line.starts_with("Pages:")
                    && line.split_whitespace().last() == Some("2")),
                "{extension}: {info}"
            );
            let text = Command::new("pdftotext")
                .arg("-layout")
                .arg(&pdf)
                .arg("-")
                .output()
                .unwrap();
            let text = String::from_utf8_lossy(&text.stdout);
            let pages: Vec<_> = text.split('\u{c}').collect();
            assert!(!pages[0].contains("页眉标记"), "{extension}: {text}");
            assert!(pages[1].contains("页眉标记"), "{extension}: {text}");
            assert!(
                pages[0].replace(' ', "").contains("1/2")
                    && pages[1].replace(' ', "").contains("2/2"),
                "{extension}: {text}"
            );
            assert!(
                pages[0].contains("页脚标记") && pages[1].contains("页脚标记"),
                "{extension}: {text}"
            );
            assert!(
                pages[0].contains("第一页") && pages[1].contains("第二页"),
                "{extension}: {text}"
            );
            let mut archive = zip::ZipArchive::new(std::fs::File::open(&target).unwrap()).unwrap();
            let mut native = String::new();
            std::io::Read::read_to_string(
                &mut archive
                    .by_name(if extension == "docx" {
                        "word/document.xml"
                    } else {
                        "content.xml"
                    })
                    .unwrap(),
                &mut native,
            )
            .unwrap();
            assert!(native.contains("可编辑正文"));
            assert!(
                archive
                    .file_names()
                    .any(|name| name.contains("infinite-header-1.png")),
                "页眉图片应保留为独立媒体资源"
            );
            assert!(
                native.contains(if extension == "docx" {
                    "<m:oMath"
                } else {
                    "<draw:object"
                }),
                "公式应保留为原生对象：{native}"
            );
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "requires Chromium, Pandoc, LibreOffice and pdftotext"]
    fn office_automatic_page_boundaries_match_browser_layout() {
        let directory = temporary_directory().unwrap();
        let mut document = ProjectDocument::new(
            (0..30)
                .map(|index| format!("PARA{index:03} 自动分页验证。\n\n"))
                .collect(),
        );
        document.layout.paper.mode = crate::document::PaperMode::Custom;
        document.layout.paper.width_mm = 180.0;
        document.layout.paper.height_mm = 120.0;
        document.layout.margins.top_mm = 20.0;
        document.layout.margins.bottom_mm = 20.0;
        document.layout.typography.body_font = "Noto Sans".into();
        let mut rendered = super::super::render::RenderedDocument::new(
            &document,
            &ResourceBundle::default(),
            false,
        )
        .unwrap();
        let expected = rendered.browser.evaluate("[...document.querySelectorAll('.document-page-content')].map(page => page.textContent)").unwrap();
        let expected = expected.as_array().unwrap();
        assert!(expected.len() > 2);
        for (extension, format) in [("docx", OfficeFormat::Docx), ("odt", OfficeFormat::Odt)] {
            let target = directory.join(format!("automatic.{extension}"));
            export_office(&target, &document, &ResourceBundle::default(), format).unwrap();
            let output_dir = directory.join(extension);
            std::fs::create_dir(&output_dir).unwrap();
            let profile =
                url::Url::from_file_path(directory.join(format!("profile-{extension}"))).unwrap();
            let output = Command::new("libreoffice")
                .arg(format!("-env:UserInstallation={profile}"))
                .args(["--headless", "--convert-to", "pdf", "--outdir"])
                .arg(&output_dir)
                .arg(&target)
                .output()
                .unwrap();
            assert!(output.status.success());
            let text = Command::new("pdftotext")
                .arg("-layout")
                .arg(output_dir.join("automatic.pdf"))
                .arg("-")
                .output()
                .unwrap();
            let text = String::from_utf8_lossy(&text.stdout);
            let actual: Vec<_> = text
                .split('\u{c}')
                .filter(|page| !page.trim().is_empty())
                .collect();
            assert_eq!(actual.len(), expected.len(), "{extension}: {text}");
            for (index, page) in actual.iter().enumerate() {
                for number in 0..30 {
                    let marker = format!("PARA{number:03}");
                    assert_eq!(
                        page.contains(&marker),
                        expected[index].as_str().unwrap().contains(&marker),
                        "{extension} 第 {} 页 {marker}",
                        index + 1
                    );
                }
            }
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
}
