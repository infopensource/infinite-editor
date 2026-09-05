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
        markdown::to_html_with_options(source, &math_options()).map_err(|error| ParseError {
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
    fn renders_common_markdown_to_html() {
        let html = ParserGateway::markdown_rs()
            .render_html("# 标题\n\n这是 **粗体** 和 `代码`。")
            .expect("普通 Markdown 应能完成渲染");

        assert!(html.contains("<h1>标题</h1>"));
        assert!(html.contains("<strong>粗体</strong>"));
        assert!(html.contains("<code>代码</code>"));
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
