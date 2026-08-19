#![allow(dead_code)]

use std::sync::Arc;

use markdown::mdast::Node;

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

#[derive(Clone, PartialEq)]
pub struct Document {
    pub blocks: Vec<DocumentNode>,
}

impl Document {
    pub fn fallback_from_source(source: &str) -> Self {
        let blocks = source
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(|line| DocumentNode::Paragraph(line.to_string()))
            .collect();

        Self { blocks }
    }
}

#[derive(Clone, PartialEq)]
pub enum DocumentNode {
    Heading {
        level: u8,
        text: String,
    },
    Paragraph(String),
    CodeBlock {
        language: Option<String>,
        code: String,
    },
    Quote(Vec<DocumentNode>),
    List {
        ordered: bool,
        items: Vec<Vec<DocumentNode>>,
    },
    ThematicBreak,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
}

pub trait MarkdownParserBackend: Send + Sync {
    fn parse(&self, source: &str) -> Result<Document, ParseError>;
    fn render_html(&self, source: &str) -> Result<String, ParseError>;
}

#[derive(Clone)]
pub struct ParserGateway {
    backend: Arc<dyn MarkdownParserBackend>,
}

impl ParserGateway {
    pub fn markdown_rs() -> Self {
        Self {
            backend: Arc::new(MarkdownRsBackend),
        }
    }

    pub fn parse(&self, source: &str) -> Result<Document, ParseError> {
        self.backend.parse(source)
    }

    pub fn render_html(&self, source: &str) -> Result<String, ParseError> {
        self.backend.render_html(source)
    }

    /// Counts visible characters instead of Markdown source punctuation.
    pub fn character_count(&self, source: &str) -> usize {
        markdown::to_mdast(source, &markdown::ParseOptions::gfm())
            .map(|root| visible_character_count(&root))
            .unwrap_or_else(|_| {
                source
                    .chars()
                    .filter(|character| !character.is_whitespace())
                    .count()
            })
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

struct MarkdownRsBackend;

impl MarkdownParserBackend for MarkdownRsBackend {
    fn parse(&self, source: &str) -> Result<Document, ParseError> {
        let root = markdown::to_mdast(source, &markdown::ParseOptions::gfm()).map_err(|err| {
            ParseError {
                message: err.to_string(),
            }
        })?;

        let mut blocks = Vec::new();
        if let Node::Root(root) = root {
            for child in root.children {
                if let Some(block) = node_to_block(child) {
                    blocks.push(block);
                }
            }
        }

        Ok(Document { blocks })
    }

    fn render_html(&self, source: &str) -> Result<String, ParseError> {
        markdown::to_html_with_options(source, &markdown::Options::gfm()).map_err(|error| {
            ParseError {
                message: error.to_string(),
            }
        })
    }
}

fn node_to_block(node: Node) -> Option<DocumentNode> {
    match node {
        Node::Heading(heading) => Some(DocumentNode::Heading {
            level: heading.depth,
            text: inline_text(heading.children),
        }),
        Node::Paragraph(paragraph) => {
            Some(DocumentNode::Paragraph(inline_text(paragraph.children)))
        }
        Node::Code(code) => Some(DocumentNode::CodeBlock {
            language: code.lang,
            code: code.value,
        }),
        Node::Blockquote(quote) => {
            let blocks = quote
                .children
                .into_iter()
                .filter_map(node_to_block)
                .collect::<Vec<_>>();
            Some(DocumentNode::Quote(blocks))
        }
        Node::List(list) => {
            let items = list
                .children
                .into_iter()
                .filter_map(|item| {
                    let Node::ListItem(list_item) = item else {
                        return None;
                    };
                    Some(
                        list_item
                            .children
                            .into_iter()
                            .filter_map(node_to_block)
                            .collect::<Vec<_>>(),
                    )
                })
                .collect::<Vec<_>>();

            Some(DocumentNode::List {
                ordered: list.ordered,
                items,
            })
        }
        Node::ThematicBreak(_) => Some(DocumentNode::ThematicBreak),
        _ => None,
    }
}

fn inline_text(children: Vec<Node>) -> String {
    let mut text = String::new();

    for child in children {
        match child {
            Node::Text(node) => text.push_str(&node.value),
            Node::InlineCode(node) => text.push_str(&node.value),
            Node::Delete(node) => text.push_str(&inline_text(node.children)),
            Node::Emphasis(node) => text.push_str(&inline_text(node.children)),
            Node::Strong(node) => text.push_str(&inline_text(node.children)),
            Node::Link(node) => text.push_str(&inline_text(node.children)),
            Node::LinkReference(node) => text.push_str(&inline_text(node.children)),
            Node::Image(node) => {
                if !node.alt.is_empty() {
                    text.push_str(&node.alt);
                }
            }
            Node::Break(_) => text.push('\n'),
            _ => {}
        }
    }

    text
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
    fn parses_block_structure_used_by_the_document_model() {
        let document = ParserGateway::markdown_rs()
            .parse("# 标题\n\n正文\n\n- 第一项\n- 第二项\n\n```rust\nfn main() {}\n```")
            .expect("有效 Markdown 应能生成文档结构");

        assert!(matches!(
            document.blocks.first(),
            Some(DocumentNode::Heading { level: 1, text }) if text == "标题"
        ));
        assert!(document.blocks.iter().any(
            |node| matches!(node, DocumentNode::List { ordered: false, items } if items.len() == 2)
        ));
        assert!(document.blocks.iter().any(|node| {
            matches!(
                node,
                DocumentNode::CodeBlock { language: Some(language), code }
                    if language == "rust" && code.contains("fn main()")
            )
        }));
    }

    #[test]
    fn fallback_discards_blank_lines_but_preserves_text() {
        let document = Document::fallback_from_source(" 第一段 \n\n第二段\n");

        assert_eq!(document.blocks.len(), 2);
        assert!(matches!(
            &document.blocks[0],
            DocumentNode::Paragraph(text) if text == "第一段"
        ));
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
