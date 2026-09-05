use crate::document::{LayoutDocument, ResourceBundle};
use crate::engine::{math_parse_options, ParserGateway};
use dioxus::document;
use markdown::mdast::Node;

const PAGE_BREAK_MARKER: &str = "<!-- infinite-editor:page-break -->";

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
    let reference_definitions = reference_definition_source(source)?;
    let mut output = String::new();
    let mut section_start = 0usize;

    for (index, section) in source.split(PAGE_BREAK_MARKER).enumerate() {
        if index > 0 {
            output.push_str(r#"<div class="infinite-page-break" aria-hidden="true"></div>"#);
            section_start += PAGE_BREAK_MARKER.len();
        }
        if section.trim().is_empty() {
            output.push_str("<p><br></p>");
        } else {
            let tree = markdown::to_mdast(section, &math_parse_options())
                .map_err(|error| error.to_string())?;
            let Node::Root(root) = tree else {
                return Err("Markdown 根节点无效".to_string());
            };
            for child in root.children {
                let Some(position) = child.position() else {
                    continue;
                };
                let block_source = &section[position.start.offset..position.end.offset];
                let render_source =
                    if reference_definitions.is_empty() || matches!(child, Node::Definition(_)) {
                        block_source.to_string()
                    } else {
                        format!("{block_source}\n\n{reference_definitions}")
                    };
                let html = parser
                    .render_html(&render_source)
                    .map_err(|error| error.message)?;
                let from = byte_offset_to_utf16(source, section_start + position.start.offset);
                let to = byte_offset_to_utf16(source, section_start + position.end.offset);
                output.push_str(&annotate_source_position(&html, from, to));
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
        output.push_str("<p><br></p>");
    }

    Ok(output)
}

fn reference_definition_source(source: &str) -> Result<String, String> {
    let tree =
        markdown::to_mdast(source, &math_parse_options()).map_err(|error| error.to_string())?;
    let Node::Root(root) = tree else {
        return Err("Markdown 根节点无效".to_string());
    };

    Ok(root
        .children
        .iter()
        .filter(|node| matches!(node, Node::Definition(_)))
        .filter_map(Node::position)
        .map(|position| &source[position.start.offset..position.end.offset])
        .collect::<Vec<_>>()
        .join("\n"))
}

fn byte_offset_to_utf16(source: &str, offset: usize) -> usize {
    source[..offset].encode_utf16().count()
}

fn annotate_source_position(html: &str, from: usize, to: usize) -> String {
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
    annotated.push_str(&format!(r#" data-markdown-from="{from}" data-markdown-to="{to}""#));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_page_break_is_inserted_between_rendered_sections() {
        let html =
            render_html_with_page_breaks(&format!("第一页\n\n{PAGE_BREAK_MARKER}\n\n第二页"))
                .expect("应渲染分页 Markdown");

        assert!(html.contains(">第一页</p>"));
        assert!(html.contains(r#"data-markdown-from="0""#), "{html}");
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
    fn trailing_page_break_keeps_an_empty_page() {
        let html = render_html_with_page_breaks(&format!("正文\n\n{PAGE_BREAK_MARKER}"))
            .expect("应保留末尾分页");

        assert!(html.ends_with("<p><br></p>"));
    }

    #[test]
    fn markdown_renderer_preserves_composed_gfm_marks() {
        let html = render_html_with_page_breaks("~~**组合格式**~~").expect("应渲染组合格式");

        assert!(
            html.contains("<del><strong>组合格式</strong></del>"),
            "{html}"
        );
        assert!(html.contains(r#"data-markdown-from="0""#), "{html}");
    }

    #[test]
    fn reference_links_share_definitions_across_rendered_blocks() {
        let html = render_html_with_page_breaks(
            "[引用式链接][markdown-guide]\n\n后续段落\n\n[markdown-guide]: https://www.markdownguide.org/ \"Markdown Guide\"",
        )
        .expect("引用式链接应能访问文档级定义");

        assert!(
            html.contains(
                r#"<a href="https://www.markdownguide.org/" title="Markdown Guide">引用式链接</a>"#
            ),
            "{html}"
        );
        assert!(!html.contains("[markdown-guide]:"), "{html}");
    }

    #[test]
    fn empty_list_placeholder_survives_markdown_rendering() {
        let html =
            render_html_with_page_breaks("- 第一项\n- &nbsp;").expect("空列表项应可重新渲染");

        assert_eq!(html.matches("<li>").count(), 2, "{html}");
    }
}
