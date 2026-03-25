use dioxus::prelude::*;
use crate::engine::{highlight_markdown_source, EditorMode, ParserGateway};

use super::document_layout::{page_layout_px, resolved_paper_size, PaperMode, MM_TO_PX};

const MARKDOWN_EDITOR_INPUT_ID: &str = "markdown-editor-input";

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn highlighted_editor_html(source: &str) -> String {
    let highlighted = highlight_markdown_source(source);
    let mut out = String::new();

    for line in highlighted {
        out.push_str("<div class=\"markdown-editor-line\">");
        if line.tokens.is_empty() {
            out.push_str("<span>&nbsp;</span>");
        } else {
            for token in line.tokens {
                out.push_str("<span style=\"");
                out.push_str(&token.style);
                out.push_str("\">");
                out.push_str(&escape_html(&token.text));
                out.push_str("</span>");
            }
        }
        out.push_str("</div>");
    }

    if source.ends_with('\n') {
        out.push_str("<div class=\"markdown-editor-line\"><span>&nbsp;</span></div>");
    }

    if source.is_empty() {
        out.push_str("<div class=\"markdown-editor-line\"><span>&nbsp;</span></div>");
    }

    out
}

fn read_textarea_scroll(mut scroll_top: Signal<i32>, mut scroll_left: Signal<i32>) {
    spawn(async move {
        let script = format!(
            r#"(() => {{
                const el = document.getElementById('{id}');
                if (!el) return [0, 0];
                return [el.scrollTop || 0, el.scrollLeft || 0];
            }})();"#,
            id = MARKDOWN_EDITOR_INPUT_ID
        );

        if let Ok((top, left)) = document::eval(&script).join::<(i32, i32)>().await {
            scroll_top.set(top);
            scroll_left.set(left);
        }
    });
}

#[component]
pub fn EditorSurface(
    editor_mode: EditorMode,
    markdown_preview_open: bool,
    markdown_source: String,
    on_markdown_change: EventHandler<String>,
    paper_mode: PaperMode,
    custom_width_mm: u16,
    custom_height_mm: u16,
    show_ruler: bool,
) -> Element {
    let mut left_slider = use_signal(|| 10u16);
    let mut right_slider = use_signal(|| 90u16);
    let mut draft_source = use_signal(|| markdown_source.clone());
    let mut committed_source = use_signal(|| markdown_source.clone());
    let mut composing_lock = use_signal(|| false);
    let editor_scroll_top = use_signal(|| 0i32);
    let editor_scroll_left = use_signal(|| 0i32);

    use_effect(move || {
        if !composing_lock() && markdown_source != committed_source() {
            draft_source.set(markdown_source.clone());
            committed_source.set(markdown_source.clone());
        }
    });

    let paper_size = resolved_paper_size(paper_mode, custom_width_mm, custom_height_mm);
    let parser = ParserGateway::markdown_rs();
    let should_render_html = editor_mode == EditorMode::Wysiwyg
        || (editor_mode == EditorMode::MarkdownSource && markdown_preview_open);
    let rendered_html = if should_render_html {
        parser
            .render_html(&committed_source())
            .unwrap_or_else(|_| "<p>渲染失败</p>".to_string())
    } else {
        String::new()
    };

    if editor_mode == EditorMode::MarkdownSource {
        let highlighted_html = highlighted_editor_html(&draft_source());
        let input_class = if composing_lock() {
            "markdown-editor-input-layer composing"
        } else {
            "markdown-editor-input-layer"
        };
        let highlight_translate_style = format!(
            "transform: translate(-{}px, -{}px);",
            editor_scroll_left(),
            editor_scroll_top()
        );

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
                            pre { class: "markdown-editor-highlight-viewport",
                                div {
                                    class: "markdown-editor-highlight-content",
                                    style: highlight_translate_style,
                                    dangerous_inner_html: "{highlighted_html}",
                                }
                            }
                            textarea {
                                id: MARKDOWN_EDITOR_INPUT_ID,
                                class: input_class,
                                spellcheck: false,
                                value: draft_source(),
                                oncompositionstart: move |_| composing_lock.set(true),
                                oncompositionend: move |_| {
                                    composing_lock.set(false);
                                },
                                oninput: move |evt| {
                                    if composing_lock() {
                                        return;
                                    }

                                    let next = evt.value();
                                    draft_source.set(next.clone());
                                    committed_source.set(next.clone());
                                    on_markdown_change.call(next);
                                },
                                onscroll: move |_| {
                                    read_textarea_scroll(editor_scroll_top, editor_scroll_left);
                                },
                            }
                        }
                    }
                    if markdown_preview_open {
                        div { class: "markdown-split-line" }
                        section { class: "markdown-preview-pane",
                            if committed_source().trim().is_empty() {
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

    let (ruler_major_count, page_style, seamless) = if let Some(size) = paper_size {
        let layout = page_layout_px(size);
        let marks = (size.width / 10.0).floor().clamp(10.0, 120.0) as usize;
        let style = format!(
            "--page-width: {:.2}px; --page-height: {:.2}px; --page-padding-x: {:.2}px; --page-padding-y: {:.2}px; --ruler-major-step: {:.2}px;",
            layout.page_width,
            layout.page_height,
            layout.padding_x,
            layout.padding_y,
            10.0 * MM_TO_PX
        );

        (marks, style, false)
    } else {
        let style = format!(
            "--page-width: min(1120px, 94vw); --page-height: auto; --page-padding-x: 88px; --page-padding-y: 72px; --ruler-major-step: {:.2}px;",
            10.0 * MM_TO_PX
        );
        (30usize, style, true)
    };

    let ruler_minor_count = ruler_major_count * 10;

    rsx! {
        main { class: "editor-surface",
            if show_ruler {
                div { class: "page-ruler-sticky",
                    div { class: "page-ruler", style: page_style.clone(),
                        div { class: "ruler-track",
                            for index in 0..=ruler_minor_count {
                                if index % 10 != 0 {
                                    span {
                                        class: if index % 5 == 0 { "ruler-tick mid" } else { "ruler-tick minor" },
                                        style: format!("left: {:.6}%;", index as f32 * 100.0 / ruler_minor_count as f32),
                                    }
                                }
                            }
                            for index in 0..=ruler_major_count {
                                span {
                                    class: "ruler-tick major",
                                    style: format!("left: {:.6}%;", index as f32 * 100.0 / ruler_major_count as f32),
                                }
                                span {
                                    class: if index == 0 { "ruler-mark origin" } else { "ruler-mark" },
                                    style: format!("left: {:.6}%;", index as f32 * 100.0 / ruler_major_count as f32),
                                    "{index}"
                                }
                            }
                            input {
                                class: "ruler-slider left",
                                r#type: "range",
                                min: 0,
                                max: 100,
                                step: 1,
                                value: "{left_slider}",
                                oninput: move |evt| {
                                    if let Ok(next) = evt.value().parse::<u16>() {
                                        let capped = next.min(right_slider().saturating_sub(1));
                                        left_slider.set(capped);
                                    }
                                },
                            }
                            input {
                                class: "ruler-slider right",
                                r#type: "range",
                                min: 0,
                                max: 100,
                                step: 1,
                                value: "{right_slider}",
                                oninput: move |evt| {
                                    if let Ok(next) = evt.value().parse::<u16>() {
                                        let capped = next.max(left_slider() + 1).min(100);
                                        right_slider.set(capped);
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
                    if committed_source().trim().is_empty() {
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
