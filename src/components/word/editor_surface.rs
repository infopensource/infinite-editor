use crate::config::{
    MIN_PAGE_CONTENT_WIDTH_MM, RULER_MAJOR_STEP_MM, RULER_MID_STEP_MM, RULER_MINOR_STEP_MM,
};
use crate::document::{Orientation, PageMargins, PaperMode, ProjectDocument, ResourceBundle};
use crate::engine::EditorMode;
use dioxus::prelude::*;

use super::document_layout::{resolved_paper_size, ruler_position_percent};
use super::document_renderer::{render_html_with_page_breaks, DocumentRenderer};
use super::MARKDOWN_DOCUMENT_BRIDGE_ID;

const MARKDOWN_EDITOR_HOST_ID: &str = "markdown-editor-host";
const MARKDOWN_PREVIEW_ID: &str = "markdown-math-preview";
const MARKDOWN_PREVIEW_PANE_ID: &str = "markdown-preview-pane";
const MARKDOWN_WORKSPACE_ID: &str = "markdown-workspace";
const MARKDOWN_SPLITTER_ID: &str = "markdown-splitter";

fn mount_markdown_splitter() {
    spawn(async move {
        let script = format!(
            r#"
                const workspace = document.getElementById('{MARKDOWN_WORKSPACE_ID}');
                const splitter = document.getElementById('{MARKDOWN_SPLITTER_ID}');
                if (!workspace || !splitter || splitter.dataset.ready === 'true') return;
                splitter.dataset.ready = 'true';

                const setRatio = (ratio) => {{
                    const next = Math.max(15, Math.min(85, ratio));
                    workspace.style.setProperty('--markdown-editor-ratio', `${{next}}%`);
                    splitter.setAttribute('aria-valuenow', String(Math.round(next)));
                    window.InfiniteMarkdownEditor?.layout?.('{MARKDOWN_EDITOR_HOST_ID}');
                }};
                const ratioFromPointer = (event) => {{
                    const bounds = workspace.getBoundingClientRect();
                    const splitterCenter = splitter.getBoundingClientRect().width / 2;
                    setRatio(((event.clientX - bounds.left - splitterCenter) / bounds.width) * 100);
                }};

                splitter.addEventListener('pointerdown', (event) => {{
                    event.preventDefault();
                    splitter.setPointerCapture(event.pointerId);
                    splitter.classList.add('dragging');
                    document.body.classList.add('markdown-split-resizing');
                    ratioFromPointer(event);
                }});
                splitter.addEventListener('pointermove', (event) => {{
                    if (splitter.hasPointerCapture(event.pointerId)) ratioFromPointer(event);
                }});
                const stopDragging = (event) => {{
                    if (splitter.hasPointerCapture(event.pointerId)) {{
                        splitter.releasePointerCapture(event.pointerId);
                    }}
                    splitter.classList.remove('dragging');
                    document.body.classList.remove('markdown-split-resizing');
                }};
                splitter.addEventListener('pointerup', stopDragging);
                splitter.addEventListener('pointercancel', stopDragging);
                splitter.addEventListener('dblclick', () => setRatio(50));
            "#
        );
        let _ = document::eval(&script).await;
    });
}

fn render_markdown_preview(resources: ResourceBundle) {
    spawn(async move {
        let resources =
            serde_json::to_string(resources.entries()).unwrap_or_else(|_| "{}".into());
        let script = format!(
            r#"
                const nextFrame = () => new Promise(requestAnimationFrame);
                const render = async () => {{
                    // `dangerous_inner_html` and this effect can be committed in
                    // the same render pass. Wait until the new preview DOM exists
                    // before replacing Markdown's temporary math code nodes.
                    await nextFrame();
                    window.InfiniteDocumentRenderer?.hydrateResources(
                        document.getElementById('{MARKDOWN_PREVIEW_ID}'),
                        {resources}
                    );
                    const result = window.InfiniteMathRenderer.render(
                        document.getElementById('{MARKDOWN_PREVIEW_ID}')
                    );
                    window.InfiniteMarkdownEditor?.syncPreview(
                        '{MARKDOWN_EDITOR_HOST_ID}',
                        '{MARKDOWN_PREVIEW_PANE_ID}'
                    );
                    return result;
                }};
                if (window.InfiniteMathRenderer) {{
                    return JSON.stringify(await render());
                }}
                return await new Promise((resolve) => window.addEventListener(
                    'infinite-math-renderer-ready',
                    async () => resolve(JSON.stringify(await render())),
                    {{ once: true }}
                ));
            "#
        );
        let _ = document::eval(&script).join::<String>().await;
    });
}

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
            bridge_id = MARKDOWN_DOCUMENT_BRIDGE_ID,
        );

        let result = document::eval(&script).join::<String>().await;
        report_editor_result("初始化", result, editor_error);
    });
}

#[component]
pub fn EditorSurface(
    editor_mode: EditorMode,
    markdown_preview_open: bool,
    document: ReadSignal<ProjectDocument>,
    resources: ReadSignal<ResourceBundle>,
    document_revision: ReadSignal<u64>,
    editor_revision: ReadSignal<u64>,
    on_markdown_change: EventHandler<String>,
    paper_mode: PaperMode,
    custom_width_mm: f32,
    custom_height_mm: f32,
    orientation: Orientation,
    margins: PageMargins,
    show_ruler: bool,
    on_left_margin_change: EventHandler<f32>,
    on_right_margin_change: EventHandler<f32>,
) -> Element {
    let editor_error = use_signal(|| None::<String>);
    let mut source_session = use_signal(|| None::<u64>);

    use_effect(move || {
        let revision = document_revision();
        if editor_mode == EditorMode::MarkdownSource && source_session() != Some(revision) {
            source_session.set(Some(revision));
            mount_markdown_editor(document.read().markdown.clone(), revision, editor_error);
        }
    });

    let source = document.read().markdown.clone();

    let paper_size =
        resolved_paper_size(paper_mode, custom_width_mm, custom_height_mm, orientation);
    let should_render_html = editor_mode == EditorMode::MarkdownSource && markdown_preview_open;
    let rendered_html = if should_render_html {
        render_html_with_page_breaks(&source)
            .unwrap_or_else(|_| "<p>渲染失败</p>".to_string())
    } else {
        String::new()
    };

    use_effect(move || {
        let _ = document.read().markdown.clone();
        if editor_mode == EditorMode::MarkdownSource && markdown_preview_open {
            render_markdown_preview(resources.read().clone());
        }
    });

    if editor_mode == EditorMode::MarkdownSource {
        let markdown_layout_class = if markdown_preview_open {
            "markdown-workspace with-preview"
        } else {
            "markdown-workspace immersive"
        };

        return rsx! {
            textarea {
                id: MARKDOWN_DOCUMENT_BRIDGE_ID,
                class: "markdown-editor-bridge",
                oninput: move |evt| on_markdown_change.call(evt.value()),
            }
            main { class: "editor-surface markdown-mode",
                div {
                    id: MARKDOWN_WORKSPACE_ID,
                    class: markdown_layout_class,
                    section { class: "markdown-editor-pane",
                        div { class: "markdown-editor-stack",
                            div {
                                id: MARKDOWN_EDITOR_HOST_ID,
                                class: "markdown-code-editor",
                                onmounted: move |_| {
                                    mount_markdown_editor(
                                        document.read().markdown.clone(),
                                        document_revision(),
                                        editor_error,
                                    )
                                },
                            }
                            if let Some(message) = editor_error() {
                                div { class: "markdown-editor-fallback",
                                    strong { "Markdown 编辑器加载失败" }
                                    p { "{message}" }
                                    p {
                                        "请检查 editor.bundle.js 是否为最新版本，然后重启应用。"
                                    }
                                }
                            }
                        }
                    }
                    if markdown_preview_open {
                        div {
                            id: MARKDOWN_SPLITTER_ID,
                            class: "markdown-split-line",
                            role: "separator",
                            aria_orientation: "vertical",
                            aria_label: "调整 Markdown 编辑区与预览区宽度",
                            aria_valuemin: 15,
                            aria_valuemax: 85,
                            aria_valuenow: 50,
                            title: "拖动调整双栏比例，双击恢复均分",
                            onmounted: move |_| mount_markdown_splitter(),
                        }
                        section {
                            id: MARKDOWN_PREVIEW_PANE_ID,
                            class: "markdown-preview-pane",
                            if source.trim().is_empty() {
                                p { class: "markdown-preview-placeholder", "预览区" }
                            } else {
                                div {
                                    id: MARKDOWN_PREVIEW_ID,
                                    class: "markdown-rendered-html",
                                    dangerous_inner_html: "{rendered_html.clone()}",
                                    onmounted: move |_| render_markdown_preview(resources.read().clone()),
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
            let left_mm = (margins.left_mm.round() as u16).min(maximum_margin_total);
            let right_mm =
                (margins.right_mm.round() as u16).min(maximum_margin_total.saturating_sub(left_mm));
            let mut effective_margins = margins.clone();
            effective_margins.left_mm = left_mm as f32;
            effective_margins.right_mm = right_mm as f32;
            let style = format!(
            "--page-width: {:.3}mm; --page-height: {:.3}mm; --page-padding-left: {:.3}mm; --page-padding-right: {:.3}mm; --page-padding-top: {:.3}mm; --page-padding-bottom: {:.3}mm;",
            size.width,
            size.height,
            effective_margins.left_mm,
            effective_margins.right_mm,
            effective_margins.top_mm,
            effective_margins.bottom_mm,
        );

            (style, false, Some(width_mm), left_mm, right_mm)
        } else {
            let style = "--page-width: min(1120px, 94vw); --page-height: auto; --page-padding-left: 88px; --page-padding-right: 88px; --page-padding-top: 72px; --page-padding-bottom: 72px;".to_string();
            (
                style,
                true,
                None,
                margins.left_mm.round() as u16,
                margins.right_mm.round() as u16,
            )
        };

    rsx! {
        textarea {
            id: MARKDOWN_DOCUMENT_BRIDGE_ID,
            class: "markdown-editor-bridge",
            oninput: move |evt| on_markdown_change.call(evt.value()),
        }
        main { class: "editor-surface",
            if show_ruler && ruler_width_mm.is_some() {
                div { class: "page-ruler-sticky",
                    div { class: "page-ruler", style: page_style.clone(),
                        div { class: "ruler-track",
                            for millimeter in (0..=ruler_width_mm.unwrap()).step_by(RULER_MINOR_STEP_MM as usize) {
                                span {
                                    class: if millimeter % RULER_MAJOR_STEP_MM == 0 { "ruler-tick major" } else if millimeter % RULER_MID_STEP_MM == 0 { "ruler-tick mid" } else { "ruler-tick minor" },
                                    style: format!(
                                        "left: {:.6}%;",
                                        ruler_position_percent(millimeter, ruler_width_mm.unwrap()),
                                    ),
                                }
                            }
                            for millimeter in (0..=ruler_width_mm.unwrap()).step_by(RULER_MAJOR_STEP_MM as usize) {
                                span {
                                    class: if millimeter == 0 { "ruler-mark origin" } else if millimeter == ruler_width_mm.unwrap() { "ruler-mark endpoint" } else { "ruler-mark" },
                                    style: format!(
                                        "left: {:.6}%;",
                                        ruler_position_percent(millimeter, ruler_width_mm.unwrap()),
                                    ),
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
                                        let maximum = ruler_width_mm
                                            .unwrap()
                                            .saturating_sub(effective_right_mm + MIN_PAGE_CONTENT_WIDTH_MM);
                                        on_left_margin_change.call(next.min(maximum) as f32);
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
                                        on_right_margin_change.call((ruler_width_mm.unwrap() - position) as f32);
                                    }
                                },
                            }
                        }
                    }
                }
            }

            DocumentRenderer {
                document,
                resources,
                document_revision,
                editor_revision,
                page_style,
                seamless,
            }
        }
    }
}
