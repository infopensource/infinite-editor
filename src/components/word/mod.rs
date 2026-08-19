mod document_layout;
pub(crate) mod document_renderer;
mod editor_surface;
mod file_backstage;
mod ribbon_groups;
mod status_bar;
mod tabs_row;
mod title_bar;

pub(super) const MARKDOWN_DOCUMENT_BRIDGE_ID: &str = "markdown-document-bridge";

use crate::document::{ProjectDocument, ResourceBundle};
use crate::engine::{EditorMode, ParserGateway};
#[cfg(feature = "desktop")]
use crate::storage;
use crate::storage::DocumentLocation;
use dioxus::prelude::*;
use file_backstage::{ExportTarget, FileBackstage, OpenConfigDialog, SaveAsTarget, WarningAlert};
use std::path::Path;
#[cfg(feature = "desktop")]
use std::path::PathBuf;

#[derive(Debug, serde::Deserialize)]
struct MarkdownChangeEnvelope {
    document_revision: u64,
    edit_revision: u64,
    markdown: String,
}

pub use crate::document::PaperMode;
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
        // Keep every format the loader accepts visible in the default filter.
        // Some Linux GTK/portal file choosers make switching away from the
        // first filter difficult or omit the selector altogether.
        .add_filter(
            "Supported Documents",
            &["infdoc", "md", "markdown", "mdown", "mkd", "txt", "idoc"],
        )
        .add_filter("Infinite Document", &["infdoc", "idoc"])
        .add_filter("Markdown", &["md", "markdown", "mdown", "mkd"])
        .add_filter("Text", &["txt"])
        .pick_file()
        .await;

    picked.map(|file| file.path().to_path_buf())
}

#[cfg(feature = "desktop")]
async fn save_document_as_dialog(
    document: ProjectDocument,
    resources: ResourceBundle,
    source_location: Option<DocumentLocation>,
    target: Option<SaveAsTarget>,
) -> Result<Option<DocumentLocation>, String> {
    let dialog = match target {
        Some(SaveAsTarget::InfiniteDocument) => rfd::AsyncFileDialog::new()
            .add_filter("Infinite Document", &["infdoc"])
            .set_file_name("document.infdoc"),
        Some(SaveAsTarget::MarkdownProject) => rfd::AsyncFileDialog::new()
            .add_filter("Markdown", &["md"])
            .set_file_name("document.md"),
        None => rfd::AsyncFileDialog::new()
            .add_filter("Markdown", &["md"])
            .add_filter("Infinite Document", &["infdoc"])
            .set_file_name("document.md"),
    };
    let picked = dialog.save_file().await;

    let Some(file) = picked else {
        return Ok(None);
    };
    let mut path = file.path().to_path_buf();
    match target {
        Some(SaveAsTarget::InfiniteDocument) => {
            path.set_extension("infdoc");
        }
        Some(SaveAsTarget::MarkdownProject) => {
            path.set_extension("md");
        }
        None => {}
    }

    let location = if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("infdoc"))
    {
        let loose_source = source_location
            .as_ref()
            .and_then(|location| match location {
                DocumentLocation::Loose { markdown_path } => Some(markdown_path.as_path()),
                DocumentLocation::Package { .. } => None,
            });
        let package_source = source_location
            .as_ref()
            .and_then(|location| match location {
                DocumentLocation::Package { package_path } => Some(package_path.as_path()),
                DocumentLocation::Loose { .. } => None,
            });
        storage::save_package(&path, &document, loose_source, package_source)?;
        DocumentLocation::Package { package_path: path }
    } else {
        storage::save_loose_with_resources(&path, &document, &resources)?;
        DocumentLocation::Loose {
            markdown_path: path,
        }
    };
    Ok(Some(location))
}

#[cfg(feature = "desktop")]
async fn export_dialog(target: ExportTarget) -> Result<Option<PathBuf>, String> {
    let (name, extensions): (&str, &[&str]) = match target {
        ExportTarget::Markdown => ("document.md", &["md"]),
        ExportTarget::Pdf => ("document.pdf", &["pdf"]),
        ExportTarget::Odt => ("document.odt", &["odt"]),
        ExportTarget::Word => ("document.docx", &["docx"]),
        ExportTarget::Png => ("document.png", &["png"]),
        ExportTarget::Jpeg => ("document.jpg", &["jpg", "jpeg"]),
    };

    let picked = rfd::AsyncFileDialog::new()
        .set_file_name(name)
        .add_filter("Export", extensions)
        .save_file()
        .await;

    let Some(file) = picked else {
        return Ok(None);
    };
    let mut path = file.path().to_path_buf();
    let extension = match target {
        ExportTarget::Markdown => "md",
        ExportTarget::Pdf => "pdf",
        ExportTarget::Odt => "odt",
        ExportTarget::Word => "docx",
        ExportTarget::Png => "png",
        ExportTarget::Jpeg => "jpg",
    };
    path.set_extension(extension);

    Ok(Some(path))
}

#[derive(Clone, Copy)]
#[cfg_attr(not(feature = "desktop"), allow(dead_code))]
struct OpenDocumentState {
    active_tab: Signal<RibbonTab>,
    document: Signal<ProjectDocument>,
    resources: Signal<ResourceBundle>,
    document_revision: Signal<u64>,
    editor_revision: Signal<u64>,
    current_location: Signal<Option<DocumentLocation>>,
    status_hint: Signal<String>,
    open_dialog_visible: Signal<bool>,
    warning_alert: Signal<Option<String>>,
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
        match storage::open_document(&path) {
            Ok(loaded) => {
                let mut warnings = loaded.warnings.clone();
                if warnings
                    .iter()
                    .any(|warning| warning == storage::STALE_LAYOUT_WARNING)
                {
                    state
                        .warning_alert
                        .set(Some(storage::STALE_LAYOUT_WARNING.to_string()));
                    warnings.retain(|warning| warning != storage::STALE_LAYOUT_WARNING);
                }
                state.document.set(loaded.document);
                state.resources.set(loaded.resources);
                state
                    .document_revision
                    .with_mut(|revision| *revision = revision.wrapping_add(1));
                state.editor_revision.set(0);
                state.current_location.set(Some(loaded.location));
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
                let warning_suffix = if warnings.is_empty() {
                    String::new()
                } else {
                    format!("；{}", warnings.join("；"))
                };
                state.status_hint.set(format!(
                    "已打开 {}（{}，{}）{}",
                    file_name_or(&path, "文档"),
                    mode,
                    encoding,
                    warning_suffix,
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
        let _ = read_only_mode;
        let _ = auto_detect_encoding;
        let _ = state;
        state
            .status_hint
            .set("当前平台暂不支持系统文件对话框".to_string());
    }
}

fn handle_save_document(
    document: Signal<ProjectDocument>,
    resources: Signal<ResourceBundle>,
    current_location: Signal<Option<DocumentLocation>>,
    mut status_hint: Signal<String>,
) {
    #[cfg(feature = "desktop")]
    {
        let mut current_location = current_location;
        let current_document = document();

        if let Some(location) = current_location() {
            match storage::save_document(&location, &current_document) {
                Ok(_) => {
                    status_hint.set(format!("已保存 {}", file_name_or(location.path(), "文档")))
                }
                Err(err) => status_hint.set(err),
            }
        } else {
            let current_resources = resources.read().clone();
            status_hint.set("请选择保存位置".to_string());
            spawn(async move {
                match save_document_as_dialog(current_document, current_resources, None, None).await
                {
                    Ok(Some(location)) => {
                        let name = file_name_or(location.path(), "文档");
                        current_location.set(Some(location));
                        status_hint.set(format!("已保存 {name}"));
                    }
                    Ok(None) => status_hint.set("已取消保存".to_string()),
                    Err(err) => status_hint.set(err),
                }
            });
        }
    }

    #[cfg(not(feature = "desktop"))]
    {
        let _ = document;
        let _ = resources;
        let _ = current_location;
        status_hint.set("当前平台暂不支持系统文件对话框".to_string());
    }
}

fn handle_save_as_document(
    document: Signal<ProjectDocument>,
    resources: Signal<ResourceBundle>,
    current_location: Signal<Option<DocumentLocation>>,
    mut status_hint: Signal<String>,
    target: Option<SaveAsTarget>,
) {
    #[cfg(feature = "desktop")]
    {
        let mut current_location = current_location;
        let source_location = current_location();
        let current_document = document();
        let current_resources = resources.read().clone();
        status_hint.set("请选择另存位置".to_string());
        spawn(async move {
            match save_document_as_dialog(
                current_document,
                current_resources,
                source_location,
                target,
            )
            .await
            {
                Ok(Some(location)) => {
                    let name = file_name_or(location.path(), "文档");
                    current_location.set(Some(location));
                    status_hint.set(format!("已另存为 {name}"));
                }
                Ok(None) => status_hint.set("已取消另存为".to_string()),
                Err(err) => status_hint.set(err),
            }
        });
    }

    #[cfg(not(feature = "desktop"))]
    {
        let _ = document;
        let _ = resources;
        let _ = current_location;
        let _ = target;
        status_hint.set("当前平台暂不支持系统文件对话框".to_string());
    }
}

fn handle_export_document(
    target: ExportTarget,
    document: Signal<ProjectDocument>,
    resources: Signal<ResourceBundle>,
    mut status_hint: Signal<String>,
) {
    #[cfg(feature = "desktop")]
    {
        let current_document = document.read().clone();
        let current_resources = resources.read().clone();
        status_hint.set("请选择导出位置".to_string());
        spawn(async move {
            match export_dialog(target).await {
                Ok(Some(path)) => {
                    let result = match target {
                        ExportTarget::Markdown => std::fs::write(&path, &current_document.markdown)
                            .map_err(|error| format!("导出 Markdown 失败: {error}")),
                        ExportTarget::Pdf => {
                            status_hint.set("正在排版并生成 PDF".to_string());
                            let (sender, receiver) = futures_channel::oneshot::channel();
                            let export_path = path.clone();
                            std::thread::spawn(move || {
                                let result = crate::export::export_pdf(
                                    &export_path,
                                    &current_document,
                                    &current_resources,
                                );
                                let _ = sender.send(result);
                            });
                            receiver
                                .await
                                .unwrap_or_else(|_| Err("PDF 导出任务意外终止".to_string()))
                        }
                        _ => Err(format!("{} 导出引擎尚未接入", target.label())),
                    };

                    match result {
                        Ok(()) => {
                            status_hint.set(format!("已导出 {}", file_name_or(&path, "文件")))
                        }
                        Err(error) => status_hint.set(error),
                    }
                }
                Ok(None) => status_hint.set("已取消导出".to_string()),
                Err(err) => status_hint.set(err),
            }
        });
    }

    #[cfg(not(feature = "desktop"))]
    {
        let _ = target;
        let _ = document;
        let _ = resources;
        status_hint.set("当前平台暂不支持系统文件对话框".to_string());
    }
}

#[cfg(feature = "desktop")]
fn drag_resize(direction: dioxus::desktop::tao::window::ResizeDirection) {
    _ = dioxus::desktop::window().drag_resize_window(direction);
}

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
    let mut document = use_signal(|| {
        ProjectDocument::new(
            "# 项目计划书\n\n这是一个基于 **Markdown 扩展** 的富文本引擎原型。\n\n## 本阶段目标\n\n- 解析接口与后端隔离\n- Markdown 源码与 WYSIWYG 模式切换\n- Markdown 源码高亮（syntect）\n\n> 后续将在此基础上继续扩展自定义语法。\n"
                .to_string(),
        )
    });
    let document_revision = use_signal(|| 0u64);
    let mut editor_revision = use_signal(|| 0u64);
    let resources = use_signal(ResourceBundle::default);
    let mut show_ruler = use_signal(|| true);
    let current_location = use_signal(|| None::<DocumentLocation>);
    let status_hint = use_signal(|| "就绪".to_string());
    let mut open_dialog_visible = use_signal(|| false);
    let mut warning_alert = use_signal(|| None::<String>);
    let mut open_path_input = use_signal(String::new);
    let mut open_read_only_mode = use_signal(|| false);
    let mut open_auto_detect_encoding = use_signal(|| true);
    #[allow(unused_mut)]
    let mut browse_pending = use_signal(|| false);
    let title_name = current_location()
        .as_ref()
        .map(|location| file_name_or(location.path(), "未命名文档"))
        .unwrap_or_else(|| "未命名文档".to_string());
    let current_document = document();
    let character_count = ParserGateway::markdown_rs().character_count(&current_document.markdown);
    let paper = current_document.layout.paper.clone();
    let margins = current_document.layout.margins.clone();

    rsx! {
        div { class: if active_tab() == RibbonTab::File { "word-shell file-mode" } else { "word-shell" },
            ResizeHandles {}
            TitleBar { document_title: title_name }
            TabsRow {
                active_tab: active_tab(),
                on_switch: move |tab| active_tab.set(tab),
            }
            if active_tab() != RibbonTab::File {
                ribbon_groups::RibbonPanel {
                    active_tab: active_tab(),
                    paper_mode: paper.mode,
                    custom_width_mm: paper.width_mm.round() as u16,
                    custom_height_mm: paper.height_mm.round() as u16,
                    show_ruler: show_ruler(),
                    on_paper_mode_change: move |mode| document.write().layout.paper.mode = mode,
                    on_custom_width_change: move |width| { document.write().layout.paper.width_mm = width as f32 },
                    on_custom_height_change: move |height| { document.write().layout.paper.height_mm = height as f32 },
                    on_toggle_ruler: move |_| show_ruler.set(!show_ruler()),
                    on_editor_command: move |command| {
                        if editor_mode() == EditorMode::Wysiwyg {
                            document_renderer::run_wysiwyg_command(command);
                        } else {
                            document_renderer::run_markdown_command(command);
                        }
                    },
                }
            }
            if active_tab() == RibbonTab::File {
                FileBackstage {
                    current_file: current_location().map(|location| location.path().display().to_string()),
                    status_hint: status_hint(),
                    has_location: current_location().is_some(),
                    on_back: move |_| active_tab.set(RibbonTab::Home),
                    on_open: move |_| {
                        open_dialog_visible.set(true);
                        if let Some(location) = current_location() {
                            open_path_input.set(location.path().display().to_string());
                        }
                    },
                    on_save: move |_| {
                        handle_save_document(document, resources, current_location, status_hint);
                    },
                    on_save_as: move |target| {
                        handle_save_as_document(
                            document,
                            resources,
                            current_location,
                            status_hint,
                            Some(target),
                        );
                    },
                    on_export: move |target| {
                        handle_export_document(target, document, resources, status_hint);
                    },
                }
            } else {
                EditorSurface {
                    editor_mode: editor_mode(),
                    markdown_preview_open: markdown_preview_open(),
                    document,
                    resources,
                    document_revision,
                    editor_revision,
                    on_markdown_change: move |payload: String| {
                        let Ok(change) = serde_json::from_str::<MarkdownChangeEnvelope>(&payload) else {
                            return;
                        };
                        if change.document_revision != document_revision()
                            || change.edit_revision <= editor_revision()
                        {
                            return;
                        }
                        document.write().markdown = change.markdown;
                        editor_revision.set(change.edit_revision);
                    },
                    paper_mode: paper.mode,
                    custom_width_mm: paper.width_mm,
                    custom_height_mm: paper.height_mm,
                    orientation: paper.orientation,
                    margins: margins.clone(),
                    show_ruler: show_ruler(),
                    on_left_margin_change: move |value| { document.write().layout.margins.left_mm = value },
                    on_right_margin_change: move |value| { document.write().layout.margins.right_mm = value },
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
                on_toggle_auto_detect: move |_| { open_auto_detect_encoding.set(!open_auto_detect_encoding()) },
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
                        let mut status_hint = status_hint;
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
                            document,
                            resources,
                            document_revision,
                            editor_revision,
                            current_location,
                            status_hint,
                            open_dialog_visible,
                            warning_alert,
                        },
                    );
                },
            }
            WarningAlert {
                message: warning_alert(),
                on_close: move |_| warning_alert.set(None),
            }
            StatusBar {
                zoom: zoom(),
                editor_mode: editor_mode(),
                markdown_preview_open: markdown_preview_open(),
                status_hint: status_hint(),
                current_file: current_location().map(|location| file_name_or(location.path(), "未命名文档")),
                character_count,
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
