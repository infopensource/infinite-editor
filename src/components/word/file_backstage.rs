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

    pub fn badge(self) -> &'static str {
        match self {
            ExportTarget::Markdown => "推荐",
            ExportTarget::Pdf => "高频",
            ExportTarget::Odt => "兼容",
            ExportTarget::Word => "兼容",
            ExportTarget::Png => "预览",
            ExportTarget::Jpeg => "预览",
        }
    }
}

#[component]
pub fn FileBackstage(
    current_file: Option<String>,
    status_hint: String,
    can_save: bool,
    on_open: EventHandler<()>,
    on_save: EventHandler<()>,
    on_save_as: EventHandler<()>,
    on_export: EventHandler<ExportTarget>,
) -> Element {
    let file_display = current_file.unwrap_or_else(|| "未命名文档".to_string());

    rsx! {
        main { class: "file-backstage",
            aside { class: "file-nav",
                h2 { class: "file-nav-title", "文件" }
                button { class: "file-nav-item active", "信息" }
                button { class: "file-nav-item", "最近" }
                button { class: "file-nav-item", "模板" }
                button { class: "file-nav-item", "账户" }
                button { class: "file-nav-item", "选项" }
            }

            section { class: "file-content",
                header { class: "file-hero",
                    div {
                        p { class: "file-eyebrow", "快速开始" }
                        h1 { "从这里开始管理你的文档" }
                        p { class: "file-subtitle", "建议先使用“打开文档”载入内容，再通过“另存为”建立项目副本。" }
                    }
                    div { class: "file-meta-card",
                        p { class: "meta-label", "当前工作文档" }
                        p { class: "meta-value", "{file_display}" }
                        p { class: "meta-status", "运行状态：{status_hint}" }
                    }
                }

                div { class: "file-actions-grid",
                    article { class: "action-panel primary",
                        h3 { "文档操作" }
                        p { "先完成打开与保存，再进入编辑视图，能减少误操作和覆盖风险。" }
                        div { class: "action-buttons",
                            button {
                                class: "backstage-btn strong",
                                onclick: move |_| on_open.call(()),
                                "打开文档"
                            }
                            button {
                                class: if can_save { "backstage-btn" } else { "backstage-btn muted" },
                                disabled: !can_save,
                                onclick: move |_| on_save.call(()),
                                "保存"
                            }
                            button {
                                class: "backstage-btn",
                                onclick: move |_| on_save_as.call(()),
                                "另存为"
                            }
                        }
                    }

                    article { class: "action-panel",
                        h3 { "导出" }
                        p { "根据目标场景选择格式：协作优先 Word/ODT，发布优先 PDF，预览优先图片。" }
                        div { class: "export-grid",
                            for target in [
                                ExportTarget::Markdown,
                                ExportTarget::Pdf,
                                ExportTarget::Odt,
                                ExportTarget::Word,
                                ExportTarget::Png,
                                ExportTarget::Jpeg,
                            ] {
                                button {
                                    class: "export-card",
                                    onclick: move |_| on_export.call(target),
                                    span { class: "export-title", "{target.label()}" }
                                    span { class: "export-badge", "{target.badge()}" }
                                }
                            }
                        }
                    }
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
