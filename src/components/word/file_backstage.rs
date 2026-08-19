use dioxus::prelude::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExportTarget {
    Markdown,
    Pdf,
    Odt,
    Word,
    Png,
    Jpeg,
}

impl ExportTarget {
    pub fn label(self) -> &'static str {
        match self {
            ExportTarget::Markdown => "Markdown (.md)",
            ExportTarget::Pdf => "PDF (.pdf)",
            ExportTarget::Odt => "OpenDocument (.odt)",
            ExportTarget::Word => "Word (.docx)",
            ExportTarget::Png => "图片 PNG (.png)",
            ExportTarget::Jpeg => "图片 JPEG (.jpg)",
        }
    }

    pub fn short_label(self) -> &'static str {
        match self {
            ExportTarget::Markdown => "MD",
            ExportTarget::Pdf => "PDF",
            ExportTarget::Odt => "ODT",
            ExportTarget::Word => "DOC",
            ExportTarget::Png => "PNG",
            ExportTarget::Jpeg => "JPG",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            ExportTarget::Markdown => "导出不包含布局信息的标准 Markdown 文件",
            ExportTarget::Pdf => "保留纸张尺寸和排版的发布文档",
            ExportTarget::Odt => "用于 LibreOffice 等办公软件",
            ExportTarget::Word => "用于 Microsoft Word 等办公软件",
            ExportTarget::Png => "逐页导出为无损图片",
            ExportTarget::Jpeg => "逐页导出为较小的有损图片",
        }
    }

    pub fn availability_label(self) -> &'static str {
        if self.available() {
            "导出"
        } else {
            "尚未接入"
        }
    }

    pub fn available(self) -> bool {
        matches!(self, ExportTarget::Markdown | ExportTarget::Pdf)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SaveAsTarget {
    MarkdownProject,
    InfiniteDocument,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BackstageSection {
    Info,
    SaveAs,
    Export,
}

#[component]
pub fn FileBackstage(
    current_file: Option<String>,
    status_hint: String,
    has_location: bool,
    on_back: EventHandler<()>,
    on_open: EventHandler<()>,
    on_save: EventHandler<()>,
    on_save_as: EventHandler<SaveAsTarget>,
    on_export: EventHandler<ExportTarget>,
) -> Element {
    let mut section = use_signal(|| BackstageSection::Info);
    let file_display = current_file
        .as_deref()
        .and_then(|path| std::path::Path::new(path).file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("未命名文档")
        .to_string();
    let file_path = current_file.unwrap_or_else(|| "尚未选择保存位置".to_string());
    let file_kind = if file_path.to_ascii_lowercase().ends_with(".infdoc") {
        "INFDOC"
    } else {
        "MD"
    };

    rsx! {
        main { class: "file-backstage",
            aside { class: "file-nav",
                button {
                    class: "file-back-button",
                    onclick: move |_| on_back.call(()),
                    span { class: "file-back-icon", "←" }
                    span { "返回" }
                }
                h1 { class: "file-nav-title", "文件" }
                nav { class: "file-nav-actions",
                    button {
                        class: if section() == BackstageSection::Info { "file-nav-item active" } else { "file-nav-item" },
                        onclick: move |_| section.set(BackstageSection::Info),
                        span { class: "file-nav-symbol", "i" }
                        span { "信息" }
                    }
                    button {
                        class: "file-nav-item command",
                        onclick: move |_| on_open.call(()),
                        span { class: "file-nav-symbol", "↗" }
                        span { "打开" }
                    }
                    button {
                        class: "file-nav-item command",
                        onclick: move |_| on_save.call(()),
                        span { class: "file-nav-symbol", "✓" }
                        span { "保存" }
                    }
                    div { class: "file-nav-divider" }
                    button {
                        class: if section() == BackstageSection::SaveAs { "file-nav-item active" } else { "file-nav-item" },
                        onclick: move |_| section.set(BackstageSection::SaveAs),
                        span { class: "file-nav-symbol", "＋" }
                        span { "另存为" }
                    }
                    button {
                        class: if section() == BackstageSection::Export { "file-nav-item active" } else { "file-nav-item" },
                        onclick: move |_| section.set(BackstageSection::Export),
                        span { class: "file-nav-symbol", "⇱" }
                        span { "导出" }
                    }
                }
            }

            section { class: "file-content",
                match section() {
                    BackstageSection::Info => rsx! {
                        header { class: "file-page-header",
                            h1 { "文档信息" }
                            p { "查看当前文档的位置和保存状态。" }
                        }
                        article { class: "document-summary",
                            div { class: "document-file-mark", "{file_kind}" }
                            div { class: "document-summary-main",
                                p { class: "document-summary-label", if has_location { "当前文档" } else { "新建文档" } }
                                h2 { "{file_display}" }
                                p { class: "document-summary-path", title: file_path.clone(), "{file_path}" }
                            }
                            span { class: if has_location { "document-state saved" } else { "document-state unsaved" },
                                if has_location { "已有保存位置" } else { "尚未保存" }
                            }
                        }
                        section { class: "file-details",
                            h2 { "状态" }
                            dl {
                                div {
                                    dt { "最近操作" }
                                    dd { "{status_hint}" }
                                }
                                div {
                                    dt { "存储方式" }
                                    dd {
                                        if file_kind == "INFDOC" {
                                            "便携文档包"
                                        } else if has_location {
                                            "Markdown 与同名布局文件"
                                        } else {
                                            "保存时选择"
                                        }
                                    }
                                }
                            }
                        }
                        div { class: "file-inline-actions",
                            button { class: "file-action-button primary", onclick: move |_| on_save.call(()),
                                if has_location { "保存修改" } else { "保存文档" }
                            }
                            button { class: "file-action-button", onclick: move |_| section.set(BackstageSection::SaveAs),
                                "保存副本"
                            }
                        }
                    },
                    BackstageSection::SaveAs => rsx! {
                        header { class: "file-page-header",
                            h1 { "另存为" }
                            p { "选择便于继续编辑的开放项目，或适合传输的单文件文档包。" }
                        }
                        div { class: "file-choice-list",
                            button { class: "file-choice-row", onclick: move |_| on_save_as.call(SaveAsTarget::MarkdownProject),
                                span { class: "file-type-mark", "MD" }
                                span { class: "file-choice-copy",
                                    strong { "Markdown 项目" }
                                    span { "标准 Markdown 源文件和独立 TOML 布局文件" }
                                    code { ".md  +  .layout.toml  +  .assets/" }
                                }
                                span { class: "file-choice-action", "保存" }
                            }
                            button { class: "file-choice-row", onclick: move |_| on_save_as.call(SaveAsTarget::InfiniteDocument),
                                span { class: "file-type-mark infdoc", "INF" }
                                span { class: "file-choice-copy",
                                    strong { "Infinite Document" }
                                    span { "将正文、布局和资源打包为一个便携文件" }
                                    code { ".infdoc" }
                                }
                                span { class: "file-choice-action", "保存" }
                            }
                        }
                        aside { class: "file-help",
                            strong { "如何选择？" }
                            p { "需要 Git 管理或用其他编辑器打开时选择 Markdown 项目；需要发送、归档或跨设备移动时选择 Infinite Document。" }
                        }
                    },
                    BackstageSection::Export => rsx! {
                        header { class: "file-page-header",
                            h1 { "导出" }
                            p { "生成用于发布或交换的副本，不改变当前编辑文档。" }
                        }
                        div { class: "file-choice-list export-list",
                            for target in [
                                ExportTarget::Markdown,
                                ExportTarget::Pdf,
                                ExportTarget::Word,
                                ExportTarget::Odt,
                                ExportTarget::Png,
                                ExportTarget::Jpeg,
                            ] {
                                button {
                                    class: if target.available() { "file-choice-row compact" } else { "file-choice-row compact unavailable" },
                                    disabled: !target.available(),
                                    onclick: move |_| on_export.call(target),
                                    span { class: "file-type-mark small", "{target.short_label()}" }
                                    span { class: "file-choice-copy",
                                        strong { "{target.label()}" }
                                        span { "{target.description()}" }
                                    }
                                    span { class: "file-choice-action", "{target.availability_label()}" }
                                }
                            }
                        }
                    },
                }
            }
        }
    }
}

#[component]
pub fn OpenConfigDialog(
    visible: bool,
    path_input: String,
    read_only_mode: bool,
    auto_detect_encoding: bool,
    browse_pending: bool,
    on_close: EventHandler<()>,
    on_path_input: EventHandler<String>,
    on_toggle_read_only: EventHandler<()>,
    on_toggle_auto_detect: EventHandler<()>,
    on_browse: EventHandler<()>,
    on_confirm: EventHandler<()>,
) -> Element {
    if !visible {
        return rsx! {};
    }

    rsx! {
        div {
            class: "dialog-overlay",
            onclick: move |_| on_close.call(()),
            div {
                class: "dialog-card",
                onclick: move |evt| evt.stop_propagation(),
                header { class: "dialog-header",
                    h3 { "打开文档" }
                    p { "先配置打开参数，再加载文件。" }
                }
                div { class: "dialog-body",
                    label { class: "dialog-label", "文件路径" }
                    div { class: "dialog-path-row",
                        input {
                            class: "dialog-input",
                            r#type: "text",
                            value: path_input,
                            placeholder: "输入绝对路径或点击右侧浏览",
                            oninput: move |evt| on_path_input.call(evt.value()),
                        }
                        button {
                            class: "dialog-browse-btn",
                            disabled: browse_pending,
                            onclick: move |_| on_browse.call(()),
                            if browse_pending { "浏览中" } else { "..." }
                        }
                    }

                    div { class: "dialog-options",
                        button {
                            class: if read_only_mode { "dialog-option active" } else { "dialog-option" },
                            onclick: move |_| on_toggle_read_only.call(()),
                            if read_only_mode {
                                "只读预览：开"
                            } else {
                                "只读预览：关"
                            }
                        }
                        button {
                            class: if auto_detect_encoding { "dialog-option active" } else { "dialog-option" },
                            onclick: move |_| on_toggle_auto_detect.call(()),
                            if auto_detect_encoding {
                                "自动识别编码：开"
                            } else {
                                "自动识别编码：关"
                            }
                        }
                    }
                }
                footer { class: "dialog-footer",
                    button {
                        class: "dialog-btn ghost",
                        onclick: move |_| on_close.call(()),
                        "取消"
                    }
                    button {
                        class: "dialog-btn primary",
                        onclick: move |_| on_confirm.call(()),
                        "打开"
                    }
                }
            }
        }
    }
}

#[component]
pub fn WarningAlert(message: Option<String>, on_close: EventHandler<()>) -> Element {
    let Some(message) = message else {
        return rsx! {};
    };

    rsx! {
        div {
            class: "dialog-overlay",
            role: "presentation",
            onclick: move |_| on_close.call(()),
            div {
                class: "dialog-card warning-alert",
                role: "alertdialog",
                aria_modal: "true",
                aria_labelledby: "layout-warning-title",
                aria_describedby: "layout-warning-message",
                onclick: move |evt| evt.stop_propagation(),
                header { class: "dialog-header",
                    h3 { id: "layout-warning-title", "布局版本提示" }
                    p {
                        id: "layout-warning-message",
                        "{message}"
                    }
                }
                footer { class: "dialog-footer",
                    button {
                        class: "dialog-btn primary",
                        autofocus: true,
                        onclick: move |_| on_close.call(()),
                        "知道了"
                    }
                }
            }
        }
    }
}
