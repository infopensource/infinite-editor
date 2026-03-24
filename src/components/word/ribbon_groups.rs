use dioxus::prelude::*;

use super::RibbonTab;

#[component]
pub fn RibbonPanel(active_tab: RibbonTab) -> Element {
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
                    Group {
                        title: "显示",
                        large_action: "标尺",
                        actions: vec!["网格线", "导航窗格"],
                    }
                    Group {
                        title: "缩放",
                        large_action: "100%",
                        actions: vec!["单页", "多页", "页宽"],
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
