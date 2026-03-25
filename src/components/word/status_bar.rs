use dioxus::prelude::*;
use crate::engine::EditorMode;

#[component]
pub fn StatusBar(
    zoom: u16,
    editor_mode: EditorMode,
    markdown_preview_open: bool,
    on_markdown_click: EventHandler<()>,
    on_wysiwyg_click: EventHandler<()>,
) -> Element {
    let markdown_btn_class = if editor_mode == EditorMode::MarkdownSource {
        "status-view active"
    } else {
        "status-view"
    };

    let wysiwyg_btn_class = if editor_mode == EditorMode::Wysiwyg {
        "status-view active"
    } else {
        "status-view"
    };

    let markdown_label = if editor_mode == EditorMode::MarkdownSource {
        if markdown_preview_open {
            "Markdown：双栏"
        } else {
            "Markdown：沉浸"
        }
    } else {
        EditorMode::MarkdownSource.label()
    };

    rsx! {
        footer { class: "status-bar",
            div { class: "status-left",
                span { "第 1 页，共 1 页" }
                span { class: "status-dot", "•" }
                span { "字数: 128" }
                span { class: "status-dot", "•" }
                span { "中文(简体)" }
            }
            div { class: "status-right",
                button {
                    class: markdown_btn_class,
                    onclick: move |_| on_markdown_click.call(()),
                    "{markdown_label}"
                }
                button {
                    class: wysiwyg_btn_class,
                    onclick: move |_| on_wysiwyg_click.call(()),
                    "{EditorMode::Wysiwyg.label()}"
                }
                span { class: "zoom-text", "{zoom}%" }
            }
        }
    }
}
