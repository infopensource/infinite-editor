//! Browser regression fixture for the production loading dialog.
#[path = "../src/components/ui/loading_dialog.rs"]
mod loading_dialog;
use dioxus::prelude::*;
use loading_dialog::LoadingDialog;

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    let mut active = use_signal(|| false);
    rsx! {
        document::Stylesheet { href: asset!("/assets/styling/wysiwyg_core.css") }
        div { style: "height: 2400px; padding: 20px; background: #eef2f7;",
            button { id: "begin", onclick: move |_| active.set(true), "开始加载" }
            button { id: "finish", onclick: move |_| active.set(false), "完成任务" }
            span { id: "task-state", if active() { "working" } else { "idle" } }
            LoadingDialog {
                active,
                title: "正在准备文档",
                description: "浏览器回归测试",
            }
        }
    }
}
