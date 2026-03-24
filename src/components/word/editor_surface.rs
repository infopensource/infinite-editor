use dioxus::prelude::*;

#[component]
pub fn EditorSurface() -> Element {
    rsx! {
        main { class: "editor-surface",
            div { class: "page-ruler",
                for index in 0..23 {
                    span { class: "ruler-mark", "{index}" }
                }
            }

            article { class: "document-page",
                h1 { "项目计划书" }
                p {
                    "这是一个基于 Dioxus 0.7 构建的 Word Ribbon 风格编辑器界面示例。"
                }
                p {
                    "界面重点还原了：标题栏、选项卡、功能区、文档纸张以及底部状态栏。"
                }
                p {
                    "该版本专注于 UI 结构与可维护性，便于后续接入真实富文本引擎。"
                }
                for section in 1..=24 {
                    h2 { "章节 {section}" }
                    p {
                        "这里是示例段落，用于验证文档区独立滚动行为。滚动时顶部 Ribbon 与底部状态栏保持固定，只有文档内容上下移动。"
                    }
                    p {
                        "后续你可以把这部分替换成真实文档模型渲染结果，例如按段落、标题、列表和图片块进行分块渲染。"
                    }
                }
            }
        }
    }
}
