use super::file_backstage::{ExportTarget, SaveAsTarget};
use super::RibbonTab;
use crate::document::{ProjectDocument, ResourceBundle};
#[cfg(feature = "desktop")]
use crate::storage;
use crate::storage::DocumentLocation;
use dioxus::prelude::*;
use std::path::Path;
#[cfg(feature = "desktop")]
use std::path::PathBuf;

pub(super) fn file_name_or(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(fallback)
        .to_string()
}

#[cfg(feature = "desktop")]
pub(super) async fn browse_document_dialog() -> Option<PathBuf> {
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
        storage::save_package(
            &path,
            &document,
            Some(&resources),
            loose_source,
            package_source,
        )?;
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
pub(super) struct OpenDocumentState {
    pub(super) active_tab: Signal<RibbonTab>,
    pub(super) document: Signal<ProjectDocument>,
    pub(super) resources: Signal<ResourceBundle>,
    pub(super) document_revision: Signal<u64>,
    pub(super) editor_revision: Signal<u64>,
    pub(super) current_location: Signal<Option<DocumentLocation>>,
    pub(super) status_hint: Signal<String>,
    pub(super) open_dialog_visible: Signal<bool>,
    pub(super) warning_alert: Signal<Option<String>>,
}

pub(super) fn handle_open_document_from_path(
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

pub(super) fn handle_save_document(
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
            match storage::save_document(&location, &current_document, &resources.read()) {
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

pub(super) fn handle_save_as_document(
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

pub(super) fn handle_export_document(
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
