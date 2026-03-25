use dioxus::prelude::*;

use super::{PaperMode, RibbonTab};

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
) -> Element {
    rsx! {
        section { class: "ribbon-panel",
            match active_tab {
                RibbonTab::Home => rsx! {
                    Group {
                        title: "剪贴板",
                        large_action: "粘贴",
                        actions: vec!["剪切", "复制", "格式刷"],
                    }
                    Group {
                        title: "字体",
                        large_action: "Aa",
                        actions: vec!["加粗", "斜体", "下划线", "字体颜色"],
                    }
                    Group {
                        title: "段落",
                        large_action: "¶",
                        actions: vec!["项目符号", "对齐", "缩进", "行距"],
                    }
                    Group {
                        title: "样式",
                        large_action: "样式",
                        actions: vec!["标题 1", "标题 2", "正文"],
                    }
                },
                RibbonTab::Insert => rsx! {
                    Group {
                        title: "页面",
                        large_action: "封面",
                        actions: vec!["空白页", "分页符"],
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
                                    min: 80,
                                    max: 2000,
                                    value: "{custom_width_mm}",
                                    disabled: paper_mode != PaperMode::Custom,
                                    oninput: move |evt| {
                                        if let Ok(width) = evt.value().parse::<u16>() {
                                            on_custom_width_change.call(width);
                                        }
                                    },
                                }
                                label { class: "paper-size-label", "高(mm)" }
                                input {
                                    class: "paper-size-input",
                                    r#type: "number",
                                    min: 80,
                                    max: 2000,
                                    value: "{custom_height_mm}",
                                    disabled: paper_mode != PaperMode::Custom,
                                    oninput: move |evt| {
                                        if let Ok(height) = evt.value().parse::<u16>() {
                                            on_custom_height_change.call(height);
                                        }
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
