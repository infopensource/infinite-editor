#[cfg(feature = "desktop")]
use super::file_actions::{browse_document_dialog, browse_import_dialog};
use super::file_actions::{
    file_name_or, handle_export_document, handle_open_document_from_path, handle_save_as_document,
    handle_save_document, save_document_now, OpenDocumentState,
};
use super::file_backstage::{FileBackstage, NewDocumentDialog, OpenConfigDialog, WarningAlert};
use super::resize_handles::ResizeHandles;
use super::{
    document_renderer, prosemirror_surface, ribbon_groups, EditorSurface, RibbonTab, StatusBar,
    TabsRow, TitleBar,
};
use crate::document::{ProjectDocument, ResourceBundle};
use crate::engine::{EditorMode, ParserGateway};
use crate::storage::DocumentLocation;
use crate::theme::ThemeSettings;
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
    let mut document_revision = use_signal(|| 0u64);
    let mut editor_revision = use_signal(|| 0u64);
    #[allow(unused_mut)]
    let mut resources = use_signal(ResourceBundle::default);
    let mut show_ruler = use_signal(|| true);
    let mut current_location = use_signal(|| None::<DocumentLocation>);
    #[allow(unused_mut)]
    let mut status_hint = use_signal(|| "就绪".to_string());
    let mut new_dialog_visible = use_signal(|| false);
    let mut new_saving = use_signal(|| false);
    let mut new_save_feedback = use_signal(String::new);
    let mut new_request_pending = use_signal(|| false);
    let mut auto_save_enabled = use_signal(|| false);
    let mut auto_save_start_pending = use_signal(|| false);
    let mut auto_save_error = use_signal(|| None::<String>);
    let mut open_pending = use_signal(|| false);
    let mut import_pending = use_signal(|| false);
    let mut pending_import = use_signal(|| None::<ProjectDocument>);
    let mut open_generation = use_signal(|| 0u64);
    let mut open_dialog_visible = use_signal(|| false);
    let mut warning_alert = use_signal(|| None::<String>);
    let mut open_path_input = use_signal(String::new);
    let mut open_read_only_mode = use_signal(|| false);
    let mut open_auto_detect_encoding = use_signal(|| true);
    let mut dialog_style_b = use_signal(|| false);
    let mut theme = use_signal(ThemeSettings::default);
    use_effect(move || {
        spawn(async move {
            let script = "try { return localStorage.getItem('infinite-editor.dialog-style') === 'b'; } catch (_) { return false; }";
            #[cfg(feature = "desktop")]
            let loaded_style = match crate::settings::load() {
                Ok(Some(style)) => Ok(style),
                Ok(None) => {
                    let style = document::eval(script)
                        .join::<bool>()
                        .await
                        .unwrap_or(false);
                    crate::settings::save(style).map(|_| style)
                }
                Err(error) => Err(error),
            };
            #[cfg(not(feature = "desktop"))]
            let loaded_style = document::eval(script)
                .join::<bool>()
                .await
                .map_err(|error| error.to_string());
            if let Ok(style_b) = loaded_style.as_ref() {
                let style_b = *style_b;
                dialog_style_b.set(style_b);
                let _ = document::eval(if style_b {
                    "document.body.classList.add('dialog-style-b')"
                } else {
                    "document.body.classList.remove('dialog-style-b')"
                });
            } else if let Err(error) = loaded_style {
                status_hint.set(format!("读取设置失败：{error}"));
            }
        });
    });
    use_effect(move || {
        let dark = theme.read().mode == crate::theme::ThemeMode::Dark;
        let _ = document::eval(if dark {
            "document.body.classList.add('theme-dark')"
        } else {
            "document.body.classList.remove('theme-dark')"
        });
    });
    use_effect(move || {
        spawn(async move {
            #[cfg(feature = "desktop")]
            let loaded = crate::settings::load_theme().map(|stored| stored.unwrap_or_default());
            #[cfg(not(feature = "desktop"))]
            let loaded = document::eval("try { return localStorage.getItem('infinite-editor.theme') || ''; } catch (_) { return ''; }")
                .join::<String>().await
                .map_err(|error| error.to_string())
                .and_then(|stored| {
                    if stored.is_empty() { Ok(ThemeSettings::default()) }
                    else { serde_json::from_str::<ThemeSettings>(&stored).map_err(|error| error.to_string()) }
                });
            match loaded {
                Ok(settings) if ThemeSettings::valid_color(&settings.custom_color) => theme.set(settings),
                Ok(_) => status_hint.set("主题颜色配置无效，已使用默认主题".into()),
                Err(error) => status_hint.set(format!("读取主题设置失败：{error}")),
            }
        });
    });
    #[allow(unused_mut)]
    let mut browse_pending = use_signal(|| false);
    let document_dirty = use_memo(move || *document.read() != *saved_document.read());
    // Only the switch restarts this task. Editing does not postpone a tick.
    // Inspect borrowed values first; clone a snapshot only when a save is due.
    #[cfg(feature = "desktop")]
    use_resource(move || {
        let enabled = auto_save_enabled();
        async move {
            if !enabled {
                return;
            }
            let period = std::time::Duration::from_secs(30);
            let mut interval = tokio::time::interval_at(tokio::time::Instant::now() + period, period);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                if !*auto_save_enabled.peek() {
                    return;
                }
                if *open_pending.peek() || *import_pending.peek() || *new_dialog_visible.peek() || !*document_dirty.peek() {
                    continue;
                }
                let Some(location) = current_location.peek().clone() else { continue };
                let snapshot = document.peek().clone();
                match crate::storage::save_document(&location, &snapshot, &resources.peek()) {
                    Ok(()) => {
                        saved_document.set(snapshot);
                        auto_save_error.set(None);
                        status_hint.set(format!("已保存 {}", file_name_or(location.path(), "文档")));
                    }
                    Err(error) => {
                        status_hint.set(format!("自动保存失败：{error}"));
                        auto_save_error.set(Some(format!("自动保存失败：{error}。请检查后重新开启，或手动保存。")));
                        auto_save_enabled.set(false);
                        return;
                    }
                }
            }
        }
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

    let mut create_document = move || {
        pending_import.set(None);
        open_generation.with_mut(|value| *value = value.wrapping_add(1));
        open_pending.set(false);
        open_dialog_visible.set(false);
        open_path_input.set(String::new());
        warning_alert.set(None);
        let blank = ProjectDocument::new(String::new());
        document.set(blank.clone());
        saved_document.set(blank);
        resources.set(ResourceBundle::default());
        current_location.set(None);
        document_revision.with_mut(|value| *value = value.wrapping_add(1));
        editor_revision.set(0);
        selection_active.set(false);
        selected_source.set(None);
        selected_character_count.set(None);
        page_status.set(PageStatus { current: 1, total: 1 });
        auto_save_error.set(None);
        auto_save_enabled.set(false);
        new_dialog_visible.set(false);
        status_hint.set("已新建空白文档".into());
        active_tab.set(RibbonTab::Home);
    };

    let mut finish_import = move || {
        let Some(imported) = pending_import.write().take() else { return; };
        open_generation.with_mut(|value| *value = value.wrapping_add(1));
        document.set(imported);
        saved_document.set(ProjectDocument::new(String::new()));
        resources.set(ResourceBundle::default());
        current_location.set(None);
        document_revision.with_mut(|value| *value = value.wrapping_add(1));
        editor_revision.set(0);
        selection_active.set(false);
        selected_source.set(None);
        selected_character_count.set(None);
        page_status.set(PageStatus { current: 1, total: 1 });
        auto_save_error.set(None);
        auto_save_enabled.set(false);
        new_dialog_visible.set(false);
        status_hint.set("已导入，请另存为 .md 或 .infdoc".into());
        active_tab.set(RibbonTab::Home);
    };

    let theme_settings = theme();
    let mut shell_class = format!("word-shell {}", theme_settings.class());
    if active_tab() == RibbonTab::File { shell_class.push_str(" file-mode"); }
    if dialog_style_b() { shell_class.push_str(" dialog-style-b"); }
    rsx! {
        div { class: shell_class, style: theme_settings.style(),
            "data-page-furniture": serde_json::to_string(&current_document.layout.page_furniture).unwrap_or_default(),
            "data-page-layout": serde_json::to_string(&current_document.layout).unwrap_or_default(),
            ResizeHandles {}
            super::page_furniture_dialog::PageFurnitureDialogTemplate {}
            TitleBar {
                document_title: title_name.clone(),
                dirty: document_dirty(),
                save_status: status_hint(),
                auto_save_enabled: auto_save_enabled(),
                auto_save_start_pending: auto_save_start_pending(),
                auto_save_hint: auto_save_error().unwrap_or_else(|| {
                    if !cfg!(feature = "desktop") { "当前平台暂不支持自动保存到本地文件".into() }
                    else if auto_save_start_pending() { "正在保存文档；保存成功后开启自动保存".into() }
                    else if open_pending() { "正在打开文档，自动保存已暂停".into() }
                    else if auto_save_enabled() { "自动保存已开启：每 30 秒检查一次，仅保存未保存的修改".into() }
                    else { "自动保存已关闭：请使用保存按钮或 Ctrl+S 保存".into() }
                }),
                on_toggle_auto_save: move |_| {
                    if auto_save_start_pending() { return; }
                    auto_save_error.set(None);
                    if auto_save_enabled() {
                        auto_save_enabled.set(false);
                        return;
                    }
                    auto_save_start_pending.set(true);
                    let revision = document_revision();
                    spawn(async move {
                        let saved = save_document_now(document, resources, current_location, status_hint, saved_document).await;
                        auto_save_start_pending.set(false);
                        if saved && document_revision() == revision && current_location().is_some() {
                            auto_save_enabled.set(true);
                        }
                    });
                },
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
                    on_clipboard_action: move |action: String| {
                        if action == "paste" {
                            #[cfg(feature = "desktop")]
                            {
                                let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
                                if clipboard.wait_for_image().is_some() {
                                    let _ = document::eval("window.InfiniteToolbarClipboard?.pasteImage();");
                                } else if let Some(text) = clipboard.wait_for_text() {
                                    if let Ok(value) = serde_json::to_string(&text.as_str()) {
                                        let _ = document::eval(&format!("window.InfiniteToolbarClipboard?.insertText({value});"));
                                    }
                                } else {
                                    status_hint.set("剪贴板中没有可粘贴的文本".into());
                                }
                            }
                        }
                    },
                }
            }
            if active_tab() == RibbonTab::File {
                FileBackstage {
                    current_file: current_location().map(|location| location.path().display().to_string()),
                    status_hint: status_hint(),
                    has_location: current_location().is_some(),
                    dialog_style_b: dialog_style_b(),
                    theme: theme_settings.clone(),
                    on_dialog_style_change: move |style_b| {
                        #[cfg(feature = "desktop")]
                        if let Err(error) = crate::settings::save(style_b) {
                            status_hint.set(format!("保存设置失败：{error}"));
                            return;
                        }
                        dialog_style_b.set(style_b);
                        #[cfg(feature = "desktop")]
                        let script = if style_b {
                            "document.body.classList.add('dialog-style-b');"
                        } else {
                            "document.body.classList.remove('dialog-style-b');"
                        };
                        #[cfg(not(feature = "desktop"))]
                        let script = if style_b {
                            "try { localStorage.setItem('infinite-editor.dialog-style', 'b'); } catch (_) {} document.body.classList.add('dialog-style-b');"
                        } else {
                            "try { localStorage.setItem('infinite-editor.dialog-style', 'a'); } catch (_) {} document.body.classList.remove('dialog-style-b');"
                        };
                        let _ = document::eval(script);
                    },
                    on_theme_change: move |next: ThemeSettings| {
                        if next == theme() { return; }
                        #[cfg(feature = "desktop")]
                        if let Err(error) = crate::settings::save_theme(&next) {
                            status_hint.set(format!("保存主题设置失败：{error}"));
                            return;
                        }
                        #[cfg(not(feature = "desktop"))]
                        if let Ok(value) = serde_json::to_string(&next) {
                            if let Ok(literal) = serde_json::to_string(&value) {
                                let script = format!("try {{ localStorage.setItem('infinite-editor.theme', {literal}); }} catch (_) {{}}");
                                let _ = document::eval(&script);
                            }
                        }
                        theme.set(next);
                    },
                    on_back: move |_| active_tab.set(RibbonTab::Home),
                    on_new: move |_| {
                        if new_request_pending() || new_saving() || import_pending() { return; }
                        pending_import.set(None);
                        new_request_pending.set(true);
                        let revision = document_revision();
                        spawn(async move {
                            // The source controller survives leaving the File tab. Read its
                            // latest content before deciding whether unsaved work exists.
                            let script = format!("const snapshot = window.InfiniteMarkdownEditor?.getSnapshot(); return snapshot?.documentRevision === {revision} ? snapshot.markdown : null;");
                            let result = super::javascript::eval_reply::<Option<String>>(&script).await;
                            new_request_pending.set(false);
                            if document_revision() != revision { return; }
                            match result {
                                Ok(markdown) => {
                                    if let Some(markdown) = markdown { document.write().markdown = markdown; }
                                    if *document.peek() != *saved_document.peek() {
                                        new_save_feedback.set(String::new());
                                        new_dialog_visible.set(true);
                                    } else {
                                        create_document();
                                    }
                                }
                                Err(error) => status_hint.set(format!("同步文档失败：{error}")),
                            }
                        });
                    },
                    on_open: move |_| {
                        open_dialog_visible.set(true);
                        if let Some(location) = current_location() {
                            open_path_input.set(location.path().display().to_string());
                        }
                    },
                    on_import: move |_| {
                        #[cfg(feature = "desktop")]
                        {
                            if import_pending() || new_saving() || new_request_pending() { return; }
                            import_pending.set(true);
                            let revision = document_revision();
                            spawn(async move {
                                let Some(path) = browse_import_dialog().await else {
                                    import_pending.set(false);
                                    return;
                                };
                                status_hint.set("正在导入文档…".into());
                                let import_path = path.clone();
                                let converted = super::background::run(move || crate::import::import_document(&import_path))
                                    .await
                                    .and_then(|result| result);
                                if document_revision() != revision {
                                    import_pending.set(false);
                                    return;
                                }
                                match converted {
                                    Ok(imported) => {
                                        let script = format!("const snapshot = window.InfiniteMarkdownEditor?.getSnapshot(); return snapshot?.documentRevision === {revision} ? snapshot.markdown : null;");
                                        let snapshot = super::javascript::eval_reply::<Option<String>>(&script).await;
                                        import_pending.set(false);
                                        match snapshot {
                                            Ok(markdown) => {
                                                if document_revision() != revision { return; }
                                                if let Some(markdown) = markdown { document.write().markdown = markdown; }
                                                pending_import.set(Some(imported));
                                                if *document.peek() != *saved_document.peek() {
                                                    new_save_feedback.set(String::new());
                                                    new_dialog_visible.set(true);
                                                } else {
                                                    finish_import();
                                                }
                                            }
                                            Err(error) => status_hint.set(format!("同步文档失败：{error}")),
                                        }
                                    }
                                    Err(error) => {
                                        import_pending.set(false);
                                        status_hint.set(error);
                                    }
                                }
                            });
                        }
                        #[cfg(not(feature = "desktop"))]
                        status_hint.set("当前平台暂不支持系统文件对话框".into());
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
            NewDocumentDialog {
                visible: new_dialog_visible(),
                saving: new_saving(),
                status: new_save_feedback(),
                importing: pending_import().is_some(),
                on_cancel: move |_| {
                    pending_import.set(None);
                    new_dialog_visible.set(false);
                },
                on_discard: move |_| {
                    if pending_import().is_some() { finish_import(); } else { create_document(); }
                },
                on_save: move |_| {
                    if new_saving() { return; }
                    new_saving.set(true);
                    new_save_feedback.set(String::new());
                    let revision = document_revision();
                    spawn(async move {
                        let saved = save_document_now(document, resources, current_location, status_hint, saved_document).await;
                        new_saving.set(false);
                        if document_revision() != revision { return; }
                        if saved && *document.peek() == *saved_document.peek() {
                            if pending_import().is_some() { finish_import(); } else { create_document(); }
                        } else if saved {
                            new_save_feedback.set("保存期间文档有新修改，请再次保存或取消新建。".into());
                        } else {
                            new_save_feedback.set(status_hint.peek().clone());
                        }
                    });
                },
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
                            saved_document,
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
