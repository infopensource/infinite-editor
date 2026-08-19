use crate::document::{LayoutDocument, ProjectDocument, ResourceBundle};
use crate::engine::ParserGateway;
use dioxus::prelude::*;
use markdown::mdast::Node;
use std::sync::atomic::{AtomicU64, Ordering};

use super::MARKDOWN_DOCUMENT_BRIDGE_ID;

const RENDERER_ROOT_ID: &str = "infinite-document-renderer";
const PAGE_BREAK_MARKER: &str = "<!-- infinite-editor:page-break -->";
static NEXT_RENDER_REQUEST: AtomicU64 = AtomicU64::new(1);

pub fn run_wysiwyg_command(command: String) {
    let command = serde_json::to_string(&command).unwrap_or_else(|_| "\"\"".into());
    let script =
        format!("window.InfiniteDocumentRenderer?.command('{RENDERER_ROOT_ID}', {command});");
    let _ = document::eval(&script);
}

pub fn run_markdown_command(command: String) {
    let command = serde_json::to_string(&command).unwrap_or_else(|_| "\"\"".into());
    let script = format!("window.InfiniteMarkdownEditor?.command({command});");
    let _ = document::eval(&script);
}

pub(crate) fn escape_css_string(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .flat_map(|character| match character {
            '\\' => "\\\\".chars().collect::<Vec<_>>(),
            '"' => "\\\"".chars().collect::<Vec<_>>(),
            other => vec![other],
        })
        .collect()
}

pub(crate) fn render_html_with_page_breaks(source: &str) -> Result<String, String> {
    let parser = ParserGateway::markdown_rs();
    let mut output = String::new();
    let mut section_start = 0usize;

    for (index, section) in source.split(PAGE_BREAK_MARKER).enumerate() {
        if index > 0 {
            output.push_str(r#"<div class="infinite-page-break" aria-hidden="true"></div>"#);
            section_start += PAGE_BREAK_MARKER.len();
        }
        if section.trim().is_empty() {
            output.push_str(r#"<p class="wysiwyg-empty-paragraph"><br></p>"#);
        } else {
            let tree = markdown::to_mdast(section, &markdown::ParseOptions::gfm())
                .map_err(|error| error.to_string())?;
            let Node::Root(root) = tree else {
                return Err("Markdown 根节点无效".to_string());
            };
            for child in root.children {
                let Some(position) = child.position() else {
                    continue;
                };
                let block_source = &section[position.start.offset..position.end.offset];
                let html = parser
                    .render_html(block_source)
                    .map_err(|error| error.message)?;
                let from = byte_offset_to_utf16(source, section_start + position.start.offset);
                let to = byte_offset_to_utf16(source, section_start + position.end.offset);
                output.push_str(&annotate_source_range(&html, from, to));
            }
        }
        section_start += section.len();
    }

    if source.ends_with("\n\n")
        && source
            .rsplit(PAGE_BREAK_MARKER)
            .next()
            .is_some_and(|section| !section.trim().is_empty())
    {
        output.push_str(r#"<p class="wysiwyg-empty-paragraph"><br></p>"#);
    }

    Ok(output)
}

fn byte_offset_to_utf16(source: &str, offset: usize) -> usize {
    source[..offset].encode_utf16().count()
}

fn annotate_source_range(html: &str, from: usize, to: usize) -> String {
    let Some(opening) = html.find('<') else {
        return html.to_string();
    };
    let Some(tag_end) = html[opening..]
        .find(|character: char| character == '>' || character.is_whitespace())
        .map(|offset| opening + offset)
    else {
        return html.to_string();
    };
    let mut annotated = String::with_capacity(html.len() + 64);
    annotated.push_str(&html[..tag_end]);
    annotated.push_str(&format!(
        r#" data-markdown-from="{from}" data-markdown-to="{to}""#
    ));
    annotated.push_str(&html[tag_end..]);
    annotated
}

pub(crate) fn embedded_font_css(layout: &LayoutDocument, resources: &ResourceBundle) -> String {
    let mut css = String::new();
    for font in &layout.resources.fonts {
        if font.family.trim().is_empty() || font.path.trim().is_empty() {
            continue;
        }
        let resource_path = if layout.resources.root.is_empty() {
            font.path.clone()
        } else {
            format!(
                "{}/{}",
                layout.resources.root.trim_end_matches('/'),
                font.path.trim_start_matches("./")
            )
        };
        let Some(data_url) = resources.get(&resource_path) else {
            continue;
        };
        let style = match font.style.as_str() {
            "italic" => "italic",
            "oblique" => "oblique",
            _ => "normal",
        };
        css.push_str(&format!(
            "@font-face{{font-family:\"{}\";src:url(\"{}\");font-weight:{};font-style:{};font-display:block;}}",
            escape_css_string(&font.family),
            data_url,
            font.weight.clamp(1, 1000),
            style,
        ));
    }
    css
}

fn update_pagination(
    seamless: bool,
    resources: ResourceBundle,
    editable: bool,
    markdown: String,
    document_revision: u64,
    editor_revision: u64,
) {
    let render_request = NEXT_RENDER_REQUEST.fetch_add(1, Ordering::Relaxed);
    spawn(async move {
        let resources = serde_json::to_string(resources.entries()).unwrap_or_else(|_| "{}".into());
        let markdown = serde_json::to_string(&markdown).unwrap_or_else(|_| "\"\"".into());
        let script = format!(
            r#"
                const run = () => window.InfiniteDocumentRenderer.mount(
                    '{RENDERER_ROOT_ID}', {seamless}, {resources}, {editable},
                    '{MARKDOWN_DOCUMENT_BRIDGE_ID}', {markdown}, {document_revision},
                    {editor_revision}, {render_request}
                );
                if (window.InfiniteDocumentRenderer) return JSON.stringify(run());

                return await new Promise((resolve) => {{
                    const ready = () => resolve(JSON.stringify(run()));
                    window.addEventListener(
                        'infinite-document-renderer-ready',
                        ready,
                        {{ once: true }}
                    );
                    setTimeout(() => resolve(JSON.stringify({{
                        ok: false,
                        error: '分页脚本未就绪'
                    }})), 5000);
                }});
            "#
        );

        if let Err(error) = document::eval(&script).join::<String>().await {
            eprintln!("更新文档分页失败: {error}");
        }
    });
}

#[component]
pub fn DocumentRenderer(
    document: ReadSignal<ProjectDocument>,
    resources: ReadSignal<ResourceBundle>,
    document_revision: ReadSignal<u64>,
    editor_revision: ReadSignal<u64>,
    page_style: String,
    seamless: bool,
) -> Element {
    let current_document = document.read();
    let source = current_document.markdown.clone();
    let typography = current_document.layout.typography.clone();
    let font_css = embedded_font_css(&current_document.layout, &resources.read());
    drop(current_document);
    let renderer_style = format!(
        "{page_style} --document-font-family: \"{}\"; --document-font-size: {:.3}pt; --document-line-height: {:.3}; --document-paragraph-spacing: {:.3}pt;",
        escape_css_string(&typography.body_font),
        typography.body_font_size_pt,
        typography.line_height,
        typography.paragraph_spacing_pt,
    );
    let rendered_html = if source.trim().is_empty() {
        r#"<p class="wysiwyg-empty-paragraph"><br></p>"#.to_string()
    } else {
        render_html_with_page_breaks(&source)
            .unwrap_or_else(|_| "<p class=\"document-render-error\">渲染失败</p>".to_string())
    };

    use_effect(move || {
        let markdown = document.read().markdown.clone();
        update_pagination(
            seamless,
            resources.read().clone(),
            true,
            markdown,
            document_revision(),
            editor_revision(),
        );
    });

    rsx! {
        section {
            id: RENDERER_ROOT_ID,
            class: if seamless { "document-renderer seamless" } else { "document-renderer paged" },
            style: renderer_style,
            "data-document-revision": document_revision(),
            "data-editor-revision": editor_revision(),
            onmounted: move |_| update_pagination(
                seamless,
                resources.read().clone(),
                true,
                document.read().markdown.clone(),
                document_revision(),
                editor_revision(),
            ),
            if !font_css.is_empty() {
                style { "{font_css}" }
            }
            div {
                class: "document-pagination-source markdown-rendered-html",
                aria_hidden: "true",
                dangerous_inner_html: "{rendered_html}",
            }
            div {
                class: if seamless { "document-flow seamless" } else { "document-flow paged" },
                "data-document-pages": "true",
                aria_live: "polite",
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_page_break_is_inserted_between_rendered_sections() {
        let html =
            render_html_with_page_breaks(&format!("第一页\n\n{PAGE_BREAK_MARKER}\n\n第二页"))
                .expect("应渲染分页 Markdown");

        assert!(html.contains(">第一页</p>"));
        assert!(
            html.contains(r#"data-markdown-from="0" data-markdown-to="3""#),
            "{html}"
        );
        assert!(html.contains("infinite-page-break"));
        assert!(html.contains(">第二页</p>"));
    }

    #[test]
    fn raw_html_stays_escaped_around_generated_page_breaks() {
        let html = render_html_with_page_breaks(&format!(
            "<script>alert(1)</script>\n{PAGE_BREAK_MARKER}\n正文"
        ))
        .expect("应安全渲染");

        assert!(!html.contains("<script>"));
        assert!(html.contains("infinite-page-break"));
    }

    #[test]
    fn trailing_page_break_keeps_an_editable_empty_page() {
        let html = render_html_with_page_breaks(&format!("正文\n\n{PAGE_BREAK_MARKER}"))
            .expect("应保留末尾分页");

        assert!(html.ends_with(r#"<p class="wysiwyg-empty-paragraph"><br></p>"#));
    }

    #[test]
    fn wysiwyg_renderer_preserves_composed_gfm_marks() {
        let html = render_html_with_page_breaks("~~**组合格式**~~").expect("应渲染组合格式");

        assert!(
            html.contains("<del><strong>组合格式</strong></del>"),
            "{html}"
        );
        assert!(html.contains(r#"data-markdown-from="0""#), "{html}");
    }

    #[test]
    fn empty_list_placeholder_survives_markdown_rendering() {
        let html =
            render_html_with_page_breaks("- 第一项\n- &nbsp;").expect("空列表项应可重新渲染");

        assert_eq!(html.matches("<li>").count(), 2, "{html}");
    }
}
