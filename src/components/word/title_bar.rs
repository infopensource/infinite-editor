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

fn finish_search_edit(
    commit: bool,
    mut editing: Signal<bool>,
    mut draft: Signal<String>,
    mut value: Signal<String>,
) {
    // Guard against late blur events after key handlers already ended editing.
    if !editing() {
        return;
    }

    if commit {
        value.set(draft());
    } else {
        draft.set(String::new());
        value.set(String::new());
    }

    editing.set(false);
}

#[component]
fn SearchBox(placeholder: String) -> Element {
    let mut editing = use_signal(|| false);
    let value = use_signal(String::new);
    let mut draft = use_signal(String::new);

    rsx! {
        if editing() {
            input {
                class: "search-box search-box-editing",
                r#type: "text",
                value: draft(),
                placeholder,
                autofocus: true,
                onmounted: move |element| async move {
                    let _ = element.data().set_focus(true).await;
                },
                oninput: move |evt| draft.set(evt.value()),
                onpointerdown: move |evt| evt.stop_propagation(),
                onkeydown: move |evt| {
                    if evt.key() == Key::Enter {
                        finish_search_edit(true, editing, draft, value);
                    }

                    if evt.key() == Key::Escape {
                        finish_search_edit(false, editing, draft, value);
                    }
                },
                onblur: move |_| {
                    finish_search_edit(true, editing, draft, value);
                },
            }
        } else {
            button {
                class: if value().is_empty() { "search-box search-box-trigger is-placeholder" } else { "search-box search-box-trigger" },
                onpointerdown: move |evt| {
                    evt.stop_propagation();
                    draft.set(value());
                    editing.set(true);
                },
                if value().is_empty() {
                    "{placeholder}"
                } else {
                    "{value}"
                }
            }
        }
    }
}

#[component]
pub fn TitleBar(document_title: String) -> Element {
    let mut maximized = use_signal(is_maximized);
    let mut title_bar_pressing = use_signal(|| false);

    use_effect({
        let document_title = document_title.clone();
        move || {
            sync_window_title(&format!("{} - Infinite Editor", document_title));
        }
    });

    rsx! {
        header {
            class: "title-bar",
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
                button { class: "icon-btn", "⟲" }
                button { class: "icon-btn", "⟲" }
                button { class: "icon-btn", "💾" }
                span { class: "divider" }
                span { class: "doc-title doc-title-static", "{document_title}" }

            }

            div { class: "title-center",
                // input {
                //     class: "search-box",
                //     r#type: "text",
                //     placeholder: "搜索 (Alt + Q)",
                //     readonly: true,
                //     onpointerdown: move |evt| evt.stop_propagation(),
                // }
                SearchBox { placeholder: "搜索 (Ctrl + F)".to_string() }
            }

            div { class: "title-right",
                button {
                    class: "window-btn",
                    onpointerdown: move |evt| evt.stop_propagation(),
                    onclick: move |_| minimize_window(),
                    "—"
                }
                button {
                    class: "window-btn",
                    onpointerdown: move |evt| evt.stop_propagation(),
                    onclick: move |_| {
                        maximized.set(!is_maximized());
                        maximize_window();
                    },
                    if maximized() {
                        "🗗"
                    } else {
                        "🗖"
                    }
                }
                button {
                    class: "window-btn close",
                    onpointerdown: move |evt| evt.stop_propagation(),
                    onclick: move |_| close_window(),
                    "✕"
                }
            }
        }
    }
}
