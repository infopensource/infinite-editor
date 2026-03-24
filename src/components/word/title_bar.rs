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

#[derive(Clone, Copy)]
enum EndEditMode {
    Commit,
    Cancel,
}

fn finish_doc_title_edit(
    mode: EndEditMode,
    mut editing: Signal<bool>,
    mut draft: Signal<String>,
    mut title: Signal<String>,
    on_title_change: EventHandler<String>,
) {
    // Guard against late blur events after key handlers already ended editing.
    if !editing() {
        return;
    }

    match mode {
        EndEditMode::Commit => {
            let next_title = draft();
            title.set(next_title.clone());
            on_title_change.call(next_title);
        }
        EndEditMode::Cancel => {
            // Cancel keeps the previous committed title.
            draft.set(title());
        }
    }

    editing.set(false);
}

fn finish_search_edit(
    mode: EndEditMode,
    mut editing: Signal<bool>,
    mut draft: Signal<String>,
    mut value: Signal<String>,
) {
    // Guard against late blur events after key handlers already ended editing.
    if !editing() {
        return;
    }

    match mode {
        EndEditMode::Commit => {
            value.set(draft());
        }
        EndEditMode::Cancel => {
            // Escape clears the current search and exits editing.
            draft.set(String::new());
            value.set(String::new());
        }
    }

    editing.set(false);
}

#[component]
fn EditableDocTitle(initial_value: String, on_title_change: EventHandler<String>) -> Element {
    let initial = initial_value.clone();
    let title = use_signal(move || initial.clone());
    let mut draft = use_signal(String::new);
    let mut editing = use_signal(|| false);

    rsx! {
        if editing() {
            input {
                class: "doc-title doc-title-input",
                value: draft(),
                autofocus: true,
                onmounted: move |element| async move {
                    let _ = element.data().set_focus(true).await;
                },
                onpointerdown: move |evt| evt.stop_propagation(),
                oninput: move |evt| draft.set(evt.value()),
                onkeydown: move |evt| {
                    if evt.key() == Key::Enter {
                        finish_doc_title_edit(
                            EndEditMode::Commit,
                            editing,
                            draft,
                            title,
                            on_title_change,
                        );
                    }

                    if evt.key() == Key::Escape {
                        finish_doc_title_edit(
                            EndEditMode::Cancel,
                            editing,
                            draft,
                            title,
                            on_title_change,
                        );
                    }
                },
                onblur: move |_| {
                    finish_doc_title_edit(
                        EndEditMode::Commit,
                        editing,
                        draft,
                        title,
                        on_title_change,
                    );
                },
            }
        } else {
            button {
                class: "doc-title doc-title-trigger",
                onpointerdown: move |evt| {
                    evt.stop_propagation();
                    draft.set(title());
                    editing.set(true);
                },
                "{title}"
            }
        }
    }
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
                        finish_search_edit(EndEditMode::Commit, editing, draft, value);
                    }

                    if evt.key() == Key::Escape {
                        finish_search_edit(EndEditMode::Cancel, editing, draft, value);
                    }
                },
                onblur: move |_| {
                    finish_search_edit(EndEditMode::Commit, editing, draft, value);
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
pub fn TitleBar() -> Element {
    let mut maximized = use_signal(is_maximized);
    let initial_title = "Document_1 - Infinite Editor".to_string();
    let mut title_bar_pressing = use_signal(|| false);

    use_effect({
        let initial_title = initial_title.clone();
        move || {
            sync_window_title(&initial_title);
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
                EditableDocTitle {
                    initial_value: initial_title,
                    on_title_change: move |value: String| sync_window_title(&value), // String -> &str
                }
            
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
