use dioxus::prelude::*;

#[component]
pub fn StatusBar(zoom: u16) -> Element {
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
                button { class: "status-view active", "阅读" }
                button { class: "status-view", "打印" }
                button { class: "status-view", "Web" }
                span { class: "zoom-text", "{zoom}%" }
            }
        }
    }
}
