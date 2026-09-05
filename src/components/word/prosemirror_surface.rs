use crate::document::{ProjectDocument, ResourceBundle};
use crate::engine::ParserGateway;
use dioxus::prelude::*;

use super::document_renderer::{embedded_font_css, escape_css_string};
use super::MARKDOWN_DOCUMENT_BRIDGE_ID;

pub(super) const PROSEMIRROR_HOST_ID: &str = "infinite-prosemirror-host";

pub(super) fn run_command(command: String) {
    let command = serde_json::to_string(&command).unwrap_or_else(|_| "\"\"".to_string());
    let script =
        format!("window.InfiniteWysiwygEditor?.command('{PROSEMIRROR_HOST_ID}', {command});");
    let _ = document::eval(&script);
}

pub(super) fn set_document(
    markdown: String,
    document_revision: u64,
    edit_revision: u64,
    selection: Option<(usize, usize)>,
) {
    let Ok(ast) = ParserGateway::markdown_rs().parse_infinite_ast(&markdown) else {
        return;
    };
    let selection =
        selection.map(|(anchor, head)| serde_json::json!({ "anchor": anchor, "head": head }));
    let update = serde_json::json!({
        "ast": ast,
        "markdown": markdown,
        "documentRevision": document_revision,
        "editRevision": edit_revision,
        "selection": selection,
    });
    let update = serde_json::to_string(&update).unwrap_or_else(|_| "{}".to_string());
    let script =
        format!("window.InfiniteWysiwygEditor?.setDocument('{PROSEMIRROR_HOST_ID}', {update});");
    let _ = document::eval(&script);
}

fn mount_editor(
    markdown: String,
    resources: ResourceBundle,
    document_revision: u64,
    edit_revision: u64,
    mut error: Signal<Option<String>>,
) {
    spawn(async move {
        let ast = match ParserGateway::markdown_rs().parse_infinite_ast(&markdown) {
            Ok(ast) => ast,
            Err(parse_error) => {
                error.set(Some(format!("Markdown 解析失败：{}", parse_error.message)));
                return;
            }
        };
        let config = serde_json::json!({
            "host_id": PROSEMIRROR_HOST_ID,
            "bridge_id": MARKDOWN_DOCUMENT_BRIDGE_ID,
            "ast": ast,
            "markdown": markdown,
            "resources": resources.entries(),
            "document_revision": document_revision,
            "edit_revision": edit_revision,
        });
        let config = serde_json::to_string(&config).unwrap_or_else(|_| "{}".to_string());
        let script = format!(
            r#"
                const mount = () => {{
                    return window.InfiniteWysiwygEditor.mount({config});
                }};
                if (window.InfiniteWysiwygEditor) return JSON.stringify(mount());
                return await new Promise((resolve) => {{
                    const ready = () => {{
                        clearTimeout(timeout);
                        resolve(JSON.stringify(mount()));
                    }};
                    const timeout = setTimeout(() => {{
                        window.removeEventListener('infinite-wysiwyg-editor-ready', ready);
                        resolve(JSON.stringify({{ ok: false, error: 'WYSIWYG 内核在 5 秒内未就绪' }}));
                    }}, 5000);
                    window.addEventListener('infinite-wysiwyg-editor-ready', ready, {{ once: true }});
                }});
            "#,
        );
        let result = document::eval(&script).join::<String>().await;
        match result
            .map_err(|eval_error| eval_error.to_string())
            .and_then(|json| {
                serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())
            }) {
            Ok(value) if value.get("ok").and_then(serde_json::Value::as_bool) == Some(true) => {
                error.set(None);
            }
            Ok(value) => error.set(Some(
                value
                    .get("error")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("WYSIWYG 初始化失败")
                    .to_string(),
            )),
            Err(message) => error.set(Some(format!("WYSIWYG 通信失败：{message}"))),
        }
    });
}

#[component]
pub(super) fn ProseMirrorSurface(
    document: ReadSignal<ProjectDocument>,
    resources: ReadSignal<ResourceBundle>,
    document_revision: ReadSignal<u64>,
    editor_revision: ReadSignal<u64>,
    page_style: String,
    seamless: bool,
) -> Element {
    let error = use_signal(|| None::<String>);
    let mut synchronized_document = use_signal(|| None::<u64>);
    let current = document.read();
    let markdown = current.markdown.clone();
    let typography = current.layout.typography.clone();
    let font_css = embedded_font_css(&current.layout, &resources.read());
    drop(current);
    let surface_style = format!(
        "{page_style} --document-font-family: \"{}\"; --document-font-size: {:.3}pt; --document-line-height: {:.3}; --document-paragraph-spacing: {:.3}pt;",
        escape_css_string(&typography.body_font),
        typography.body_font_size_pt,
        typography.line_height,
        typography.paragraph_spacing_pt,
    );

    use_effect(move || {
        let revision = document_revision();
        if synchronized_document() == Some(revision) {
            return;
        }
        synchronized_document.set(Some(revision));
        set_document(
            document.read().markdown.clone(),
            revision,
            editor_revision(),
            None,
        );
    });

    use_effect(move || {
        let resources_json =
            serde_json::to_string(resources.read().entries()).unwrap_or_else(|_| "{}".to_string());
        let script = format!(
            "window.InfiniteWysiwygEditor?.setResources('{PROSEMIRROR_HOST_ID}', {resources_json});"
        );
        let _ = document::eval(&script);
    });

    use_drop(|| {
        let _ = document::eval(&format!(
            "window.InfiniteWysiwygEditor?.destroy('{PROSEMIRROR_HOST_ID}');"
        ));
    });

    rsx! {
        section {
            class: if seamless { "infinite-pm-surface seamless" } else { "infinite-pm-surface paged" },
            style: surface_style,
            if !font_css.is_empty() {
                style { "{font_css}" }
            }
            article {
                class: if seamless { "document-page seamless-page infinite-pm-page" } else { "document-page infinite-pm-page" },
                div {
                    id: PROSEMIRROR_HOST_ID,
                    class: "document-page-content infinite-pm-host",
                    onmounted: move |_| mount_editor(
                        markdown.clone(),
                        resources.read().clone(),
                        document_revision(),
                        editor_revision(),
                        error,
                    ),
                }
                if let Some(message) = error() {
                    div { class: "infinite-pm-error", "{message}" }
                }
            }
        }
    }
}
