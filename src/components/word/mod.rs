mod editor_surface;
mod ribbon_groups;
mod status_bar;
mod tabs_row;
mod title_bar;

use dioxus::prelude::*;

pub use editor_surface::EditorSurface;
pub use status_bar::StatusBar;
pub use tabs_row::TabsRow;
pub use title_bar::TitleBar;

#[cfg(feature = "desktop")]
fn drag_resize(direction: dioxus::desktop::tao::window::ResizeDirection) {
    _ = dioxus::desktop::window().drag_resize_window(direction);
}

#[cfg(not(feature = "desktop"))]
fn drag_resize(_direction: ()) {}

#[cfg(feature = "desktop")]
#[component]
fn ResizeHandles() -> Element {
    rsx! {
        div {
            class: "resize-handle resize-n",
            onpointerdown: move |_| drag_resize(dioxus::desktop::tao::window::ResizeDirection::North),
        }
        div {
            class: "resize-handle resize-s",
            onpointerdown: move |_| drag_resize(dioxus::desktop::tao::window::ResizeDirection::South),
        }
        div {
            class: "resize-handle resize-w",
            onpointerdown: move |_| drag_resize(dioxus::desktop::tao::window::ResizeDirection::West),
        }
        div {
            class: "resize-handle resize-e",
            onpointerdown: move |_| drag_resize(dioxus::desktop::tao::window::ResizeDirection::East),
        }
        div {
            class: "resize-handle resize-nw",
            onpointerdown: move |_| drag_resize(dioxus::desktop::tao::window::ResizeDirection::NorthWest),
        }
        div {
            class: "resize-handle resize-ne",
            onpointerdown: move |_| drag_resize(dioxus::desktop::tao::window::ResizeDirection::NorthEast),
        }
        div {
            class: "resize-handle resize-sw",
            onpointerdown: move |_| drag_resize(dioxus::desktop::tao::window::ResizeDirection::SouthWest),
        }
        div {
            class: "resize-handle resize-se",
            onpointerdown: move |_| drag_resize(dioxus::desktop::tao::window::ResizeDirection::SouthEast),
        }
    }
}

#[cfg(not(feature = "desktop"))]
#[component]
fn ResizeHandles() -> Element {
    rsx! {}
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RibbonTab {
    File,
    Home,
    Insert,
    Draw,
    Layout,
    References,
    Review,
    View,
}

impl RibbonTab {
    pub fn all() -> [RibbonTab; 8] {
        [
            RibbonTab::File,
            RibbonTab::Home,
            RibbonTab::Insert,
            RibbonTab::Draw,
            RibbonTab::Layout,
            RibbonTab::References,
            RibbonTab::Review,
            RibbonTab::View,
        ]
    }

    pub fn label(self) -> &'static str {
        match self {
            RibbonTab::File => "文件",
            RibbonTab::Home => "开始",
            RibbonTab::Insert => "插入",
            RibbonTab::Draw => "绘图",
            RibbonTab::Layout => "布局",
            RibbonTab::References => "引用",
            RibbonTab::Review => "审阅",
            RibbonTab::View => "视图",
        }
    }
}

#[component]
pub fn WordWorkspace() -> Element {
    let mut active_tab = use_signal(|| RibbonTab::Home);
    let zoom = use_signal(|| 100u16);

    rsx! {
        div { class: "word-shell",
            ResizeHandles {}
            TitleBar {}
            TabsRow {
                active_tab: active_tab(),
                on_switch: move |tab| active_tab.set(tab),
            }
            ribbon_groups::RibbonPanel { active_tab: active_tab() }
            EditorSurface {}
            StatusBar { zoom: zoom() }
        }
    }
}
