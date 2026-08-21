use crate::components::{embedded_font_css, escape_css_string, render_html_with_page_breaks};
use crate::document::{ProjectDocument, ResourceBundle};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

const DOCUMENT_CSS: &str = include_str!("../../assets/styling/word.css");
const MATH_CSS: &str = include_str!("../../assets/math.bundle.css");
const MATH_JS: &str = include_str!("../../assets/math.bundle.js");
const PAGINATION_JS: &str = include_str!("../../assets/document_renderer.js");

pub fn export_pdf(
    target: &Path,
    document: &ProjectDocument,
    resources: &ResourceBundle,
) -> Result<(), String> {
    let width = document
        .layout
        .paper
        .resolved_width_mm()
        .ok_or_else(|| "无缝纸张不能直接导出 PDF，请先选择 A4、A5 或自定义纸张".to_string())?;
    let height = document
        .layout
        .paper
        .resolved_height_mm()
        .ok_or_else(|| "无法确定 PDF 纸张高度".to_string())?;
    let html = build_print_html(document, resources, width, height)?;
    let temporary_directory = temporary_export_directory()?;
    let html_path = temporary_directory.join("document.html");
    let temporary_pdf = crate::storage::temporary_sibling(target);
    std::fs::write(&html_path, html).map_err(|error| format!("写入打印页面失败: {error}"))?;

    let result = print_with_chromium(&html_path, &temporary_pdf);
    let _ = std::fs::remove_dir_all(&temporary_directory);
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temporary_pdf);
        return Err(error);
    }

    let metadata =
        std::fs::metadata(&temporary_pdf).map_err(|error| format!("PDF 未生成: {error}"))?;
    if metadata.len() == 0 {
        let _ = std::fs::remove_file(&temporary_pdf);
        return Err("PDF 文件为空".to_string());
    }
    crate::storage::replace_file(&temporary_pdf, target)
}

fn build_print_html(
    document: &ProjectDocument,
    resources: &ResourceBundle,
    width_mm: f32,
    height_mm: f32,
) -> Result<String, String> {
    let content = render_html_with_page_breaks(&document.markdown)?;
    let layout = &document.layout;
    let font_css = embedded_font_css(layout, resources);
    let resources = json_for_inline_script(resources.entries())?;
    let typography = &layout.typography;
    let style = format!(
        "--page-width:{width_mm:.3}mm;--page-height:{height_mm:.3}mm;--page-padding-left:{:.3}mm;--page-padding-right:{:.3}mm;--page-padding-top:{:.3}mm;--page-padding-bottom:{:.3}mm;--document-font-family:\"{}\";--document-font-size:{:.3}pt;--document-line-height:{:.3};--document-paragraph-spacing:{:.3}pt;",
        layout.margins.left_mm,
        layout.margins.right_mm,
        layout.margins.top_mm,
        layout.margins.bottom_mm,
        escape_css_string(&typography.body_font),
        typography.body_font_size_pt,
        typography.line_height,
        typography.paragraph_spacing_pt,
    );

    Ok(format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Infinite Editor PDF</title>
<style>
{DOCUMENT_CSS}
{MATH_CSS}
{font_css}
@page {{ size: {width_mm:.3}mm {height_mm:.3}mm; margin: 0; }}
html, body {{ margin: 0; padding: 0; background: #fff; }}
.document-flow {{ display: block; padding: 0; }}
.document-page {{ margin: 0; border: 1px solid transparent; box-shadow: none; break-after: page; page-break-after: always; }}
.document-page:last-child {{ break-after: auto; page-break-after: auto; }}
</style>
</head>
<body>
<section id="infinite-document-renderer" class="document-renderer paged" style="{style}">
  <div class="document-pagination-source markdown-rendered-html" aria-hidden="true">{content}</div>
  <div class="document-flow paged" data-document-pages="true"></div>
</section>
<script>{MATH_JS}</script>
<script>{PAGINATION_JS}</script>
<script>
const resources = {resources};
window.addEventListener('load', async () => {{
  const root = document.getElementById('infinite-document-renderer');
  window.InfiniteDocumentRenderer.mount('infinite-document-renderer', false, resources);
  const images = [...root.querySelectorAll('.document-pagination-source img')];
  await Promise.all(images.map(image => image.complete
    ? Promise.resolve()
    : new Promise(resolve => {{ image.addEventListener('load', resolve, {{ once: true }}); image.addEventListener('error', resolve, {{ once: true }}); }})));
  if (document.fonts?.ready) await document.fonts.ready;
  window.InfiniteDocumentRenderer.paginate(root, false);
  document.documentElement.dataset.infiniteEditorReady = 'true';
}});
</script>
</body>
</html>"#
    ))
}

fn json_for_inline_script<T: serde::Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value)
        .map(|json| {
            json.replace('<', "\\u003c")
                .replace('>', "\\u003e")
                .replace('&', "\\u0026")
                .replace('\u{2028}', "\\u2028")
                .replace('\u{2029}', "\\u2029")
        })
        .map_err(|error| format!("序列化打印资源失败: {error}"))
}

fn temporary_export_directory() -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间异常: {error}"))?
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "infinite-editor-pdf-{}-{timestamp}",
        std::process::id()
    ));
    std::fs::create_dir(&path).map_err(|error| format!("创建 PDF 临时目录失败: {error}"))?;
    Ok(path)
}

fn print_with_chromium(html_path: &Path, target: &Path) -> Result<(), String> {
    let page_url = Url::from_file_path(html_path)
        .map_err(|_| "无法生成打印页面 URL".to_string())?
        .to_string();
    let target = target
        .canonicalize()
        .unwrap_or_else(|_| target.to_path_buf());
    let print_argument = format!("--print-to-pdf={}", target.display());
    let candidates = [
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable",
        "chrome",
        "msedge",
    ];
    let mut last_failure = None;

    for candidate in candidates {
        let output = Command::new(candidate)
            .args([
                "--headless=new",
                "--disable-gpu",
                "--no-pdf-header-footer",
                "--print-to-pdf-no-header",
                "--run-all-compositor-stages-before-draw",
                "--virtual-time-budget=5000",
                &print_argument,
                &page_url,
            ])
            .output();

        match output {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => last_failure = Some(browser_failure(candidate, &output)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => last_failure = Some(format!("启动 {candidate} 失败: {error}")),
        }
    }

    Err(last_failure.unwrap_or_else(|| {
        "未找到 Chromium、Google Chrome 或 Microsoft Edge，无法生成 PDF".to_string()
    }))
}

fn browser_failure(browser: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr.lines().last().unwrap_or("未知错误");
    format!("{browser} 生成 PDF 失败: {detail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn print_html_uses_document_page_size_and_embeds_resources() {
        let mut document =
            ProjectDocument::new("# 标题\n\n![封面](document.assets/cover.png)".into());
        document.layout.paper.width_mm = 180.0;
        document.layout.paper.height_mm = 260.0;
        document.layout.paper.mode = crate::document::PaperMode::Custom;
        let mut resources = ResourceBundle::default();
        resources.insert(
            "document.assets/cover.png".into(),
            "data:image/png;base64,AA==".into(),
        );

        let html = build_print_html(&document, &resources, 180.0, 260.0).expect("应生成打印 HTML");

        assert!(html.contains("@page { size: 180.000mm 260.000mm"));
        assert!(html.contains("data:image/png;base64,AA=="));
        assert!(html.contains("InfiniteDocumentRenderer.paginate"));
        assert!(html.contains("InfiniteMathRenderer"));
        assert!(html.contains("font-family:KaTeX_Main"));
        assert!(html.contains("data:font/woff2;base64,"));
        assert!(!html.contains("<script>alert"));
    }

    #[test]
    fn inline_json_cannot_close_its_script_element() {
        let value = vec!["</script><script>alert(1)</script>"];
        let json = json_for_inline_script(&value).expect("应编码 JSON");
        assert!(!json.contains("</script>"));
        assert!(json.contains("\\u003c"));
    }

    #[test]
    #[ignore = "requires a locally installed Chromium-compatible browser"]
    fn chromium_export_creates_a_real_pdf() {
        let document = ProjectDocument::new("# PDF 验证\n\n这是导出测试。".into());
        let target = std::env::temp_dir().join(format!(
            "infinite-editor-export-test-{}.pdf",
            std::process::id()
        ));

        export_pdf(&target, &document, &ResourceBundle::default()).expect("应生成 PDF");
        let bytes = std::fs::read(&target).expect("应读取 PDF");
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(bytes.len() > 1_000);
        let _ = std::fs::remove_file(target);
    }
}
