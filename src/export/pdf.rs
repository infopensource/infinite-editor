use crate::components::{embedded_font_css, escape_css_string, render_html_with_page_breaks};
use crate::document::{ProjectDocument, ResourceBundle};
use std::path::Path;

use crate::styling::DOCUMENT_CSS;
const MATH_CSS: &str = include_str!("../../assets/math.bundle.css");
const MATH_JS: &str = include_str!("../../assets/math.bundle.js");
const PAGINATION_JS: &str = include_str!("../../assets/document_renderer.js");

pub fn export_pdf(
    target: &Path,
    document: &ProjectDocument,
    resources: &ResourceBundle,
) -> Result<(), String> {
    let mut rendered = super::render::RenderedDocument::new(document, resources, false)?;
    let staged = crate::storage::temporary_sibling(target);
    let result = rendered
        .pdf(&staged)
        .and_then(|_| crate::storage::replace_file(&staged, target));
    if result.is_err() {
        let _ = std::fs::remove_file(&staged);
    }
    result
}

pub(super) fn build_print_html(
    document: &ProjectDocument,
    resources: &ResourceBundle,
    width_mm: f32,
    height_mm: f32,
    seamless: bool,
) -> Result<String, String> {
    let content = render_html_with_page_breaks(&document.markdown)?;
    let layout = &document.layout;
    if !seamless {
        layout.page_furniture.validate(&layout.margins)?;
    }
    let furniture = json_for_inline_script(&layout.page_furniture)?;
    let font_css = embedded_font_css(layout, resources);
    let resources = json_for_inline_script(resources.entries())?;
    let typography = &layout.typography;
    let mut style = format!(
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

    if seamless {
        style.push_str("--page-width:1120px;--page-height:auto;--page-padding-left:88px;--page-padding-right:88px;--page-padding-top:72px;--page-padding-bottom:72px;");
    }
    // CSS font names contain quotes; escape the containing HTML attribute.
    let style = style
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let mode = if seamless { "seamless" } else { "paged" };

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
<section id="infinite-document-renderer" class="document-renderer {mode}" style="{style}">
  <div class="document-pagination-source markdown-rendered-html" aria-hidden="true">{content}</div>
  <div class="document-flow {mode}" data-document-pages="true"></div>
</section>
<script>{MATH_JS}</script>
<script>{PAGINATION_JS}</script>
<script>
const resources = {resources};
window.addEventListener('load', async () => {{
  try {{
    const root = document.getElementById('infinite-document-renderer');
    root.dataset.pageFurniture = JSON.stringify({furniture});
    window.InfiniteDocumentRenderer.hydrateResources(root, resources);
    window.InfiniteMathRenderer?.render(root);
    await Promise.all([...root.querySelectorAll('img')].map(image => image.decode()));
    if (document.fonts?.ready) await document.fonts.ready;
    const result = window.InfiniteDocumentRenderer.paginate(root, {seamless});
    if (!result?.ok) throw new Error(result?.error || '分页失败');
    await Promise.all([...root.querySelectorAll('.document-page img')].map(image => image.decode()));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const pages = [...root.querySelectorAll('.document-page')].map(page => {{
      const rect = page.getBoundingClientRect();
      return {{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }};
    }});
    window.InfiniteExport = {{ ready: true, pages }};
    document.documentElement.dataset.infiniteEditorReady = 'true';
  }} catch (error) {{ window.InfiniteExport = {{ error: String(error) }}; }}
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
        document.layout.page_furniture.header.enabled = true;
        document.layout.page_furniture.header.style.color = "#123456".into();
        document.layout.page_furniture.footer.style.font_size_pt = 12.0;
        let mut resources = ResourceBundle::default();
        resources.insert(
            "document.assets/cover.png".into(),
            "data:image/png;base64,AA==".into(),
        );

        let html =
            build_print_html(&document, &resources, 180.0, 260.0, false).expect("应生成打印 HTML");

        assert!(html.contains("@page { size: 180.000mm 260.000mm"));
        assert!(html.contains("data:image/png;base64,AA=="));
        assert!(html.contains("InfiniteDocumentRenderer.paginate"));
        assert!(html.contains("root.dataset.pageFurniture"));
        assert!(html.contains("#123456"));
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
        let mut document = ProjectDocument::new("# PDF 验证\n\n这是导出测试。".into());
        document.layout.page_furniture.header.enabled = true;
        document.layout.page_furniture.header.left = serde_json::from_value(serde_json::json!([
            { "kind": "text", "value": "页眉测试" }
        ]))
        .unwrap();
        document.layout.page_furniture.footer.enabled = true;
        document.layout.page_furniture.footer.center = serde_json::from_value(serde_json::json!([
            { "kind": "page" }, { "kind": "text", "value": "/" }, { "kind": "pages" }
        ]))
        .unwrap();
        document
            .layout
            .page_furniture
            .header
            .style
            .padding_bottom_mm = 1.0;
        document.layout.page_furniture.header.right = serde_json::from_value(serde_json::json!([
            { "kind": "image", "src": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQiO0DAAGsAQzvOxmOAAAAAElFTkSuQmCC", "alt": "标识", "width_mm": 3.0, "height_mm": 3.0 }
        ])).unwrap();
        let target = std::env::temp_dir().join(format!(
            "infinite-editor-export-test-{}.pdf",
            std::process::id()
        ));

        export_pdf(&target, &document, &ResourceBundle::default()).expect("应生成 PDF");
        let bytes = std::fs::read(&target).expect("应读取 PDF");
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(bytes.len() > 1_000);
        document.layout.page_furniture.header.left = serde_json::from_value(serde_json::json!([
            { "kind": "text", "value": "超长页眉".repeat(100) }
        ]))
        .unwrap();
        assert!(export_pdf(&target, &document, &ResourceBundle::default()).is_err());
        assert_eq!(
            std::fs::read(&target).unwrap(),
            bytes,
            "排版失败不能覆盖已有 PDF"
        );
        let _ = std::fs::remove_file(target);
    }
}
