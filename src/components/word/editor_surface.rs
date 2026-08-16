use crate::config::{
    DEFAULT_PAGE_MARGIN_LEFT_MM, DEFAULT_PAGE_MARGIN_RIGHT_MM, MIN_PAGE_CONTENT_WIDTH_MM,
    RULER_MAJOR_STEP_MM, RULER_MID_STEP_MM, RULER_MINOR_STEP_MM,
};
use crate::engine::{EditorMode, ParserGateway};
use dioxus::prelude::*;

use super::document_layout::{
    page_layout_px_with_margins, resolved_paper_size, ruler_position_percent, PaperMode,
};

const MARKDOWN_EDITOR_HOST_ID: &str = "markdown-editor-host";
const MARKDOWN_EDITOR_BRIDGE_ID: &str = "markdown-editor-bridge";

fn report_editor_result(
    operation: &str,
    result: Result<String, dioxus::document::EvalError>,
    mut editor_error: Signal<Option<String>>,
) {
    let parsed = result.map_err(|error| error.to_string()).and_then(|json| {
        serde_json::from_str::<serde_json::Value>(&json).map_err(|error| error.to_string())
    });

    match parsed {
        Ok(value) if value.get("ok").and_then(|ok| ok.as_bool()) == Some(true) => {
            editor_error.set(None);
        }
        Ok(value) => {
            let message = value
                .get("error")
                .and_then(|error| error.as_str())
                .unwrap_or("未知 JavaScript 错误")
                .to_string();
            eprintln!("CodeMirror {operation}失败: {message}");
            editor_error.set(Some(message));
        }
        Err(message) => {
            eprintln!("CodeMirror {operation}通信失败: {message}");
            editor_error.set(Some(message));
        }
    }
}

fn mount_markdown_editor(
    initial_value: String,
    document_revision: u64,
    editor_error: Signal<Option<String>>,
) {
    spawn(async move {
        let initial_value = serde_json::to_string(&initial_value).unwrap_or_else(|_| "\"\"".into());
        let script = format!(
            r#"
                const mount = () => window.InfiniteMarkdownEditor.mount(
                    '{host_id}', '{bridge_id}', {initial_value}, {document_revision}
                );
                if (window.InfiniteMarkdownEditor) return JSON.stringify(mount());

                return await new Promise((resolve) => {{
                    const ready = () => {{
                        clearTimeout(timeout);
                        resolve(JSON.stringify(mount()));
                    }};
                    const timeout = setTimeout(() => {{
                        window.removeEventListener('infinite-markdown-editor-ready', ready);
                        resolve(JSON.stringify({{
                            ok: false,
                            error: 'CodeMirror 脚本在 5 秒内未就绪'
                        }}));
                    }}, 5000);
                    window.addEventListener('infinite-markdown-editor-ready', ready, {{ once: true }});
                }});
            "#,
            host_id = MARKDOWN_EDITOR_HOST_ID,
            bridge_id = MARKDOWN_EDITOR_BRIDGE_ID,
        );

        let result = document::eval(&script).join::<String>().await;
        report_editor_result("初始化", result, editor_error);
    });
}

fn sync_markdown_editor(
    value: String,
    document_revision: u64,
    editor_error: Signal<Option<String>>,
) {
    spawn(async move {
        let value = serde_json::to_string(&value).unwrap_or_else(|_| "\"\"".into());
        let script = format!(
            r#"
                if (!window.InfiniteMarkdownEditor) return JSON.stringify({{ ok: true }});
                return JSON.stringify(window.InfiniteMarkdownEditor.setValue(
                    '{MARKDOWN_EDITOR_HOST_ID}', {value}, {document_revision}
                ));
            "#
        );
        let result = document::eval(&script).join::<String>().await;
        report_editor_result("同步", result, editor_error);
    });
}

#[component]
pub fn EditorSurface(
    editor_mode: EditorMode,
    markdown_preview_open: bool,
    markdown_source: ReadSignal<String>,
    document_revision: ReadSignal<u64>,
    on_markdown_change: EventHandler<String>,
    paper_mode: PaperMode,
    custom_width_mm: u16,
    custom_height_mm: u16,
    show_ruler: bool,
) -> Element {
    let mut left_margin_mm = use_signal(|| DEFAULT_PAGE_MARGIN_LEFT_MM);
    let mut right_margin_mm = use_signal(|| DEFAULT_PAGE_MARGIN_RIGHT_MM);
    let editor_error = use_signal(|| None::<String>);

    use_effect(move || {
        sync_markdown_editor(markdown_source(), document_revision(), editor_error);
    });

    let source = markdown_source();

    let paper_size = resolved_paper_size(paper_mode, custom_width_mm, custom_height_mm);
    let parser = ParserGateway::markdown_rs();
    let should_render_html = editor_mode == EditorMode::Wysiwyg
        || (editor_mode == EditorMode::MarkdownSource && markdown_preview_open);
    let rendered_html = if should_render_html {
        parser
            .render_html(&source)
            .unwrap_or_else(|_| "<p>渲染失败</p>".to_string())
    } else {
        String::new()
    };

    if editor_mode == EditorMode::MarkdownSource {
        let markdown_layout_class = if markdown_preview_open {
            "markdown-workspace with-preview"
        } else {
            "markdown-workspace immersive"
        };

        return rsx! {
            main { class: "editor-surface markdown-mode",
                div { class: markdown_layout_class,
                    section { class: "markdown-editor-pane",
                        div { class: "markdown-editor-stack",
                            div {
                                id: MARKDOWN_EDITOR_HOST_ID,
                                class: "markdown-code-editor",
                                onmounted: move |_| {
                                    mount_markdown_editor(
                                        markdown_source(),
                                        document_revision(),
                                        editor_error,
                                    )
                                },
                            }
                            if let Some(message) = editor_error() {
                                div { class: "markdown-editor-fallback",
                                    strong { "Markdown 编辑器加载失败" }
                                    p { "{message}" }
                                    p { "请检查 editor.bundle.js 是否为最新版本，然后重启应用。" }
                                }
                            }
                            textarea {
                                id: MARKDOWN_EDITOR_BRIDGE_ID,
                                class: "markdown-editor-bridge",
                                oninput: move |evt| {
                                    on_markdown_change.call(evt.value());
                                },
                            }
                        }
                    }
                    if markdown_preview_open {
                        div { class: "markdown-split-line" }
                        section { class: "markdown-preview-pane",
                            if source.trim().is_empty() {
                                p { class: "markdown-preview-placeholder", "预览区" }
                            } else {
                                div {
                                    class: "markdown-rendered-html",
                                    dangerous_inner_html: "{rendered_html.clone()}",
                                }
                            }
                        }
                    }
                }
            }
        };
    }

    let (page_style, seamless, ruler_width_mm, effective_left_mm, effective_right_mm) =
        if let Some(size) = paper_size {
            let width_mm = size.width.round() as u16;
            let maximum_margin_total = width_mm.saturating_sub(MIN_PAGE_CONTENT_WIDTH_MM);
            let left_mm = left_margin_mm().min(maximum_margin_total);
            let right_mm = right_margin_mm().min(maximum_margin_total.saturating_sub(left_mm));
            let layout = page_layout_px_with_margins(size, left_mm, right_mm);
            let style = format!(
            "--page-width: {:.2}px; --page-height: {:.2}px; --page-padding-left: {:.2}px; --page-padding-right: {:.2}px; --page-padding-y: {:.2}px;",
            layout.page_width,
            layout.page_height,
            layout.padding_left,
            layout.padding_right,
            layout.padding_vertical,
        );

            (style, false, Some(width_mm), left_mm, right_mm)
        } else {
            let style = "--page-width: min(1120px, 94vw); --page-height: auto; --page-padding-left: 88px; --page-padding-right: 88px; --page-padding-y: 72px;".to_string();
            (
                style,
                true,
                None,
                DEFAULT_PAGE_MARGIN_LEFT_MM,
                DEFAULT_PAGE_MARGIN_RIGHT_MM,
            )
        };

    rsx! {
        main { class: "editor-surface",
            if show_ruler && ruler_width_mm.is_some() {
                div { class: "page-ruler-sticky",
                    div { class: "page-ruler", style: page_style.clone(),
                        div { class: "ruler-track",
                            for millimeter in (0..=ruler_width_mm.unwrap()).step_by(RULER_MINOR_STEP_MM as usize) {
                                span {
                                    class: if millimeter % RULER_MAJOR_STEP_MM == 0 {
                                        "ruler-tick major"
                                    } else if millimeter % RULER_MID_STEP_MM == 0 {
                                        "ruler-tick mid"
                                    } else {
                                        "ruler-tick minor"
                                    },
                                    style: format!("left: {:.6}%;", ruler_position_percent(millimeter, ruler_width_mm.unwrap())),
                                }
                            }
                            for millimeter in (0..=ruler_width_mm.unwrap()).step_by(RULER_MAJOR_STEP_MM as usize) {
                                span {
                                    class: if millimeter == 0 {
                                        "ruler-mark origin"
                                    } else if millimeter == ruler_width_mm.unwrap() {
                                        "ruler-mark endpoint"
                                    } else {
                                        "ruler-mark"
                                    },
                                    style: format!("left: {:.6}%;", ruler_position_percent(millimeter, ruler_width_mm.unwrap())),
                                    "{millimeter}"
                                }
                            }
                            input {
                                class: "ruler-slider left",
                                title: format!("左页边距：{} mm", effective_left_mm),
                                aria_label: "左页边距（毫米）",
                                r#type: "range",
                                min: 0,
                                max: ruler_width_mm.unwrap(),
                                step: 1,
                                value: effective_left_mm,
                                oninput: move |evt| {
                                    if let Ok(next) = evt.value().parse::<u16>() {
                                        let maximum = ruler_width_mm.unwrap()
                                            .saturating_sub(effective_right_mm + MIN_PAGE_CONTENT_WIDTH_MM);
                                        left_margin_mm.set(next.min(maximum));
                                    }
                                },
                            }
                            input {
                                class: "ruler-slider right",
                                title: format!("右页边距：{} mm", effective_right_mm),
                                aria_label: "右页边距（毫米）",
                                r#type: "range",
                                min: 0,
                                max: ruler_width_mm.unwrap(),
                                step: 1,
                                value: ruler_width_mm.unwrap().saturating_sub(effective_right_mm),
                                oninput: move |evt| {
                                    if let Ok(marker_position) = evt.value().parse::<u16>() {
                                        let minimum = effective_left_mm + MIN_PAGE_CONTENT_WIDTH_MM;
                                        let position = marker_position.max(minimum).min(ruler_width_mm.unwrap());
                                        right_margin_mm.set(ruler_width_mm.unwrap() - position);
                                    }
                                },
                            }
                        }
                    }
                }
            }

            div { class: if seamless { "document-flow seamless" } else { "document-flow paged" },
                article {
                    class: if seamless { "document-page seamless-page" } else { "document-page paged-page" },
                    style: page_style,
                    if source.trim().is_empty() {
                        p { class: "markdown-preview-placeholder",
                            "请在 Markdown 源码模式输入内容"
                        }
                    } else {
                        div {
                            class: "markdown-rendered-html",
                            dangerous_inner_html: "{rendered_html}",
                        }
                    }
                }
            }
        }
    }
}
