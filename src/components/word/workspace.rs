#[cfg(feature = "desktop")]
use super::file_actions::browse_document_dialog;
use super::file_actions::{
    file_name_or, handle_export_document, handle_open_document_from_path, handle_save_as_document,
    handle_save_document, OpenDocumentState,
};
use super::file_backstage::{FileBackstage, OpenConfigDialog, WarningAlert};
use super::resize_handles::ResizeHandles;
use super::{
    document_renderer, prosemirror_surface, ribbon_groups, EditorSurface, RibbonTab, StatusBar,
    TabsRow, TitleBar,
};
use crate::document::{ProjectDocument, ResourceBundle};
use crate::engine::{EditorMode, ParserGateway};
use crate::storage::DocumentLocation;
use dioxus::prelude::*;

#[derive(Debug, serde::Deserialize)]
struct MarkdownChangeEnvelope {
    document_revision: u64,
    edit_revision: u64,
    #[serde(default)]
    origin: Option<String>,
    #[serde(default)]
    selection: Option<MarkdownSelection>,
    markdown: String,
}

#[derive(Debug, serde::Deserialize)]
struct MarkdownSelection {
    anchor: usize,
    head: usize,
}

#[cfg(feature = "desktop")]
#[derive(Debug, serde::Deserialize)]
struct ClipboardPasteRequest {
    request_id: u64,
}

#[cfg(feature = "desktop")]
fn read_clipboard_png() -> Result<String, String> {
    use base64::Engine as _;

    let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
    let image = clipboard
        .wait_for_image()
        .ok_or_else(|| "剪贴板中没有可读取的图片".to_string())?;
    let png = image
        .save_to_bufferv("png", &[])
        .map_err(|error| format!("编码剪贴板图片失败：{error}"))?;
    if png.len() > 128 * 1024 * 1024 {
        return Err("剪贴板图片超过 128 MiB 限制".to_string());
    }
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

#[component]
pub fn WordWorkspace() -> Element {
    let mut active_tab = use_signal(|| RibbonTab::Home);
    let zoom = use_signal(|| 100u16);
    let mut editor_mode = use_signal(|| EditorMode::Wysiwyg);
    let mut markdown_preview_open = use_signal(|| true);
    let mut document = use_signal(|| ProjectDocument::new(String::new()));
    let document_revision = use_signal(|| 0u64);
    let mut editor_revision = use_signal(|| 0u64);
    #[allow(unused_mut)]
    let mut resources = use_signal(ResourceBundle::default);
    let mut show_ruler = use_signal(|| true);
    let current_location = use_signal(|| None::<DocumentLocation>);
    #[allow(unused_mut)]
    let mut status_hint = use_signal(|| "就绪".to_string());
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
                            prosemirror_surface::run_command(command);
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
                        let should_refresh_wysiwyg = editor_mode() == EditorMode::Wysiwyg
                            && matches!(change.origin.as_deref(), Some("undo" | "redo"));
                        let markdown = change.markdown;
                        document.write().markdown = markdown.clone();
                        editor_revision.set(change.edit_revision);
                        if should_refresh_wysiwyg {
                            prosemirror_surface::set_document(
                                markdown,
                                change.document_revision,
                                change.edit_revision,
                                change.selection.map(|selection| {
                                    (selection.anchor, selection.head)
                                }),
                            );
                        }
                    },
                    on_clipboard_paste: move |payload: String| {
                        #[cfg(feature = "desktop")]
                        if let Ok(request) = serde_json::from_str::<ClipboardPasteRequest>(&payload) {
                            match read_clipboard_png() {
                                Ok(data_url) => {
                                    let configured_root = document.read().layout.resources.root.clone();
                                    let resource_root = if configured_root.is_empty() {
                                        document.write().layout.resources.root =
                                            "document.assets".to_string();
                                        "document.assets".to_string()
                                    } else {
                                        configured_root
                                    };
                                    let path = format!(
                                        "{}/pasted-image-{}-{}.png",
                                        resource_root.trim_end_matches('/'),
                                        std::process::id(),
                                        request.request_id,
                                    );
                                    spawn(async move {
                                        let script_path = serde_json::to_string(&path)
                                            .unwrap_or_else(|_| "\"\"".into());
                                        let script = format!(
                                            "return window.InfiniteMarkdownEditor?.completeClipboardImagePaste({}, {}) ?? false;",
                                            request.request_id,
                                            script_path,
                                        );
                                        if matches!(
                                            document::eval(&script).join::<bool>().await,
                                            Ok(true)
                                        ) {
                                            resources.write().insert(path, data_url);
                                        }
                                    });
                                }
                                Err(error) => status_hint.set(error),
                            }
                        }
                        #[cfg(not(feature = "desktop"))]
                        let _ = payload;
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
                        let expected_document_revision = document_revision();
                        spawn(async move {
                            let script = format!(
                                "return JSON.stringify(window.InfiniteWysiwygEditor?.prepareModeSwitch('{}') ?? {{ ok: false, error: 'WYSIWYG 会话不存在' }});",
                                prosemirror_surface::PROSEMIRROR_HOST_ID,
                            );
                            let result = document::eval(&script)
                                .join::<String>()
                                .await
                                .map_err(|error| error.to_string())
                                .and_then(|json| {
                                    serde_json::from_str::<serde_json::Value>(&json)
                                        .map_err(|error| error.to_string())
                                });
                            match result {
                                Ok(value)
                                    if value.get("ok").and_then(serde_json::Value::as_bool)
                                        == Some(true)
                                        && value
                                            .get("document_revision")
                                            .and_then(serde_json::Value::as_u64)
                                            == Some(expected_document_revision) =>
                                {
                                    if let Some(markdown) = value
                                        .get("markdown")
                                        .and_then(serde_json::Value::as_str)
                                    {
                                        document.write().markdown = markdown.to_string();
                                    }
                                    if let Some(revision) = value
                                        .get("edit_revision")
                                        .and_then(serde_json::Value::as_u64)
                                    {
                                        editor_revision.set(revision);
                                    }
                                    markdown_preview_open.set(true);
                                    editor_mode.set(EditorMode::MarkdownSource);
                                }
                                Ok(value) => status_hint.set(
                                    value
                                        .get("error")
                                        .and_then(serde_json::Value::as_str)
                                        .unwrap_or("输入法组合期间暂不能切换到源码模式")
                                        .to_string(),
                                ),
                                Err(error) => {
                                    status_hint.set(format!("切换源码模式失败：{error}"));
                                }
                            }
                        });
                    }
                },
                on_wysiwyg_click: move |_| editor_mode.set(EditorMode::Wysiwyg),
            }
        }
    }
}
