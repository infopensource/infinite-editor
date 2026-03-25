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
    Heading { level: u8, text: String },
    Paragraph(String),
    CodeBlock { language: Option<String>, code: String },
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
}

struct MarkdownRsBackend;

impl MarkdownParserBackend for MarkdownRsBackend {
    fn parse(&self, source: &str) -> Result<Document, ParseError> {
        let root = markdown::to_mdast(source, &markdown::ParseOptions::default()).map_err(|err| ParseError {
            message: err.to_string(),
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
        Ok(markdown::to_html(source))
    }
}

fn node_to_block(node: Node) -> Option<DocumentNode> {
    match node {
        Node::Heading(heading) => Some(DocumentNode::Heading {
            level: heading.depth,
            text: inline_text(heading.children),
        }),
        Node::Paragraph(paragraph) => Some(DocumentNode::Paragraph(inline_text(paragraph.children))),
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
