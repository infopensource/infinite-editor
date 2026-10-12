use markdown::mdast::Node;

use super::InfiniteAstDocument;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EditorMode {
    MarkdownSource,
    Wysiwyg,
}

impl EditorMode {
    pub fn label(self) -> &'static str {
        match self {
            EditorMode::MarkdownSource => "Markdown 源码",
            EditorMode::Wysiwyg => "所见即所得",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
}

#[derive(Clone, Copy, Default)]
pub struct ParserGateway;

impl ParserGateway {
    pub fn markdown_rs() -> Self {
        Self
    }

    pub fn render_html(&self, source: &str) -> Result<String, ParseError> {
        markdown::to_html_with_options(source, &math_options())
            .map(|html| render_paragraph_metadata(&render_explicit_line_breaks(&html)))
            .map_err(|error| ParseError {
                message: error.to_string(),
            })
    }

    pub fn parse_infinite_ast(&self, source: &str) -> Result<InfiniteAstDocument, ParseError> {
        InfiniteAstDocument::from_markdown_rs(source)
    }

    /// Counts visible characters instead of Markdown source punctuation.
    pub fn character_count(&self, source: &str) -> usize {
        markdown::to_mdast(source, &math_parse_options())
            .map(|root| visible_character_count(&root))
            .unwrap_or_else(|_| {
                source
                    .chars()
                    .filter(|character| !character.is_whitespace())
                    .count()
            })
    }
}

// Only recognize our exact trailing paragraph metadata. Arbitrary HTML remains escaped.
fn render_paragraph_metadata(html: &str) -> String {
    let mut output = html.to_string();
    let prefix = "&lt;!-- infinite-editor:";
    let suffix = " --&gt;";
    let mut search_from = 0;
    while let Some(relative) = output[search_from..].find(prefix) {
        let start = search_from + relative;
        let mut end = start;
        let mut style = String::new();
        let mut item_style = String::new();
        let mut continuation = false;
        while output[end..].starts_with(prefix) {
            let value_start = end + prefix.len();
            let Some(length) = output[value_start..].find(suffix) else {
                break;
            };
            let marker = &output[value_start..value_start + length];
            if let Some(align) = marker
                .strip_prefix("align=")
                .filter(|align| ["left", "center", "right", "justify"].contains(align))
            {
                style.push_str(&format!("text-align:{align};text-align-last:auto;"));
            } else if marker == "continuation=1" {
                continuation = true;
            } else if let Some((key, level)) = marker.split_once('=') {
                let level = level
                    .chars()
                    .next()
                    .filter(|digit| matches!(digit, '1'..='9'))
                    .filter(|_| level.bytes().all(|digit| digit.is_ascii_digit()))
                    .and_then(|_| level.parse::<usize>().ok())
                    .and_then(|level| level.checked_mul(2));
                match (key, level) {
                    ("indent", Some(level)) => {
                        style.push_str(&format!("margin-inline-start:{level}em;"))
                    }
                    ("list-indent", Some(level)) => {
                        item_style.push_str(&format!("margin-inline-start:{level}em;"))
                    }
                    _ => break,
                }
            } else {
                break;
            }
            end = value_start + length + suffix.len();
        }
        let tag = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"]
            .into_iter()
            .find(|tag| output[end..].starts_with(&format!("</{tag}>")))
            .or_else(|| {
                // Tight lists omit <p>. Their first paragraph can be followed
                // by a sublist rather than the list item's closing tag.
                ["\n<ul>", "\n<ol>", "\n<ol start="]
                    .into_iter()
                    .any(|prefix| output[end..].starts_with(prefix))
                    .then_some("li")
            });
        if end > start {
            if let Some(tag) = tag {
                if let Some(open) = output[..start].rfind(&format!("<{tag}>")) {
                    // Continuations preserve the ancestry and numbering of a
                    // split list without displaying a second empty heading.
                    let heading_start = open + tag.len() + 2;
                    continuation &= matches!(tag, "p" | "li")
                        && ["\u{a0}", "&nbsp;"].contains(&&output[heading_start..start]);
                    if continuation {
                        item_style.push_str("list-style:none;");
                        if tag == "p" {
                            style.push_str("display:none;");
                        }
                    }
                    output.replace_range(start..end, "");
                    if continuation && tag == "li" {
                        output.replace_range(heading_start..start, "");
                    }
                    if tag == "li" {
                        style.push_str(&item_style);
                    }
                    let styled_tag = format!("<{tag} style=\"{style}\">");
                    output.replace_range(open..open + tag.len() + 2, &styled_tag);
                    if tag != "li" && !item_style.is_empty() {
                        if let Some(li) = output[..open].rfind("<li>") {
                            output
                                .replace_range(li..li + 4, &format!("<li style=\"{item_style}\">"));
                        }
                    }
                    search_from = open;
                    continue;
                }
            }
        }
        search_from = start + prefix.len();
    }
    output
}

fn render_explicit_line_breaks(html: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(code_start) = rest.find("<code") {
        let (ordinary, code_and_rest) = rest.split_at(code_start);
        output.push_str(&replace_escaped_br(ordinary));
        let Some(code_end) = code_and_rest.find("</code>") else {
            output.push_str(code_and_rest);
            return output;
        };
        let end = code_end + "</code>".len();
        output.push_str(&code_and_rest[..end]);
        rest = &code_and_rest[end..];
    }
    output.push_str(&replace_escaped_br(rest));
    // markdown-rs formats a hard break as `<br>\n`. With `white-space:
    // break-spaces`, that source-formatting newline would paint a second blank
    // line after the actual BR. Soft line breaks remain untouched.
    output
        .replace("<br>\r\n", "<br>")
        .replace("<br>\n", "<br>")
        .replace("<br />\r\n", "<br>")
        .replace("<br />\n", "<br>")
}

fn replace_escaped_br(value: &str) -> String {
    value
        .replace("&lt;br/&gt;", "<br>")
        .replace("&lt;br /&gt;", "<br>")
        .replace("&lt;br&gt;", "<br>")
}

pub(crate) fn math_parse_options() -> markdown::ParseOptions {
    let mut options = markdown::ParseOptions::gfm();
    options.constructs.math_text = true;
    options.constructs.math_flow = true;
    options
}

fn math_options() -> markdown::Options {
    markdown::Options {
        parse: math_parse_options(),
        compile: markdown::CompileOptions::gfm(),
    }
}

fn count_non_whitespace(value: &str) -> usize {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .count()
}

fn visible_character_count(node: &Node) -> usize {
    if let Some(children) = node.children() {
        return children.iter().map(visible_character_count).sum();
    }

    match node {
        Node::Text(node) => count_non_whitespace(&node.value),
        Node::InlineCode(node) => count_non_whitespace(&node.value),
        Node::Code(node) => count_non_whitespace(&node.value),
        Node::InlineMath(node) => count_non_whitespace(&node.value),
        Node::Math(node) => count_non_whitespace(&node.value),
        Node::Image(node) => count_non_whitespace(&node.alt),
        Node::ImageReference(node) => count_non_whitespace(&node.alt),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_paragraph_alignment() {
        for align in ["left", "center", "right", "justify"] {
            let source = format!("正文<!-- infinite-editor:align={align} -->");
            let html = ParserGateway::markdown_rs().render_html(&source).unwrap();
            assert!(html.contains(&format!("text-align:{align}")), "{html}");
            assert!(!html.contains("infinite-editor:align"));
        }
    }

    #[test]
    fn renders_body_and_list_indentation_with_alignment() {
        let parser = ParserGateway::markdown_rs();
        for (source, tag, level) in [
            ("正文<!-- infinite-editor:indent=2 -->", "p", 4),
            ("## 标题<!-- infinite-editor:indent=1 -->", "h2", 2),
            ("- 项<!-- infinite-editor:list-indent=1 -->\n- 后", "li", 2),
            (
                "- 项<!-- infinite-editor:list-indent=1 -->\n  - 子\n- 后",
                "li",
                2,
            ),
            (
                "- 项<!-- infinite-editor:list-indent=1 -->\n\n- 后",
                "li",
                2,
            ),
        ] {
            let html = parser.render_html(source).unwrap();
            assert!(
                html.contains(&format!("<{tag} style=\"margin-inline-start:{level}em;\">")),
                "{html}"
            );
            assert!(!html.contains("infinite-editor:"), "{html}");
        }
        let html = parser
            .render_html(
                "正文<!-- infinite-editor:align=center --><!-- infinite-editor:indent=2 -->",
            )
            .unwrap();
        assert!(
            html.contains("text-align:center;text-align-last:auto;margin-inline-start:4em;"),
            "{html}"
        );
        assert!(!html.contains("infinite-editor:"), "{html}");
        assert_eq!(
            parser.character_count("正文<!-- infinite-editor:indent=2 -->"),
            2
        );
    }

    #[test]
    fn renders_list_continuations_without_a_second_heading() {
        let parser = ParserGateway::markdown_rs();
        for source in [
            "7. &nbsp;<!-- infinite-editor:continuation=1 -->\n   - 后续子项\n8. 后续编号",
            "7. &nbsp;<!-- infinite-editor:continuation=1 -->\n\n   - 后续子项\n\n8. 后续编号",
        ] {
            let html = parser.render_html(source).unwrap();
            assert!(!html.contains("infinite-editor:"), "{html}");
            assert!(html.contains("list-style:none;"), "{html}");
            assert!(html.contains("<ol start=\"7\">"), "{html}");
            assert!(html.contains("后续子项"), "{html}");
            assert!(html.contains("后续编号"), "{html}");
            assert!(
                html.contains("display:none;") || !html.contains('\u{a0}'),
                "{html}"
            );
        }
    }

    #[test]
    fn indentation_metadata_only_formats_block_suffixes() {
        let parser = ParserGateway::markdown_rs();
        for source in [
            "`<!-- infinite-editor:indent=2 -->`",
            "```\n正文<!-- infinite-editor:indent=2 -->\n```",
            "前<!-- infinite-editor:indent=2 -->后",
            "正文<!-- infinite-editor:indent=-1 -->",
            "正文<!-- infinite-editor:indent=red -->",
            "正文<!-- infinite-editor:indent=00 -->",
        ] {
            let html = parser.render_html(source).unwrap();
            assert!(!html.contains("margin-inline-start:"), "{html}");
        }
    }

    #[test]
    fn renders_common_markdown_to_html() {
        let html = ParserGateway::markdown_rs()
            .render_html("# 标题\n\n这是 **粗体** 和 `代码`。")
            .expect("普通 Markdown 应能完成渲染");

        assert!(html.contains("<h1>标题</h1>"));
        assert!(html.contains("<strong>粗体</strong>"));
        assert!(html.contains("<code>代码</code>"));
    }

    #[test]
    fn typora_preview_supports_space_and_explicit_html_hard_breaks() {
        let parser = ParserGateway::markdown_rs();
        let spaces = parser
            .render_html("第一行  \n第二行")
            .expect("行尾空格应作为普通正文渲染");
        let explicit = parser
            .render_html("第一行<br/>第二行")
            .expect("显式 br 应渲染为换行");

        assert!(spaces.contains("<br"), "{spaces}");
        assert!(!spaces.contains("<br>\n"), "{spaces}");
        assert!(!spaces.contains("<br />\n"), "{spaces}");
        assert!(explicit.contains("<br"), "{explicit}");
    }

    #[test]
    fn typora_preview_keeps_one_visual_line_for_soft_and_hard_breaks() {
        let parser = ParserGateway::markdown_rs();
        let soft = parser.render_html("甲\n乙").expect("软换行应可渲染");
        let hard = parser
            .render_html("甲  \n乙")
            .expect("双空格硬换行应可渲染");

        assert!(soft.contains("甲\n乙"), "{soft}");
        assert!(
            hard.contains("甲<br>乙") || hard.contains("甲<br />乙"),
            "{hard}"
        );
    }

    #[test]
    fn renders_composed_gfm_marks() {
        let html = ParserGateway::markdown_rs()
            .render_html("~~**同时加粗和删除**~~")
            .expect("GFM 组合格式应能渲染");

        assert!(html.contains("<del><strong>同时加粗和删除</strong></del>"));
    }

    #[test]
    fn renders_gfm_tables_with_the_same_dialect_as_the_editor() {
        let html = ParserGateway::markdown_rs()
            .render_html("| 列 |\n| --- |\n| 值 |")
            .expect("GFM 表格应能渲染");

        assert!(html.contains("<table>"), "{html}");
        assert!(html.contains("<td>值</td>"), "{html}");
    }

    #[test]
    fn recognizes_inline_and_display_math() {
        let parser = ParserGateway::markdown_rs();
        let html = parser
            .render_html("质能方程 $E=mc^2$。\n\n$$\n\\ce{2H2 + O2 -> 2H2O}\n$$")
            .expect("数学 Markdown 应能渲染为 KaTeX 挂载节点");

        assert!(
            html.contains(r#"class="language-math math-inline""#),
            "{html}"
        );
        assert!(
            html.contains(r#"class="language-math math-display""#),
            "{html}"
        );
    }

    #[test]
    fn default_renderer_does_not_pass_raw_html_through() {
        let html = ParserGateway::markdown_rs()
            .render_html("<script>alert('xss')</script>")
            .expect("危险 HTML 也应被安全地处理");

        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
    }

    #[test]
    fn default_renderer_filters_dangerous_link_protocols() {
        let html = ParserGateway::markdown_rs()
            .render_html("[危险链接](javascript:alert(1))")
            .expect("危险协议应被安全地处理");

        assert!(!html.contains("javascript:"));
        assert!(html.contains("危险链接"));
    }

    #[test]
    fn counts_visible_characters_without_markdown_or_whitespace() {
        let source = "# 标题\n\n这是 **粗体** 和 [链接](https://example.com)。\n\n```rust\nfn main() {}\n```";

        assert_eq!(ParserGateway::markdown_rs().character_count(source), 20);
    }

    #[test]
    fn counts_table_text_and_image_alt_text() {
        let source = "| 名称 | 值 |\n| --- | --- |\n| 图片 | ![风景](view.png) |";

        assert_eq!(ParserGateway::markdown_rs().character_count(source), 7);
    }
}
