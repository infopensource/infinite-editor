use markdown::mdast::{AlignKind, Node};
use serde::{Deserialize, Serialize};

use super::{math_parse_options, ParseError};

pub const INFINITE_AST_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InfiniteAstDocument {
    pub version: u16,
    pub children: Vec<InfiniteAstNode>,
    pub source_map: Vec<InfiniteAstSourceRange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InfiniteAstSourceRange {
    pub path: Vec<u32>,
    pub from: usize,
    pub to: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InfiniteAstNode {
    Paragraph {
        children: Vec<Self>,
    },
    Heading {
        level: u8,
        children: Vec<Self>,
    },
    Blockquote {
        children: Vec<Self>,
    },
    CodeBlock {
        value: String,
        language: Option<String>,
        meta: Option<String>,
    },
    MathBlock {
        value: String,
        meta: Option<String>,
    },
    ThematicBreak,
    List {
        ordered: bool,
        start: Option<u32>,
        children: Vec<Self>,
    },
    ListItem {
        checked: Option<bool>,
        children: Vec<Self>,
    },
    Table {
        align: Vec<Option<String>>,
        children: Vec<Self>,
    },
    TableRow {
        children: Vec<Self>,
    },
    TableCell {
        children: Vec<Self>,
    },
    Definition {
        identifier: String,
        href: String,
        title: Option<String>,
        source: String,
    },
    PageBreak {
        source: String,
    },
    OpaqueBlock {
        syntax: String,
        source: String,
    },
    Text {
        value: String,
    },
    Emphasis {
        children: Vec<Self>,
    },
    Strong {
        children: Vec<Self>,
    },
    Strike {
        children: Vec<Self>,
    },
    CodeInline {
        value: String,
    },
    MathInline {
        value: String,
    },
    HardBreak,
    Link {
        href: String,
        title: Option<String>,
        children: Vec<Self>,
    },
    LinkReference {
        identifier: String,
        children: Vec<Self>,
    },
    Image {
        src: String,
        alt: String,
        title: Option<String>,
    },
    ImageReference {
        identifier: String,
        alt: String,
    },
    OpaqueInline {
        syntax: String,
        source: String,
    },
}

impl InfiniteAstDocument {
    pub fn from_markdown_rs(source: &str) -> Result<Self, ParseError> {
        let root =
            markdown::to_mdast(source, &math_parse_options()).map_err(|error| ParseError {
                message: error.to_string(),
            })?;

        let Node::Root(root) = root else {
            return Err(ParseError {
                message: "markdown-rs 未返回根节点".to_string(),
            });
        };

        let source_map = source_ranges(&root.children, source);
        Ok(Self {
            version: INFINITE_AST_VERSION,
            children: block_nodes(root.children, source),
            source_map,
        })
    }
}

fn source_ranges(nodes: &[Node], source: &str) -> Vec<InfiniteAstSourceRange> {
    fn visit(nodes: &[Node], parent_path: &[u32], output: &mut Vec<InfiniteAstSourceRange>) {
        for (index, node) in nodes.iter().enumerate() {
            let mut path = parent_path.to_vec();
            path.push(index as u32);
            if let Some(position) = node.position() {
                output.push(InfiniteAstSourceRange {
                    path: path.clone(),
                    from: position.start.offset,
                    to: position.end.offset,
                });
            }
            if let Some(children) = node.children() {
                visit(children, &path, output);
            }
        }
    }

    let mut output = Vec::new();
    visit(nodes, &[], &mut output);
    // Convert all requested boundaries in one scan. Rescanning source[..offset]
    // for every AST node makes long, formatted documents quadratic.
    let mut boundaries: Vec<usize> = output
        .iter()
        .flat_map(|range| [range.from, range.to])
        .collect();
    boundaries.sort_unstable();
    boundaries.dedup();
    let mut positions = std::collections::HashMap::with_capacity(boundaries.len());
    let mut characters = source.char_indices().peekable();
    let mut utf16 = 0;
    for boundary in boundaries {
        while characters
            .peek()
            .is_some_and(|(offset, _)| *offset < boundary)
        {
            utf16 += characters.next().unwrap().1.len_utf16();
        }
        positions.insert(boundary, utf16);
    }
    for range in &mut output {
        range.from = positions[&range.from];
        range.to = positions[&range.to];
    }
    output
}

fn source_slice(node: &Node, source: &str) -> String {
    node.position()
        .and_then(|position| source.get(position.start.offset..position.end.offset))
        .unwrap_or_default()
        .to_string()
}

fn syntax_name(node: &Node) -> &'static str {
    match node {
        Node::FootnoteDefinition(_) => "footnote_definition",
        Node::FootnoteReference(_) => "footnote_reference",
        Node::Html(_) => "html",
        Node::MdxFlowExpression(_) | Node::MdxTextExpression(_) => "mdx_expression",
        Node::MdxJsxFlowElement(_) | Node::MdxJsxTextElement(_) => "mdx_jsx",
        Node::MdxjsEsm(_) => "mdx_esm",
        Node::Toml(_) => "toml",
        Node::Yaml(_) => "yaml",
        _ => "unknown",
    }
}

fn is_page_break(source: &str) -> bool {
    let trimmed = source.trim();
    let Some(body) = trimmed
        .strip_prefix("<!--")
        .and_then(|value| value.strip_suffix("-->"))
    else {
        return false;
    };
    body.trim() == "infinite-editor:page-break"
}

fn is_block_directive(source: &str) -> bool {
    let trimmed = source.trim_start();
    trimmed.starts_with("::")
}

fn alignment(align: AlignKind) -> Option<String> {
    match align {
        AlignKind::Left => Some("left".to_string()),
        AlignKind::Right => Some("right".to_string()),
        AlignKind::Center => Some("center".to_string()),
        AlignKind::None => None,
    }
}

fn block_nodes(nodes: Vec<Node>, source: &str) -> Vec<InfiniteAstNode> {
    nodes
        .into_iter()
        .map(|node| block_node(node, source))
        .collect()
}

fn block_node(node: Node, source: &str) -> InfiniteAstNode {
    match node {
        Node::Paragraph(paragraph) => {
            let raw = source_slice(&Node::Paragraph(paragraph.clone()), source);
            if is_block_directive(&raw) {
                InfiniteAstNode::OpaqueBlock {
                    syntax: "directive".to_string(),
                    source: raw,
                }
            } else {
                InfiniteAstNode::Paragraph {
                    children: inline_nodes(paragraph.children, source),
                }
            }
        }
        Node::Heading(heading) => InfiniteAstNode::Heading {
            level: heading.depth,
            children: inline_nodes(heading.children, source),
        },
        Node::Blockquote(blockquote) => InfiniteAstNode::Blockquote {
            children: block_nodes(blockquote.children, source),
        },
        Node::Code(code) => InfiniteAstNode::CodeBlock {
            value: code.value,
            language: code.lang,
            meta: code.meta,
        },
        Node::Math(math) => InfiniteAstNode::MathBlock {
            value: math.value,
            meta: math.meta,
        },
        Node::ThematicBreak(_) => InfiniteAstNode::ThematicBreak,
        Node::List(list) => InfiniteAstNode::List {
            ordered: list.ordered,
            start: list.start,
            children: list
                .children
                .into_iter()
                .map(|item| match item {
                    Node::ListItem(item) => InfiniteAstNode::ListItem {
                        checked: item.checked,
                        children: block_nodes(item.children, source),
                    },
                    other => InfiniteAstNode::OpaqueBlock {
                        syntax: syntax_name(&other).to_string(),
                        source: source_slice(&other, source),
                    },
                })
                .collect(),
        },
        Node::Table(table) => InfiniteAstNode::Table {
            align: table.align.into_iter().map(alignment).collect(),
            children: table
                .children
                .into_iter()
                .map(|row| match row {
                    Node::TableRow(row) => InfiniteAstNode::TableRow {
                        children: row
                            .children
                            .into_iter()
                            .map(|cell| match cell {
                                Node::TableCell(cell) => InfiniteAstNode::TableCell {
                                    children: inline_nodes(cell.children, source),
                                },
                                other => InfiniteAstNode::OpaqueInline {
                                    syntax: syntax_name(&other).to_string(),
                                    source: source_slice(&other, source),
                                },
                            })
                            .collect(),
                    },
                    other => InfiniteAstNode::OpaqueBlock {
                        syntax: syntax_name(&other).to_string(),
                        source: source_slice(&other, source),
                    },
                })
                .collect(),
        },
        Node::Definition(definition) => {
            let raw = source_slice(&Node::Definition(definition.clone()), source);
            InfiniteAstNode::Definition {
                identifier: definition.identifier,
                href: definition.url,
                title: definition.title,
                source: raw,
            }
        }
        Node::Html(html) => {
            let raw = source_slice(&Node::Html(html), source);
            if is_page_break(&raw) {
                InfiniteAstNode::PageBreak { source: raw }
            } else {
                InfiniteAstNode::OpaqueBlock {
                    syntax: "html".to_string(),
                    source: raw,
                }
            }
        }
        other => InfiniteAstNode::OpaqueBlock {
            syntax: syntax_name(&other).to_string(),
            source: source_slice(&other, source),
        },
    }
}

fn inline_nodes(nodes: Vec<Node>, source: &str) -> Vec<InfiniteAstNode> {
    nodes
        .into_iter()
        .map(|node| match node {
            Node::Text(text) => InfiniteAstNode::Text { value: text.value },
            Node::Emphasis(emphasis) => InfiniteAstNode::Emphasis {
                children: inline_nodes(emphasis.children, source),
            },
            Node::Strong(strong) => InfiniteAstNode::Strong {
                children: inline_nodes(strong.children, source),
            },
            Node::Delete(delete) => InfiniteAstNode::Strike {
                children: inline_nodes(delete.children, source),
            },
            Node::InlineCode(code) => InfiniteAstNode::CodeInline { value: code.value },
            Node::InlineMath(math) => InfiniteAstNode::MathInline { value: math.value },
            Node::Break(_) => InfiniteAstNode::HardBreak,
            Node::Link(link) => InfiniteAstNode::Link {
                href: link.url,
                title: link.title,
                children: inline_nodes(link.children, source),
            },
            Node::LinkReference(link) => InfiniteAstNode::LinkReference {
                identifier: link.identifier,
                children: inline_nodes(link.children, source),
            },
            Node::Image(image) => InfiniteAstNode::Image {
                src: image.url,
                alt: image.alt,
                title: image.title,
            },
            Node::ImageReference(image) => InfiniteAstNode::ImageReference {
                identifier: image.identifier,
                alt: image.alt,
            },
            other => InfiniteAstNode::OpaqueInline {
                syntax: syntax_name(&other).to_string(),
                source: source_slice(&other, source),
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_map_unicode_boundaries_match_reference() {
        let source = "# 中文 👩🏽‍💻\n\n**粗体** 与 $x^2$\n\n- 项目 😀\n  - 子项目\n\n| 表 | 格 |\n|---|---|\n|中|文|";
        let Node::Root(root) = markdown::to_mdast(source, &math_parse_options()).unwrap() else {
            panic!("root")
        };
        fn collect(nodes: &[Node], offsets: &mut Vec<(usize, usize)>) {
            for node in nodes {
                if let Some(position) = node.position() {
                    offsets.push((position.start.offset, position.end.offset));
                }
                if let Some(children) = node.children() {
                    collect(children, offsets);
                }
            }
        }
        let mut offsets = Vec::new();
        collect(&root.children, &mut offsets);
        let ranges = source_ranges(&root.children, source);
        for (range, (from, to)) in ranges.iter().zip(offsets) {
            assert_eq!(range.from, source[..from].encode_utf16().count());
            assert_eq!(range.to, source[..to].encode_utf16().count());
        }
    }

    #[test]
    #[ignore = "manual desktop parsing benchmark"]
    fn benchmark_long_document_mapping() {
        let source = include_str!("../../examples/long-paragraph-test/document.md");
        let started = std::time::Instant::now();
        let ast = InfiniteAstDocument::from_markdown_rs(source).unwrap();
        let elapsed = started.elapsed();
        eprintln!(
            "Native debug AST: {} bytes, {} nodes, {:?}",
            source.len(),
            ast.source_map.len(),
            elapsed
        );
        let Node::Root(root) = markdown::to_mdast(source, &math_parse_options()).unwrap() else {
            panic!("root")
        };
        fn previous_mapping(nodes: &[Node], source: &str, checksum: &mut usize) {
            for node in nodes {
                if let Some(position) = node.position() {
                    *checksum += source[..position.start.offset].encode_utf16().count();
                    *checksum += source[..position.end.offset].encode_utf16().count();
                }
                if let Some(children) = node.children() {
                    previous_mapping(children, source, checksum);
                }
            }
        }
        let before = std::time::Instant::now();
        let mut checksum = 0;
        previous_mapping(&root.children, source, &mut checksum);
        eprintln!(
            "Previous mapping alone: {:?}; checksum {}",
            before.elapsed(),
            checksum
        );
        assert_eq!(
            checksum,
            ast.source_map
                .iter()
                .map(|range| range.from + range.to)
                .sum::<usize>()
        );
    }

    #[test]
    fn versioned_document_serializes_with_the_public_contract() {
        let document = InfiniteAstDocument::from_markdown_rs("中文 **粗体**")
            .expect("markdown-rs 应生成 Infinite AST");
        let value = serde_json::to_value(document).expect("Infinite AST 应可序列化");

        assert_eq!(value["version"], INFINITE_AST_VERSION);
        assert_eq!(value["children"][0]["kind"], "paragraph");
        assert_eq!(value["children"][0]["children"][1]["kind"], "strong");
        assert_eq!(value["source_map"][0]["path"], serde_json::json!([0]));
    }

    #[test]
    fn raw_source_uses_utf8_safe_markdown_offsets() {
        let document =
            InfiniteAstDocument::from_markdown_rs("中文\n\n[参考]: https://example.com \"标题\"")
                .expect("包含中文的定义应可解析");

        assert!(matches!(
            document.children.get(1),
            Some(InfiniteAstNode::Definition { source, .. })
                if source == "[参考]: https://example.com \"标题\""
        ));
    }

    #[test]
    fn page_break_is_owned_by_the_ast_contract() {
        let document = InfiniteAstDocument::from_markdown_rs("<!-- infinite-editor:page-break -->")
            .expect("分页标记应可解析");

        assert!(matches!(
            document.children.first(),
            Some(InfiniteAstNode::PageBreak { .. })
        ));
    }

    #[test]
    fn unknown_block_directives_remain_opaque_source() {
        let source = ":::custom\n中文内容\n:::";
        let document =
            InfiniteAstDocument::from_markdown_rs(source).expect("未知块指令应进入受保护节点");

        assert!(matches!(
            document.children.first(),
            Some(InfiniteAstNode::OpaqueBlock { syntax, source: raw })
                if syntax == "directive" && raw == source
        ));
    }

    #[test]
    fn markdown_rs_matches_the_shared_v1_golden_contract() {
        let source = include_str!("../../web/wysiwyg/fixtures/infinite_ast_v1.md");
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../web/wysiwyg/fixtures/infinite_ast_v1.json"
        ))
        .expect("共享 Infinite AST 黄金文件应是有效 JSON");
        let mut actual = serde_json::to_value(
            InfiniteAstDocument::from_markdown_rs(source)
                .expect("markdown-rs 应解析共享黄金 Markdown"),
        )
        .expect("Infinite AST 应可序列化");
        actual
            .as_object_mut()
            .expect("Infinite AST 应为 JSON 对象")
            .remove("source_map");

        assert_eq!(actual, expected);
    }

    #[test]
    fn math_input_serialization_preserves_tex_and_literal_dollars() {
        let source = r"相邻素数 $H_1=\liminf_{n\to\infty}(p_{n+1}-p_n)\le 186$，原样 \$x\$，$$\text{price: \$5}$$";
        let document = InfiniteAstDocument::from_markdown_rs(source)
            .expect("公式输入规则生成的 Markdown 应可解析");
        let value = serde_json::to_value(document).expect("AST 应可序列化");
        let children = value["children"][0]["children"].as_array().unwrap();
        let formulas: Vec<_> = children
            .iter()
            .filter(|node| node["kind"] == "math_inline")
            .map(|node| node["value"].as_str().unwrap())
            .collect();
        assert_eq!(
            formulas,
            vec![
                r"H_1=\liminf_{n\to\infty}(p_{n+1}-p_n)\le 186",
                r"\text{price: \$5}",
            ]
        );
        assert!(children
            .iter()
            .any(|node| node["kind"] == "text" && node["value"].as_str().unwrap().contains("$x$")));
    }

    #[test]
    fn source_map_uses_javascript_utf16_offsets() {
        let document =
            InfiniteAstDocument::from_markdown_rs("中文 **粗体**").expect("中文 Markdown 应可解析");

        assert_eq!(
            document.source_map,
            vec![
                InfiniteAstSourceRange {
                    path: vec![0],
                    from: 0,
                    to: 9,
                },
                InfiniteAstSourceRange {
                    path: vec![0, 0],
                    from: 0,
                    to: 3,
                },
                InfiniteAstSourceRange {
                    path: vec![0, 1],
                    from: 3,
                    to: 9,
                },
                InfiniteAstSourceRange {
                    path: vec![0, 1, 0],
                    from: 5,
                    to: 7,
                },
            ]
        );
    }
}
