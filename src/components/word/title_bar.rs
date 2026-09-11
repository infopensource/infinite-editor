use dioxus::prelude::*;

#[cfg(feature = "desktop")]
fn start_drag() {
    dioxus::desktop::window().drag();
}

#[cfg(not(feature = "desktop"))]
fn start_drag() {
    // No-op for non-desktop platforms
}

#[cfg(feature = "desktop")]
fn minimize_window() {
    dioxus::desktop::window().set_minimized(true);
}

#[cfg(not(feature = "desktop"))]
fn minimize_window() {
    // No-op for non-desktop platforms
}

#[cfg(feature = "desktop")]
fn maximize_window() {
    dioxus::desktop::window().toggle_maximized();
}

#[cfg(not(feature = "desktop"))]
fn maximize_window() {
    // No-op for non-desktop platforms
}

#[cfg(feature = "desktop")]
fn close_window() {
    dioxus::desktop::window().close();
}

#[cfg(not(feature = "desktop"))]
fn close_window() {
    // No-op for non-desktop platforms
}

#[cfg(feature = "desktop")]
fn is_maximized() -> bool {
    dioxus::desktop::window().is_maximized()
}

#[cfg(not(feature = "desktop"))]
fn is_maximized() -> bool {
    false
}

#[cfg(feature = "desktop")]
fn sync_window_title(title: &str) {
    dioxus::desktop::window().set_title(title);
}

#[cfg(not(feature = "desktop"))]
fn sync_window_title(_title: &str) {}

#[component]
fn TitleIcon(name: &'static str) -> Element {
    let path = match name {
        "undo" => "M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12",
        "redo" => "m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12",
        "save" => "M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8",
        "search" => "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
        "up" => "m6 14 6-6 6 6",
        "down" => "m6 10 6 6 6-6",
        "minimize" => "M5 12h14",
        "maximize" => "M5 5h14v14H5Z",
        "restore" => "M8 4h12v12M4 8h12v12H4Z",
        "edit" => "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z",
        _ => "m6 6 12 12M6 18 18 6",
    };
    rsx! { svg { width: "16", height: "16", view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "1.6", stroke_linecap: "round", stroke_linejoin: "round", "aria-hidden": "true", path { d: path } } }
}

#[component]
pub fn TitleBar(document_title: String, dirty: bool, save_status: String, on_rename: EventHandler<String>, on_save: EventHandler<()>, on_command: EventHandler<String>) -> Element {
    let mut editing = use_signal(|| false);
    let mut draft = use_signal(String::new);
    use_effect(|| { let _ = document::eval(include_str!("../../../web/title_bar.js")); });
    let mut maximized = use_signal(is_maximized);
    let mut title_bar_pressing = use_signal(|| false);

    use_effect(use_reactive!(|(document_title)| {
        sync_window_title(&format!("{} - Infinite Editor", document_title));
    }));

    rsx! {
        header {
            class: "title-bar",
            "data-save-status": save_status,
            "data-dirty": dirty,
            ondoubleclick: move |_| {
                maximize_window();
                maximized.set(!maximized());
                title_bar_pressing.set(false);
            },
            onpointerdown: move |_| {
                title_bar_pressing.set(true);
            },
            onpointermove: move |_| {
                if title_bar_pressing() {
                    start_drag();
                    title_bar_pressing.set(false);
                }
            },
            onpointerup: move |_| title_bar_pressing.set(false),
            onpointerleave: move |_| title_bar_pressing.set(false),

            div { class: "title-left",
                onpointerdown: move |evt| evt.stop_propagation(),
                ondoubleclick: move |evt| evt.stop_propagation(),
                button { id: "title-undo", class: "icon-btn", title: "撤销 (Ctrl+Z)", aria_label: "撤销", onmousedown: move |e| e.prevent_default(), onclick: move |_| on_command.call("undo".into()), TitleIcon { name: "undo" } }
                button { id: "title-redo", class: "icon-btn", title: "重做 (Ctrl+Y)", aria_label: "重做", onmousedown: move |e| e.prevent_default(), onclick: move |_| on_command.call("redo".into()), TitleIcon { name: "redo" } }
                button { id: "title-save", class: "icon-btn", title: "保存 (Ctrl+S)", aria_label: "保存", onclick: move |_| on_save.call(()), TitleIcon { name: "save" } }
                span { class: "divider" }
                if editing() {
                    input {
                        class: "doc-title-input", aria_label: "文档标题", value: draft(),
                        onmounted: move |e| async move { let _ = e.data().set_focus(true).await; },
                        oninput: move |e| draft.set(e.value()),
                        onkeydown: move |e| {
                            if e.key() == Key::Escape { editing.set(false); }
                            if e.key() == Key::Enter {
                                if !draft().trim().is_empty() { on_rename.call(draft().trim().to_string()); }
                                editing.set(false);
                            }
                        },
                        onblur: move |_| {
                            if editing() && !draft().trim().is_empty() { on_rename.call(draft().trim().to_string()); }
                            editing.set(false);
                        },
                    }
                } else {
                    button { class: "doc-title-trigger", title: "编辑文档标题（文件名在文件面板管理）", onclick: move |_| { draft.set(document_title.clone()); editing.set(true); }, span { class: "title-text", "{document_title}" } span { class: "title-edit-hint", TitleIcon { name: "edit" } } }
                }
                span { class: if dirty { "title-dirty is-dirty" } else { "title-dirty" }, title: if dirty { "有未保存的更改" } else { "无未保存更改" }, aria_label: if dirty { "未保存" } else { "已保存" } }
                span { id: "title-save-feedback", aria_live: "polite" }
            }
            div { class: "title-center",
                onpointerdown: move |e| e.stop_propagation(),
                ondoubleclick: move |e| e.stop_propagation(),
                div { class: "title-search-field title-search-inline",
                    TitleIcon { name: "search" }
                    input { id: "title-search", r#type: "search", placeholder: "搜索 (Ctrl + F)", aria_label: "全文搜索", aria_expanded: "false", aria_controls: "title-search-panel" }
                }
                div { id: "title-search-panel", class: "title-search-panel", hidden: true,
                    div { class: "title-search-actions",
                        button { id: "title-replace-toggle", class: "replace-button", aria_expanded: "false", aria_controls: "title-replace-section", "替换" }
                        span { id: "title-search-count", aria_live: "polite", "输入关键词查找" }
                        button { id: "title-search-prev", class: "icon-btn", title: "上一个 (Shift+Enter)", aria_label: "上一个搜索结果", TitleIcon { name: "up" } }
                        button { id: "title-search-next", class: "icon-btn", title: "下一个 (Enter)", aria_label: "下一个搜索结果", TitleIcon { name: "down" } }
                        button { id: "title-search-close", class: "icon-btn", title: "关闭搜索 (Esc)", aria_label: "关闭搜索", TitleIcon { name: "close" } }
                    }
                    div { id: "title-replace-section", hidden: true,
                        div { class: "title-replace-row",
                            input { id: "title-replace", r#type: "text", placeholder: "替换为…", aria_label: "替换为", title: "留空可删除匹配文字" }
                            button { id: "title-replace-one", class: "replace-button", "替换" }
                            button { id: "title-replace-all", class: "replace-button", "全部替换" }
                        }
                        span { id: "title-replace-feedback", aria_live: "polite" }
                    }

                }
            }

            div { class: "title-right",
                hidden: !cfg!(feature = "desktop"),
                ondoubleclick: move |e| e.stop_propagation(),
                button {
                    class: "window-btn",
                    aria_label: "最小化窗口",
                    onpointerdown: move |evt| evt.stop_propagation(),
                    onclick: move |_| minimize_window(),
                    TitleIcon { name: "minimize" }
                }
                button {
                    class: "window-btn",
                    aria_label: "最大化或还原窗口",
                    onpointerdown: move |evt| evt.stop_propagation(),
                    onclick: move |_| {
                        maximized.set(!is_maximized());
                        maximize_window();
                    },
                    if maximized() {
                        TitleIcon { name: "restore" }
                    } else {
                        TitleIcon { name: "maximize" }
                    }
                }
                button {
                    class: "window-btn close",
                    aria_label: "关闭窗口",
                    onpointerdown: move |evt| evt.stop_propagation(),
                    onclick: move |_| close_window(),
                    TitleIcon { name: "close" }
                }
            }
        }
    }
}
