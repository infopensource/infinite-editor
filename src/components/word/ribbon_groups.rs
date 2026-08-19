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
    on_editor_command: EventHandler<String>,
) -> Element {
    let mut width_draft = use_signal(|| custom_width_mm.to_string());
    let mut height_draft = use_signal(|| custom_height_mm.to_string());

    rsx! {
        section { class: "ribbon-panel",
            match active_tab {
                RibbonTab::File => rsx! {},
                RibbonTab::Home => rsx! {
                    CommandGroup {
                        title: "历史",
                        actions: vec![("撤销", "undo"), ("重做", "redo")],
                        on_action: on_editor_command,
                    }
                    CommandGroup {
                        title: "字体",
                        actions: vec![
                            ("加粗", "bold"),
                            ("斜体", "italic"),
                            ("删除线", "strike"),
                            ("代码块", "code_block"),
                        ],
                        on_action: on_editor_command,
                    }
                    CommandGroup {
                        title: "段落",
                        actions: vec![
                            ("项目符号", "unordered_list"),
                            ("编号", "ordered_list"),
                            ("引用", "quote"),
                            ("分隔线", "horizontal_rule"),
                        ],
                        on_action: on_editor_command,
                    }
                    CommandGroup {
                        title: "样式",
                        actions: vec![
                            ("标题 1", "heading1"),
                            ("标题 2", "heading2"),
                            ("标题 3", "heading3"),
                            ("正文", "paragraph"),
                        ],
                        on_action: on_editor_command,
                    }
                },
                RibbonTab::Insert => rsx! {
                    CommandGroup {
                        title: "页面",
                        actions: vec![("分页符", "page_break"), ("分隔线", "horizontal_rule")],
                        on_action: on_editor_command,
                    }
                    Group {
                        title: "插图",
                        large_action: "图片",
                        actions: vec!["形状", "图标", "图表"],
                    }
                    Group {
                        title: "文本",
                        large_action: "文本框",
                        actions: vec!["艺术字", "首字下沉"],
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
                    Group {
                        title: "缩放",
                        large_action: "100%",
                        actions: vec!["单页", "多页", "页宽"],
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
fn CommandGroup(
    title: String,
    actions: Vec<(&'static str, &'static str)>,
    on_action: EventHandler<String>,
) -> Element {
    rsx! {
        div { class: "ribbon-group",
            div { class: "group-main",
                div { class: "group-actions command-actions",
                    for (label, command) in actions {
                        button {
                            class: "ribbon-small",
                            onmousedown: move |event| {
                                event.prevent_default();
                                on_action.call(command.to_string());
                            },
                            onkeydown: move |event| {
                                let activates = match event.key() {
                                    Key::Enter => true,
                                    Key::Character(value) => value == " ",
                                    _ => false,
                                };
                                if activates {
                                    event.prevent_default();
                                    on_action.call(command.to_string());
                                }
                            },
                            "{label}"
                        }
                    }
                }
            }
            div { class: "group-title", "{title}" }
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
