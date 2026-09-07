use crate::engine::EditorMode;
use dioxus::prelude::*;

#[component]
pub fn StatusBar(
    mut zoom: Signal<u16>,
    editor_mode: EditorMode,
    markdown_preview_open: bool,
    status_hint: String,
    current_file: Option<String>,
    character_count: usize,
    selection_active: bool,
    selected_character_count: Option<usize>,
    current_page: usize,
    total_pages: usize,
    on_markdown_click: EventHandler<()>,
    on_wysiwyg_click: EventHandler<()>,
) -> Element {
    // Keep zoom subscriptions here: changing magnification must not rerender
    // the workspace and clone the document or rebuild preview content.
    use_effect(move || {
        let scale = f64::from(zoom()) / 100.0;
        let _ = document::eval(&format!(
            r#"
            const shell = document.querySelector('.word-shell');
            if (shell) shell.style.setProperty('--editor-zoom', '{scale}');
            // Coalesce rapid slider input and refresh viewport-only overlays.
            cancelAnimationFrame(window.__infiniteZoomFrame);
            window.__infiniteZoomFrame = requestAnimationFrame(() => {{
                window.dispatchEvent(new Event('infinite-editor-zoom'));
            }});
        "#
        ));
    });
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

    let file_label = current_file.unwrap_or_else(|| "未命名文档".to_string());

    rsx! {
        footer { class: "status-bar",
            div { class: "status-left",
                span { class: "status-state", "{status_hint}" }
                span { class: "status-dot", "•" }
                span { class: "status-file", "{file_label}" }
                span { class: "status-dot", "•" }
                if selection_active {
                    if let Some(selected_count) = selected_character_count {
                        span { class: "status-count", "字数：{selected_count}（已选）" }
                    } else {
                        span { class: "status-count", "字数：统计中（已选）" }
                    }
                } else {
                    span { class: "status-count", "字数：{character_count}" }
                }
                if editor_mode == EditorMode::Wysiwyg {
                    span { class: "status-dot", "•" }
                    span { class: "status-count", "第 {current_page} 页 / 共 {total_pages} 页" }
                }
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
                button {
                    class: "status-view", r#type: "button",
                    aria_label: "缩小", disabled: editor_mode != EditorMode::Wysiwyg || zoom() <= 50,
                    onmousedown: move |event| event.prevent_default(),
                    onclick: move |_| zoom.with_mut(|value| *value = value.saturating_sub(10).max(50)),
                    "−"
                }
                input {
                    class: "zoom-slider", r#type: "range",
                    disabled: editor_mode != EditorMode::Wysiwyg,
                    aria_label: "文档缩放比例", min: 50, max: 200, step: 10,
                    value: zoom(),
                    oninput: move |event| {
                        if let Ok(value) = event.value().parse::<u16>() {
                            zoom.set(value.clamp(50, 200));
                        }
                    },
                }
                button {
                    class: "status-view", r#type: "button",
                    aria_label: "放大", disabled: editor_mode != EditorMode::Wysiwyg || zoom() >= 200,
                    onmousedown: move |event| event.prevent_default(),
                    onclick: move |_| zoom.with_mut(|value| *value = (*value + 10).min(200)),
                    "+"
                }
                button {
                    class: "status-view zoom-text", r#type: "button",
                    disabled: editor_mode != EditorMode::Wysiwyg,
                    title: "恢复 100%", aria_label: "恢复百分之百缩放",
                    onmousedown: move |event| event.prevent_default(),
                    onclick: move |_| zoom.set(100),
                    if editor_mode == EditorMode::Wysiwyg { "{zoom}%" } else { "100%" }
                }
            }
        }
    }
}
