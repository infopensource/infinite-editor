use crate::document::ProjectDocument;
use crate::engine::EditorMode;
use dioxus::prelude::*;
use markdown::mdast::Node;

#[derive(Clone, PartialEq, Debug)]
struct Heading {
    title: String,
    depth: u8,
    offset: usize,
}

fn headings(source: &str) -> Vec<Heading> {
    fn label(node: &Node) -> String {
        match node {
            Node::Text(n) => n.value.clone(),
            Node::InlineCode(n) => n.value.clone(),
            Node::InlineMath(n) => n.value.clone(),
            Node::Image(n) => n.alt.clone(),
            _ => node
                .children()
                .map(|children| children.iter().map(label).collect())
                .unwrap_or_default(),
        }
    }
    fn visit(node: &Node, source: &str, result: &mut Vec<Heading>) {
        if let Node::Heading(heading) = node {
            let byte = heading
                .position
                .as_ref()
                .map(|p| p.start.offset)
                .unwrap_or(0);
            result.push(Heading {
                title: label(node),
                depth: heading.depth,
                offset: source[..byte].encode_utf16().count(),
            });
        }
        if let Some(children) = node.children() {
            for child in children {
                visit(child, source, result);
            }
        }
    }
    let mut result = Vec::new();
    if let Ok(root) = markdown::to_mdast(source, &crate::engine::math_parse_options()) {
        visit(&root, source, &mut result);
    }
    result
}

#[component]
pub fn Outline(document: ReadSignal<ProjectDocument>, editor_mode: EditorMode) -> Element {
    let mut open = use_signal(|| true);
    let mut query = use_signal(String::new);
    let mut selected = use_signal(|| None::<usize>);
    let source = use_memo(move || document.read().markdown.clone());
    let entries = use_resource(move || {
        let source = source();
        async move {
            super::background::run(move || headings(&source))
                .await
                .unwrap_or_default()
        }
    });
    let entries = entries.read().as_ref().cloned().unwrap_or_default();
    let base_depth = entries.iter().map(|heading| heading.depth).min().unwrap_or(1);
    let filter = query().trim().to_lowercase();
    let visible: Vec<_> = entries
        .iter()
        .enumerate()
        .filter(|(_, h)| h.title.to_lowercase().contains(&filter))
        .collect();
    rsx! {
        aside { class: if open() { "document-outline" } else { "document-outline collapsed" }, aria_label: "文档大纲",
            div { class: "outline-header",
                if open() {
                    div { class: "outline-heading", strong { "大纲" } span { class: "outline-count", "{entries.len()} 个标题" } }
                }
                button { class: "outline-toggle", r#type: "button", title: if open() { "收起大纲" } else { "展开大纲" },
                    aria_label: if open() { "收起大纲" } else { "展开大纲" }, aria_expanded: open(),
                    onclick: move |_| open.set(!open()),
                    svg { width: "16", height: "16", view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "1.6", stroke_linecap: "round", stroke_linejoin: "round", "aria-hidden": "true",
                        rect { x: "3", y: "4", width: "18", height: "16", rx: "3" }
                        path { d: "M9 4v16" }
                        if open() { path { d: "m15 9-3 3 3 3" } } else { path { d: "m13 9 3 3-3 3" } }
                    }
                }
            }
            if open() {
                div { class: "outline-search-field",
                    svg { width: "14", height: "14", view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "1.7", stroke_linecap: "round", "aria-hidden": "true",
                        circle { cx: "10.5", cy: "10.5", r: "6.5" }
                        path { d: "m16 16 4 4" }
                    }
                input { class: "outline-search", r#type: "search", placeholder: "搜索标题…", aria_label: "搜索大纲标题", value: query(), oninput: move |event| query.set(event.value()) }
                }
                nav { class: "outline-list", aria_label: "章节导航",
                    if entries.is_empty() {
                        div { class: "outline-empty", strong { "从一个标题开始" } p { "将正文设为标题 1–6，章节会自动显示在这里。" } }
                    } else if visible.is_empty() {
                        div { class: "outline-empty", "没有匹配的标题" }
                    }
                    for (index, heading) in visible {
                        button {
                            class: if selected() == Some(index) { "outline-item active" } else { "outline-item" },
                            r#type: "button", style: format!("--outline-depth: {}", heading.depth - base_depth),
                            "data-level": heading.depth,
                            title: heading.title.clone(), aria_current: if selected() == Some(index) { "location" } else { "false" },
                            onclick: {
                                let offset = heading.offset;
                                move |_| {
                                    selected.set(Some(index));
                                    let script = if editor_mode == EditorMode::Wysiwyg {
                                        format!("window.InfiniteWysiwygEditor?.navigateHeading('infinite-prosemirror-host', {index});")
                                    } else {
                                        format!("window.InfiniteMarkdownEditor?.navigateTo('markdown-editor-host', {offset});")
                                    };
                                    let _ = document::eval(&script);
                                }
                            },
                            span { class: "outline-label", if heading.title.is_empty() { "未命名标题" } else { "{heading.title}" } }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_real_headings_and_utf16_offsets() {
        let source =
            "😀\n\n# **第一章** `code`\n\n```md\n# ignored\n```\n\n$$\n# also ignored\n$$\n\n副标题\n---\n\n# 第一章\n";
        let result = headings(source);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].title, "第一章 code");
        assert_eq!(result[0].offset, 4);
        assert_eq!(result[1].depth, 2);
        assert!(result[2].offset > result[1].offset);
    }
}
