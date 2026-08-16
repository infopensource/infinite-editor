mod document_layout;
mod editor_surface;
mod file_backstage;
mod ribbon_groups;
mod status_bar;
mod tabs_row;
mod title_bar;

use crate::config::{DEFAULT_CUSTOM_PAPER_HEIGHT_MM, DEFAULT_CUSTOM_PAPER_WIDTH_MM};
use crate::engine::EditorMode;
use dioxus::prelude::*;
use file_backstage::{ExportTarget, FileBackstage, OpenConfigDialog};
use std::path::{Path, PathBuf};

pub use document_layout::PaperMode;
pub use editor_surface::EditorSurface;
pub use status_bar::StatusBar;
pub use tabs_row::TabsRow;
pub use title_bar::TitleBar;

#[cfg(feature = "desktop")]
fn file_name_or(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(fallback)
        .to_string()
}

#[cfg(not(feature = "desktop"))]
fn file_name_or(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(fallback)
        .to_string()
}

#[cfg(feature = "desktop")]
async fn browse_document_dialog() -> Option<PathBuf> {
    let picked = rfd::AsyncFileDialog::new()
        .add_filter("Document", &["md", "txt"])
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .pick_file()
        .await;

    picked.map(|file| file.path().to_path_buf())
}

#[cfg(feature = "desktop")]
fn open_document_from_path(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|err| format!("读取文件失败: {err}"))
}

#[cfg(feature = "desktop")]
fn save_document_to(path: &Path, source: &str) -> Result<(), String> {
    std::fs::write(path, source).map_err(|err| format!("保存文件失败: {err}"))
}

#[cfg(feature = "desktop")]
fn save_document_as_dialog(source: &str) -> Result<Option<PathBuf>, String> {
    let picked = rfd::FileDialog::new()
        .add_filter("Markdown", &["md"])
        .set_file_name("document.md")
        .save_file();

    let Some(path) = picked else {
        return Ok(None);
    };

    save_document_to(&path, source)?;
    Ok(Some(path))
}

#[cfg(feature = "desktop")]
fn export_dialog(target: ExportTarget, source: &str) -> Result<Option<PathBuf>, String> {
    let (name, extensions): (&str, &[&str]) = match target {
        ExportTarget::Markdown => ("document.md", &["md"]),
        ExportTarget::Pdf => ("document.pdf", &["pdf"]),
        ExportTarget::Odt => ("document.odt", &["odt"]),
        ExportTarget::Word => ("document.docx", &["docx"]),
        ExportTarget::Png => ("document.png", &["png"]),
        ExportTarget::Jpeg => ("document.jpg", &["jpg", "jpeg"]),
    };

    let picked = rfd::FileDialog::new()
        .set_file_name(name)
        .add_filter("Export", extensions)
        .save_file();

    let Some(path) = picked else {
        return Ok(None);
    };

    if target == ExportTarget::Markdown {
        std::fs::write(&path, source).map_err(|err| format!("导出失败: {err}"))?;
    }

    Ok(Some(path))
}

#[derive(Clone, Copy)]
struct OpenDocumentState {
    active_tab: Signal<RibbonTab>,
    markdown_source: Signal<String>,
    document_revision: Signal<u64>,
    current_file_path: Signal<Option<PathBuf>>,
    status_hint: Signal<String>,
    open_dialog_visible: Signal<bool>,
}

fn handle_open_document_from_path(
    path_input: String,
    read_only_mode: bool,
    auto_detect_encoding: bool,
    mut state: OpenDocumentState,
) {
    #[cfg(feature = "desktop")]
    {
        let trimmed = path_input.trim();
        if trimmed.is_empty() {
            state.status_hint.set("请先输入文件路径".to_string());
            return;
        }

        let path = PathBuf::from(trimmed);
        match open_document_from_path(&path) {
            Ok(content) => {
                state.markdown_source.set(content);
                state
                    .document_revision
                    .with_mut(|revision| *revision = revision.wrapping_add(1));
                state.current_file_path.set(Some(path.clone()));
                let mode = if read_only_mode {
                    "只读"
                } else {
                    "可编辑"
                };
                let encoding = if auto_detect_encoding {
                    "自动编码"
                } else {
                    "UTF-8"
                };
                state.status_hint.set(format!(
                    "已打开 {}（{}，{}）",
                    file_name_or(&path, "文档"),
                    mode,
                    encoding
                ));
                state.open_dialog_visible.set(false);
                state.active_tab.set(RibbonTab::Home);
            }
            Err(err) => state.status_hint.set(err),
        }
    }

    #[cfg(not(feature = "desktop"))]
    {
        let _ = path_input;
        let _ = state;
        state
            .status_hint
            .set("当前平台暂不支持系统文件对话框".to_string());
    }
}

fn handle_save_document(
    markdown_source: Signal<String>,
    mut current_file_path: Signal<Option<PathBuf>>,
    mut status_hint: Signal<String>,
) {
    #[cfg(feature = "desktop")]
    {
        let source = markdown_source();

        if let Some(path) = current_file_path() {
            match save_document_to(&path, &source) {
                Ok(_) => status_hint.set(format!("已保存 {}", file_name_or(&path, "文档"))),
                Err(err) => status_hint.set(err),
            }
        } else {
            match save_document_as_dialog(&source) {
                Ok(Some(path)) => {
                    current_file_path.set(Some(path.clone()));
                    status_hint.set(format!("已保存 {}", file_name_or(&path, "文档")));
                }
                Ok(None) => status_hint.set("已取消保存".to_string()),
                Err(err) => status_hint.set(err),
            }
        }
    }

    #[cfg(not(feature = "desktop"))]
    {
        let _ = markdown_source;
        let _ = current_file_path;
        status_hint.set("当前平台暂不支持系统文件对话框".to_string());
    }
}

fn handle_save_as_document(
    markdown_source: Signal<String>,
    mut current_file_path: Signal<Option<PathBuf>>,
    mut status_hint: Signal<String>,
) {
    #[cfg(feature = "desktop")]
    {
        match save_document_as_dialog(&markdown_source()) {
            Ok(Some(path)) => {
                current_file_path.set(Some(path.clone()));
                status_hint.set(format!("已另存为 {}", file_name_or(&path, "文档")));
            }
            Ok(None) => status_hint.set("已取消另存为".to_string()),
            Err(err) => status_hint.set(err),
        }
    }

    #[cfg(not(feature = "desktop"))]
    {
        let _ = markdown_source;
        let _ = current_file_path;
        status_hint.set("当前平台暂不支持系统文件对话框".to_string());
    }
}

fn handle_export_document(
    target: ExportTarget,
    markdown_source: Signal<String>,
    mut status_hint: Signal<String>,
) {
    #[cfg(feature = "desktop")]
    {
        match export_dialog(target, &markdown_source()) {
            Ok(Some(path)) => {
                if target == ExportTarget::Markdown {
                    status_hint.set(format!("已导出 {}", file_name_or(&path, "文件")));
                } else {
                    status_hint.set(format!(
                        "已选择导出路径：{}（{} 导出引擎待接入）",
                        file_name_or(&path, "文件"),
                        target.label()
                    ));
                }
            }
            Ok(None) => status_hint.set("已取消导出".to_string()),
            Err(err) => status_hint.set(err),
        }
    }

    #[cfg(not(feature = "desktop"))]
    {
        let _ = target;
        let _ = markdown_source;
        status_hint.set("当前平台暂不支持系统文件对话框".to_string());
    }
}

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
    let document_revision = use_signal(|| 0u64);
    let mut paper_mode = use_signal(|| PaperMode::A4);
    let mut custom_width_mm = use_signal(|| DEFAULT_CUSTOM_PAPER_WIDTH_MM);
    let mut custom_height_mm = use_signal(|| DEFAULT_CUSTOM_PAPER_HEIGHT_MM);
    let mut show_ruler = use_signal(|| true);
    let current_file_path = use_signal(|| None::<PathBuf>);
    let status_hint = use_signal(|| "就绪".to_string());
    let mut open_dialog_visible = use_signal(|| false);
    let mut open_path_input = use_signal(String::new);
    let mut open_read_only_mode = use_signal(|| false);
    let mut open_auto_detect_encoding = use_signal(|| true);
    let mut browse_pending = use_signal(|| false);
    let title_name = current_file_path()
        .as_ref()
        .map(|path| file_name_or(path, "未命名文档"))
        .unwrap_or_else(|| "未命名文档".to_string());

    rsx! {
        div { class: "word-shell",
            ResizeHandles {}
            TitleBar { document_title: title_name }
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
                on_open: move |_| {
                    open_dialog_visible.set(true);
                    if let Some(path) = current_file_path() {
                        open_path_input.set(path.display().to_string());
                    }
                },
                on_save: move |_| {
                    handle_save_document(markdown_source, current_file_path, status_hint);
                },
                on_save_as: move |_| {
                    handle_save_as_document(markdown_source, current_file_path, status_hint);
                },
                on_export: move |target| {
                    handle_export_document(target, markdown_source, status_hint);
                },
            }
            if active_tab() == RibbonTab::File {
                FileBackstage {
                    current_file: current_file_path().map(|path| path.display().to_string()),
                    status_hint: status_hint(),
                    can_save: current_file_path().is_some(),
                    on_open: move |_| {
                        open_dialog_visible.set(true);
                        if let Some(path) = current_file_path() {
                            open_path_input.set(path.display().to_string());
                        }
                    },
                    on_save: move |_| {
                        handle_save_document(markdown_source, current_file_path, status_hint);
                    },
                    on_save_as: move |_| {
                        handle_save_as_document(markdown_source, current_file_path, status_hint);
                    },
                    on_export: move |target| {
                        handle_export_document(target, markdown_source, status_hint);
                    },
                }
            } else {
                EditorSurface {
                    editor_mode: editor_mode(),
                    markdown_preview_open: markdown_preview_open(),
                    markdown_source,
                    document_revision,
                    on_markdown_change: move |next| markdown_source.set(next),
                    paper_mode: paper_mode(),
                    custom_width_mm: custom_width_mm(),
                    custom_height_mm: custom_height_mm(),
                    show_ruler: show_ruler(),
                }
            }
            OpenConfigDialog {
                visible: open_dialog_visible(),
                path_input: open_path_input(),
                read_only_mode: open_read_only_mode(),
                auto_detect_encoding: open_auto_detect_encoding(),
                browse_pending: browse_pending(),
                on_close: move |_| open_dialog_visible.set(false),
                on_path_input: move |value| open_path_input.set(value),
                on_toggle_read_only: move |_| open_read_only_mode.set(!open_read_only_mode()),
                on_toggle_auto_detect: move |_| {
                    open_auto_detect_encoding.set(!open_auto_detect_encoding())
                },
                on_browse: move |_| {
                    #[cfg(feature = "desktop")]
                    {
                        browse_pending.set(true);
                        spawn(async move {
                            if let Some(path) = browse_document_dialog().await {
                                open_path_input.set(path.display().to_string());
                            }
                            browse_pending.set(false);
                        });
                    }

                    #[cfg(not(feature = "desktop"))]
                    {
                        status_hint.set("当前平台暂不支持系统文件对话框".to_string());
                    }
                },
                on_confirm: move |_| {
                    handle_open_document_from_path(
                        open_path_input(),
                        open_read_only_mode(),
                        open_auto_detect_encoding(),
                        OpenDocumentState {
                            active_tab,
                            markdown_source,
                            document_revision,
                            current_file_path,
                            status_hint,
                            open_dialog_visible,
                        },
                    );
                },
            }
            StatusBar {
                zoom: zoom(),
                editor_mode: editor_mode(),
                markdown_preview_open: markdown_preview_open(),
                status_hint: status_hint(),
                current_file: current_file_path().map(|path| file_name_or(&path, "未命名文档")),
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
