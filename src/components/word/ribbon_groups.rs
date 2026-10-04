use dioxus::prelude::*;

use super::{PaperMode, RibbonTab};
use crate::config::{parse_custom_paper_mm, MAX_CUSTOM_PAPER_MM, MIN_CUSTOM_PAPER_MM};

#[component]
pub fn RibbonPanel(
    active_tab: RibbonTab,
    paper_mode: PaperMode,
    custom_width_mm: u16,
    custom_height_mm: u16,
    show_ruler: bool,
    on_paper_mode_change: EventHandler<PaperMode>,
    on_custom_width_change: EventHandler<u16>,
    on_custom_height_change: EventHandler<u16>,
    on_toggle_ruler: EventHandler<()>,
    on_reset_zoom: EventHandler<()>,
    on_editor_command: EventHandler<String>,
    on_clipboard_action: EventHandler<String>,
) -> Element {
    let mut width_draft = use_signal(|| custom_width_mm.to_string());
    let mut height_draft = use_signal(|| custom_height_mm.to_string());
    use_effect(|| { let _ = document::eval(include_str!("../../../web/toolbar_clipboard.js")); });

    rsx! {
        section { class: "ribbon-panel",
            match active_tab {
                RibbonTab::File => rsx! {},
                RibbonTab::Home => rsx! {
                    ClipboardGroup { on_action: on_clipboard_action }
                    CommandGroup {
                        title: "字符格式",
                        actions: vec![
                            ("加粗", "bold"),
                            ("斜体", "italic"),
                            ("删除线", "strike"),
                            ("行内代码", "inline_code"),
                        ],
                        on_action: on_editor_command,
                    }
                    CommandGroup {
                        title: "段落",
                        actions: vec![
                            ("左对齐", "align_left"),
                            ("居中", "align_center"),
                            ("右对齐", "align_right"),
                            ("两端对齐", "align_justify"),
                            ("项目符号", "unordered_list"),
                            ("编号", "ordered_list"),
                            ("任务列表", "task_list"),
                            ("引用", "quote"),
                        ],
                        on_action: on_editor_command,
                    }
                    CommandGroup {
                        title: "样式",
                        actions: vec![
                            ("标题 1", "heading1"),
                            ("标题 2", "heading2"),
                            ("标题 3", "heading3"),
                            ("标题 4", "heading4"),
                            ("标题 5", "heading5"),
                            ("标题 6", "heading6"),
                            ("正文", "paragraph"),
                        ],
                        on_action: on_editor_command,
                    }
                },
                RibbonTab::Insert => rsx! {
                    CommandGroup {
                        title: "链接与媒体",
                        actions: vec![("链接", "link"), ("图片", "image")],
                        on_action: on_editor_command,
                    }
                    CommandGroup {
                        title: "Markdown 结构",
                        actions: vec![("表格", "table"), ("代码块", "code_block"), ("分隔线", "horizontal_rule"), ("硬换行", "hard_break")],
                        on_action: on_editor_command,
                    }
                    CommandGroup {
                        title: "页面",
                        actions: vec![("分页符", "page_break"), ("页眉页脚", "page_furniture")],
                        on_action: on_editor_command,
                    }
                },
                RibbonTab::View => rsx! {
                    Group {
                        title: "视图",
                        large_action: "阅读",
                        actions: vec!["页面视图", "大纲", "草稿"],
                    }
                    div { class: "ribbon-group",
                        div { class: "group-main",
                            button {
                                class: if show_ruler { "ribbon-large active" } else { "ribbon-large" },
                                onclick: move |_| on_toggle_ruler.call(()),
                                if show_ruler { "隐藏标尺" } else { "显示标尺" }
                            }
                            div { class: "group-actions",
                                button { class: "ribbon-small", "网格线" }
                                button { class: "ribbon-small", "导航窗格" }
                            }
                        }
                        div { class: "group-title", "显示" }
                    }
                    div { class: "ribbon-group",
                        button {
                            class: "ribbon-large", r#type: "button",
                            onclick: move |_| on_reset_zoom.call(()),
                            "100%"
                        }
                        div { class: "group-title", "缩放" }
                    }
                },
                RibbonTab::Layout => rsx! {
                    div { class: "ribbon-group paper-layout-group",
                        div { class: "group-main paper-layout-main",
                            div { class: "paper-mode-actions",
                                for mode in [PaperMode::A4, PaperMode::A5, PaperMode::Custom, PaperMode::Seamless] {
                                    button {
                                        class: if paper_mode == mode { "ribbon-small active" } else { "ribbon-small" },
                                        onclick: move |_| on_paper_mode_change.call(mode),
                                        "{mode.label()}"
                                    }
                                }
                            }
                            div { class: "paper-custom-size",
                                label { class: "paper-size-label", "宽(mm)" }
                                input {
                                    class: "paper-size-input",
                                    r#type: "number",
                                    min: MIN_CUSTOM_PAPER_MM,
                                    max: MAX_CUSTOM_PAPER_MM,
                                    value: width_draft,
                                    disabled: paper_mode != PaperMode::Custom,
                                    oninput: move |evt| width_draft.set(evt.value()),
                                    onchange: move |evt| {
                                        let width = parse_custom_paper_mm(&evt.value());
                                        width_draft.set(width.to_string());
                                        on_custom_width_change.call(width);
                                    },
                                }
                                label { class: "paper-size-label", "高(mm)" }
                                input {
                                    class: "paper-size-input",
                                    r#type: "number",
                                    min: MIN_CUSTOM_PAPER_MM,
                                    max: MAX_CUSTOM_PAPER_MM,
                                    value: height_draft,
                                    disabled: paper_mode != PaperMode::Custom,
                                    oninput: move |evt| height_draft.set(evt.value()),
                                    onchange: move |evt| {
                                        let height = parse_custom_paper_mm(&evt.value());
                                        height_draft.set(height.to_string());
                                        on_custom_height_change.call(height);
                                    },
                                }
                            }
                        }
                        div { class: "group-title", "纸张与分页" }
                    }
                },
                _ => rsx! {
                    Group {
                        title: "功能区",
                        large_action: active_tab.label().to_string(),
                        actions: vec!["常用操作", "布局选项", "更多设置"],
                    }
                },
            }
        }
    }
}

#[component]
fn ClipboardGroup(on_action: EventHandler<String>) -> Element {
    rsx! {
        div { class: "ribbon-group clipboard-group", role: "group", aria_label: "剪贴板",
            div { class: "clipboard-main",
                button {
                    class: "clipboard-paste", r#type: "button", title: "粘贴剪贴板内容",
                    onmousedown: move |event| event.prevent_default(),
                    onauxclick: move |event| event.prevent_default(),
                    "data-clipboard-action": "paste",
                    onclick: move |_| on_action.call("paste".into()),
                    svg { view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "1.7", stroke_linecap: "round", stroke_linejoin: "round", "aria-hidden": "true",
                        path { d: "M8 4h2a2 2 0 0 1 4 0h2v3H8V4Z" }
                        path { d: "M7 6H5v15h14V6h-2M8 12h8M8 16h6" }
                    }
                    span { "粘贴" }
                }
                div { class: "clipboard-secondary",
                    button { class: "clipboard-small", r#type: "button", title: "剪切选中文本",
                        onmousedown: move |event| event.prevent_default(),
                        onauxclick: move |event| event.prevent_default(),
                        "data-clipboard-action": "cut",
                        span { class: "clipboard-symbol", aria_hidden: "true", "✂" }
                        "剪切"
                    }
                    button { class: "clipboard-small", r#type: "button", title: "复制选中文本",
                        onmousedown: move |event| event.prevent_default(),
                        onauxclick: move |event| event.prevent_default(),
                        "data-clipboard-action": "copy",
                        span { class: "clipboard-symbol", aria_hidden: "true", "▢" }
                        "复制"
                    }
                }
            }
            div { class: "group-title", "剪贴板" }
        }
    }
}

#[component]
fn CommandGroup(
    title: String,
    actions: Vec<(&'static str, &'static str)>,
    on_action: EventHandler<String>,
) -> Element {
    rsx! {
        div { class: "ribbon-group",
            div { class: "group-main",
                div { class: if title == "段落" || title == "样式" { "group-actions command-actions paragraph-actions" } else { "group-actions command-actions" },
                    for (label, command) in actions {
                        button {
                            class: "ribbon-small",
                            "data-paragraph-alignment": command.strip_prefix("align_"),
                            r#type: "button",
                            onmousedown: move |event| {
                                // Keep the document selection without executing a command
                                // (and refocusing the editor) during a mouse press.
                                event.prevent_default();
                            },
                            onmouseup: move |event| {
                                if event.trigger_button() == Some(dioxus::html::input_data::MouseButton::Auxiliary) {
                                    event.prevent_default();
                                }
                            },
                            // Suppress auxiliary-click defaults on the command button,
                            // including native selection paste. Normal editor paste is unchanged.
                            onauxclick: move |event| event.prevent_default(),
                            onclick: move |event| {
                                // Native keyboard activation also generates a primary click.
                                if event.trigger_button() == Some(dioxus::html::input_data::MouseButton::Primary) {
                                    on_action.call(command.to_string());
                                }
                            },
                            span { class: "ribbon-command-icon", aria_hidden: "true",
                                {command_icon(command)}
                            }
                            "{label}"
                        }
                    }
                }
            }
            div { class: "group-title", "{title}" }
        }
    }
}

fn command_icon(command: &str) -> Element {
    match command {
        "align_left" | "align_center" | "align_right" | "align_justify" => {
            let lines = match command {
                "align_left" => "M3 5h18M3 9h12M3 13h18M3 17h12",
                "align_center" => "M3 5h18M6 9h12M3 13h18M6 17h12",
                "align_right" => "M3 5h18M9 9h12M3 13h18M9 17h12",
                _ => "M3 5h18M3 9h18M3 13h18M3 17h18",
            };
            rsx! { svg { view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "1.8", path { d: lines } } }
        }
        "unordered_list" => rsx! { svg { view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "1.8",
            path { d: "M8 5h13M8 12h13M8 19h13" }
            circle { cx: "3", cy: "5", r: "1" } circle { cx: "3", cy: "12", r: "1" } circle { cx: "3", cy: "19", r: "1" }
        } },
        "ordered_list" => rsx! { svg { view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "1.8",
            path { d: "M9 5h12M9 12h12M9 19h12M3 5h2v3M3 12h2l-2 3h2M3 19h2l-2 3h2" }
        } },
        "link" => rsx! { svg { view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "1.8", stroke_linecap: "round",
            path { d: "M10 13a5 5 0 0 0 7 .4l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.4l-3 3a5 5 0 0 0 7 7l1.7-1.7" }
        } },
        "image" => rsx! { svg { view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "1.8", stroke_linecap: "round",
            rect { x: "3", y: "4", width: "18", height: "16", rx: "2" }
            circle { cx: "8", cy: "9", r: "1.5" }
            path { d: "m4 18 6-6 4 4 2-2 4 4" }
        } },
        "table" => rsx! { svg { view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "1.8",
            rect { x: "3", y: "4", width: "18", height: "16", rx: "1" }
            path { d: "M3 9h18M9 9v11M15 9v11" }
        } },
        _ => {
            let glyph = match command {
                "bold" => "B", "italic" => "I", "strike" => "S̶", "inline_code" => "</>",
                "task_list" => "☑", "quote" => "❞", "code_block" => "{ }",
                "horizontal_rule" => "―", "hard_break" => "↵",
                "heading1" => "H₁", "heading2" => "H₂", "heading3" => "H₃",
                "heading4" => "H₄", "heading5" => "H₅", "heading6" => "H₆", "paragraph" => "¶",
                "page_break" => "▤", "page_furniture" => "▣", _ => "·",
            };
            rsx! { "{glyph}" }
        }
    }
}

#[component]
fn Group(title: String, large_action: String, actions: Vec<&'static str>) -> Element {
    rsx! {
        div { class: "ribbon-group",
            div { class: "group-main",
                button { class: "ribbon-large", "{large_action}" }
                div { class: "group-actions",
                    for action in actions {
                        button { class: "ribbon-small", "{action}" }
                    }
                }
            }
            div { class: "group-title", "{title}" }
        }
    }
}
