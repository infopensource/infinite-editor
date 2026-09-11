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
    #[serde(default)]
    page_furniture: Option<crate::document::PageFurnitureSettings>,
}

#[derive(Debug, serde::Deserialize)]
struct MarkdownSelection {
    anchor: usize,
    head: usize,
}

#[derive(Debug, serde::Deserialize)]
struct PageStatus {
    current: usize,
    total: usize,
}

#[derive(Debug, serde::Deserialize)]
struct SelectionStatus {
    selected: bool,
    #[serde(default)]
    markdown: Option<String>,
    #[serde(default)]
    character_count: Option<usize>,
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
    let mut zoom = use_signal(|| 100u16);
    let mut editor_mode = use_signal(|| EditorMode::Wysiwyg);
    let mut markdown_preview_open = use_signal(|| true);
    let mut document = use_signal(|| ProjectDocument::new(String::new()));
    let mut saved_document = use_signal(|| ProjectDocument::new(String::new()));
    let document_revision = use_signal(|| 0u64);
    let mut editor_revision = use_signal(|| 0u64);
    #[allow(unused_mut)]
    let mut resources = use_signal(ResourceBundle::default);
    let mut show_ruler = use_signal(|| true);
    let current_location = use_signal(|| None::<DocumentLocation>);
    #[allow(unused_mut)]
    let mut status_hint = use_signal(|| "就绪".to_string());
    let mut open_pending = use_signal(|| false);
    let mut open_generation = use_signal(|| 0u64);
    let mut open_dialog_visible = use_signal(|| false);
    let mut warning_alert = use_signal(|| None::<String>);
    let mut open_path_input = use_signal(String::new);
    let mut open_read_only_mode = use_signal(|| false);
    let mut open_auto_detect_encoding = use_signal(|| true);
    #[allow(unused_mut)]
    let mut browse_pending = use_signal(|| false);
    use_effect(move || {
        let _revision = document_revision();
        saved_document.set(document.peek().clone());
    });
    let title_name = if !document.read().layout.document.title.is_empty() {
        document.read().layout.document.title.clone()
    } else { current_location()
        .as_ref()
        .map(|location| file_name_or(location.path(), "未命名文档"))
        .unwrap_or_else(|| "未命名文档".to_string()) };
    let current_document = document();
    let count_source = use_memo(move || document.read().markdown.clone());
    let mut character_count = use_signal(|| 0usize);
    let mut selection_active = use_signal(|| false);
    let mut selected_source = use_signal(|| None::<String>);
    let mut selected_character_count = use_signal(|| None::<usize>);
    let mut page_status = use_signal(|| PageStatus {
        current: 1,
        total: 1,
    });
    use_resource(move || {
        let source = count_source();
        async move {
            if let Ok(count) = super::background::run(move || {
                ParserGateway::markdown_rs().character_count(&source)
            })
            .await
            {
                character_count.set(count);
            }
        }
    });
    use_resource(move || {
        let source = selected_source();
        async move {
            let Some(source) = source else { return };
            let requested_source = source.clone();
            if let Ok(count) = super::background::run(move || {
                ParserGateway::markdown_rs().character_count(&source)
            })
            .await
            {
                if selected_source.read().as_ref() == Some(&requested_source) {
                    selected_character_count.set(Some(count));
                }
            }
        }
    });
    let paper = current_document.layout.paper.clone();
    let margins = current_document.layout.margins.clone();

    rsx! {
        div { class: if active_tab() == RibbonTab::File { "word-shell file-mode" } else { "word-shell" },
            "data-page-furniture": serde_json::to_string(&current_document.layout.page_furniture).unwrap_or_default(),
            "data-page-layout": serde_json::to_string(&current_document.layout).unwrap_or_default(),
            ResizeHandles {}
            TitleBar {
                document_title: title_name.clone(),
                dirty: document() != saved_document(),
                save_status: status_hint(),
                on_rename: move |title| document.write().layout.document.title = title,
                on_save: move |_| handle_save_document(document, resources, current_location, status_hint, saved_document),
                on_command: move |command| {
                    if editor_mode() == EditorMode::Wysiwyg {
                        prosemirror_surface::run_command(command);
                    } else {
                        document_renderer::run_markdown_command(command);
                    }
                },
            }
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
                    on_reset_zoom: move |_| zoom.set(100),
                    on_editor_command: move |command| {
                        if command == "page_furniture" {
                            let _ = document::eval("const prepared = window.InfiniteWysiwygEditor?.prepareModeSwitch('infinite-prosemirror-host'); if (!prepared?.deferred) window.InfiniteMarkdownEditor?.openPageFurniture();");
                        } else if editor_mode() == EditorMode::Wysiwyg {
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
                        handle_save_document(document, resources, current_location, status_hint, saved_document);
                    },
                    on_save_as: move |target| {
                        handle_save_as_document(
                            document,
                            resources,
                            current_location,
                            status_hint,
                            Some(target),
                            saved_document,
                        );
                    },
                    on_export: move |target| {
                        handle_export_document(target, document, resources, status_hint);
                    },
                }
            } else {
                div { class: "document-workspace",
                super::outline::Outline { document, editor_mode: editor_mode() }
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
                        if let Some(settings) = change.page_furniture {
                            if settings.validate(&document.read().layout.margins).is_ok() {
                                document.write().layout.page_furniture = settings;
                            }
                        }
                        let should_refresh_wysiwyg = document.read().markdown != change.markdown && editor_mode() == EditorMode::Wysiwyg
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
                    on_page_status_change: move |payload: String| {
                        let Ok(next) = serde_json::from_str::<PageStatus>(&payload) else {
                            return;
                        };
                        let current = next.current.max(1).min(next.total.max(1));
                        let total = next.total.max(1);
                        let previous = page_status.read();
                        if previous.current != current || previous.total != total {
                            drop(previous);
                            page_status.set(PageStatus { current, total });
                        }
                    },
                    on_selection_status_change: move |payload: String| {
                        let Ok(status) = serde_json::from_str::<SelectionStatus>(&payload) else {
                            return;
                        };
                        selection_active.set(status.selected);
                        if !status.selected {
                            selected_source.set(None);
                            selected_character_count.set(None);
                        } else if let Some(count) = status.character_count {
                            selected_source.set(None);
                            selected_character_count.set(Some(count));
                        } else if let Some(source) = status.markdown {
                            selected_character_count.set(None);
                            selected_source.set(Some(source));
                        }
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
            }
            OpenConfigDialog {
                visible: open_dialog_visible(),
                path_input: open_path_input(),
                read_only_mode: open_read_only_mode(),
                auto_detect_encoding: open_auto_detect_encoding(),
                browse_pending: browse_pending(),
                open_pending: open_pending(),
                on_close: move |_| {
                    open_generation.with_mut(|value| *value = value.wrapping_add(1));
                    open_pending.set(false);
                    open_dialog_visible.set(false);
                },
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
                            open_pending,
                            open_generation,
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
                zoom,
                editor_mode: editor_mode(),
                markdown_preview_open: markdown_preview_open(),
                status_hint: status_hint(),
                current_file: Some(title_name),
                character_count: character_count(),
                selection_active: selection_active(),
                selected_character_count: selected_character_count(),
                current_page: page_status.read().current,
                total_pages: page_status.read().total,
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
