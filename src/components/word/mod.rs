mod document_layout;
mod editor_surface;
mod ribbon_groups;
mod status_bar;
mod tabs_row;
mod title_bar;

use dioxus::prelude::*;
use crate::engine::EditorMode;

pub use document_layout::PaperMode;
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
    let mut editor_mode = use_signal(|| EditorMode::Wysiwyg);
    let mut markdown_preview_open = use_signal(|| true);
    let mut markdown_source = use_signal(|| {
        "# 项目计划书\n\n这是一个基于 **Markdown 扩展** 的富文本引擎原型。\n\n## 本阶段目标\n\n- 解析接口与后端隔离\n- Markdown 源码与 WYSIWYG 模式切换\n- Markdown 源码高亮（syntect）\n\n> 后续将在此基础上继续扩展自定义语法。\n"
            .to_string()
    });
    let source = markdown_source();
    let mut paper_mode = use_signal(|| PaperMode::A4);
    let mut custom_width_mm = use_signal(|| 210u16);
    let mut custom_height_mm = use_signal(|| 297u16);
    let mut show_ruler = use_signal(|| true);

    rsx! {
        div { class: "word-shell",
            ResizeHandles {}
            TitleBar {}
            TabsRow {
                active_tab: active_tab(),
                on_switch: move |tab| active_tab.set(tab),
            }
            ribbon_groups::RibbonPanel {
                active_tab: active_tab(),
                paper_mode: paper_mode(),
                custom_width_mm: custom_width_mm(),
                custom_height_mm: custom_height_mm(),
                show_ruler: show_ruler(),
                on_paper_mode_change: move |mode| paper_mode.set(mode),
                on_custom_width_change: move |width| custom_width_mm.set(width),
                on_custom_height_change: move |height| custom_height_mm.set(height),
                on_toggle_ruler: move |_| show_ruler.set(!show_ruler()),
            }
            EditorSurface {
                editor_mode: editor_mode(),
                markdown_preview_open: markdown_preview_open(),
                markdown_source: source,
                on_markdown_change: move |next| markdown_source.set(next),
                paper_mode: paper_mode(),
                custom_width_mm: custom_width_mm(),
                custom_height_mm: custom_height_mm(),
                show_ruler: show_ruler(),
            }
            StatusBar {
                zoom: zoom(),
                editor_mode: editor_mode(),
                markdown_preview_open: markdown_preview_open(),
                on_markdown_click: move |_| {
                    if editor_mode() == EditorMode::MarkdownSource {
                        markdown_preview_open.set(!markdown_preview_open());
                    } else {
                        editor_mode.set(EditorMode::MarkdownSource);
                        markdown_preview_open.set(true);
                    }
                },
                on_wysiwyg_click: move |_| editor_mode.set(EditorMode::Wysiwyg),
            }
        }
    }
}
