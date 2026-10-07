use dioxus::prelude::*;
use dioxus_primitives::dialog::{DialogContent, DialogRoot, DialogTitle};
use crate::theme::{ThemeMode, ThemePreset, ThemeSettings};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExportTarget {
    Markdown,
    Pdf,
    Odt,
    Word,
    Png,
    Jpeg,
    LongPng,
}

impl ExportTarget {
    pub fn label(self) -> &'static str {
        match self {
            ExportTarget::Markdown => "Markdown (.md)",
            ExportTarget::Pdf => "PDF 精确版式 (.pdf)",
            ExportTarget::Odt => "OpenDocument (.odt)",
            ExportTarget::Word => "Word (.docx)",
            ExportTarget::Png => "图片 PNG (.png)",
            ExportTarget::Jpeg => "图片 JPEG (.jpg)",
            ExportTarget::LongPng => "长图 PNG (.png)",
        }
    }

    pub fn short_label(self) -> &'static str {
        match self {
            ExportTarget::Markdown => "MD",
            ExportTarget::Pdf => "PDF",
            ExportTarget::Odt => "ODT",
            ExportTarget::Word => "DOCX",
            ExportTarget::Png => "PNG",
            ExportTarget::Jpeg => "JPG",
            ExportTarget::LongPng => "长图",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            ExportTarget::Markdown => "导出不包含布局信息的标准 Markdown 文件",
            ExportTarget::Pdf => "精确保留纸张、页眉页脚和分页；文字仍可选择",
            ExportTarget::Odt => "可编辑正文、原生页眉页脚与分页；尽量保持版式",
            ExportTarget::Word => "可编辑正文、原生页眉页脚与分页；尽量保持版式",
            ExportTarget::Png => "按 PDF 版式逐页导出无损图片",
            ExportTarget::Jpeg => "按 PDF 版式逐页导出较小的图片",
            ExportTarget::LongPng => "按 Seamless 连续布局导出一张长图",
        }
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
    Settings,
}

#[component]
pub fn FileBackstage(
    current_file: Option<String>,
    status_hint: String,
    export_pending: bool,
    has_location: bool,
    dialog_style_b: bool,
    theme: ThemeSettings,
    on_dialog_style_change: EventHandler<bool>,
    on_theme_change: EventHandler<ThemeSettings>,
    on_back: EventHandler<()>,
    on_new: EventHandler<()>,
    on_open: EventHandler<()>,
    on_import: EventHandler<()>,
    on_save: EventHandler<()>,
    on_save_as: EventHandler<SaveAsTarget>,
    on_export: EventHandler<ExportTarget>,
) -> Element {
    let mut section = use_signal(|| BackstageSection::Info);
    let mut preview_open = use_signal(|| false);
    let mut preview_style_b = use_signal(|| false);
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
                        id: "file-new",
                        class: "file-nav-item command",
                        onclick: move |_| on_new.call(()),
                        span { class: "file-nav-symbol", "＋" }
                        span { "新建" }
                    }
                    button {
                        class: "file-nav-item command",
                        onclick: move |_| on_open.call(()),
                        span { class: "file-nav-symbol", "↗" }
                        span { "打开" }
                    }
                    button {
                        id: "file-import",
                        class: "file-nav-item command",
                        title: "用 AnyDoc 将 Office、PDF 等文档转换为 Markdown",
                        onclick: move |_| on_import.call(()),
                        span { class: "file-nav-symbol", "⇥" }
                        span { "导入" }
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
                    div { class: "file-nav-divider" }
                    button {
                        id: "file-settings",
                        class: if section() == BackstageSection::Settings { "file-nav-item active" } else { "file-nav-item" },
                        onclick: move |_| section.set(BackstageSection::Settings),
                        span { class: "file-nav-symbol", "⚙" }
                        span { "设置" }
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
                                ExportTarget::LongPng,
                            ] {
                                button {
                                    class: "file-choice-row compact",
                                    disabled: export_pending,
                                    onclick: move |_| on_export.call(target),
                                    span { class: "file-type-mark small", "{target.short_label()}" }
                                    span { class: "file-choice-copy",
                                        strong { "{target.label()}" }
                                        span { "{target.description()}" }
                                    }
                                    span { class: "file-choice-action", if export_pending { "处理中" } else { "导出" } }
                                }
                            }
                        }
                    },
                    BackstageSection::Settings => rsx! {
                        header { class: "file-page-header",
                            h1 { "编辑器设置" }
                            p { "设置此设备上的界面偏好。" }
                        }
                        ThemeSettingsPanel { theme: theme.clone(), on_change: on_theme_change }
                        section { class: "file-settings-group",
                            h2 { "对话框样式" }
                            p { "用于保存确认、打开文档和其他编辑器对话框。选择后立即生效。" }
                            div { class: "dialog-style-choices", role: "radiogroup", aria_label: "对话框样式",
                                div { class: "dialog-style-choice-container",
                                button {
                                    id: "dialog-style-a",
                                    r#type: "button",
                                    role: "radio",
                                    aria_checked: !dialog_style_b,
                                    class: if dialog_style_b { "dialog-style-choice" } else { "dialog-style-choice selected" },
                                    onclick: move |_| on_dialog_style_change.call(false),
                                    span { class: "dialog-style-mini style-a", aria_hidden: "true",
                                        span { class: "dialog-style-mini-title" }
                                        span { class: "dialog-style-mini-line" }
                                        span { class: "dialog-style-mini-actions" }
                                    }
                                    strong { "A · 编辑器原生" }
                                    small { "紧凑、清晰" }
                                }
                                button {
                                    r#type: "button",
                                    class: "dialog-preview-trigger dialog-style-preview-trigger",
                                    aria_label: "预览编辑器原生风格",
                                    onclick: move |_| {
                                        preview_style_b.set(false);
                                        preview_open.set(true);
                                    },
                                    "预览"
                                }
                                }
                                div { class: "dialog-style-choice-container",
                                button {
                                    id: "dialog-style-b",
                                    r#type: "button",
                                    role: "radio",
                                    aria_checked: dialog_style_b,
                                    class: if dialog_style_b { "dialog-style-choice selected" } else { "dialog-style-choice" },
                                    onclick: move |_| on_dialog_style_change.call(true),
                                    span { class: "dialog-style-mini style-b", aria_hidden: "true",
                                        span { class: "dialog-style-mini-title" }
                                        span { class: "dialog-style-mini-line" }
                                        span { class: "dialog-style-mini-actions" }
                                    }
                                    strong { "B · 桌面办公" }
                                    small { "分区明确，延续 Word 风格" }
                                }
                                button {
                                    r#type: "button",
                                    class: "dialog-preview-trigger dialog-style-preview-trigger",
                                    aria_label: "预览桌面办公风格",
                                    onclick: move |_| {
                                        preview_style_b.set(true);
                                        preview_open.set(true);
                                    },
                                    "预览"
                                }
                                }
                            }
                            if preview_open() {
                                DialogStyleGallery {
                                    initial_style_b: preview_style_b(),
                                    on_close: move |_| preview_open.set(false),
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
fn ThemeSettingsPanel(theme: ThemeSettings, on_change: EventHandler<ThemeSettings>) -> Element {
    let color_theme = theme.clone();
    rsx! {
        section { class: "file-settings-group theme-settings-group",
            h2 { "外观主题" }
            p { "选择界面明暗和主色。修改后立即生效，并保存在此设备上。" }
            div { class: "theme-setting-label", "显示模式" }
            div { class: "theme-mode-choices", role: "radiogroup", aria_label: "显示模式",
                for mode in [ThemeMode::Light, ThemeMode::Dark] {
                    ThemeModeButton { mode, theme: theme.clone(), on_change }
                }
            }
            div { class: "theme-setting-label", "预设主题" }
            div { class: "theme-preset-choices", role: "radiogroup", aria_label: "预设主题",
                for preset in ThemePreset::PRESETS {
                    ThemePresetButton { preset, theme: theme.clone(), on_change }
                }
            }
            div { class: "theme-custom-row",
                label { class: "theme-color-label", r#for: "theme-custom-color", "自选主色" }
                input { id: "theme-custom-color", r#type: "color", value: theme.custom_color.clone(),
                    aria_label: "选择自定义主色",
                    oninput: move |event| {
                        let color = event.value();
                        if ThemeSettings::valid_color(&color) {
                            let mut next = color_theme.clone();
                            next.custom_color = color;
                            next.preset = ThemePreset::Custom;
                            on_change.call(next);
                        }
                    }
                }
                span { class: "theme-color-value", "{theme.custom_color}" }
                if theme.preset == ThemePreset::Custom { span { class: "theme-custom-active", "正在使用" } }
            }
            button { class: "theme-reset-button", r#type: "button",
                onclick: move |_| on_change.call(ThemeSettings::default()),
                "恢复默认（白色 · 亮色）"
            }
        }
    }
}

#[component]
fn ThemeModeButton(mode: ThemeMode, theme: ThemeSettings, on_change: EventHandler<ThemeSettings>) -> Element {
    rsx! {
        button { r#type: "button", role: "radio", aria_checked: theme.mode == mode,
            class: if theme.mode == mode { "theme-mode-choice selected" } else { "theme-mode-choice" },
            onclick: move |_| {
                let mut next = theme.clone();
                next.mode = mode;
                on_change.call(next);
            },
            if mode == ThemeMode::Light { "亮色" } else { "暗色" }
        }
    }
}

#[component]
fn ThemePresetButton(preset: ThemePreset, theme: ThemeSettings, on_change: EventHandler<ThemeSettings>) -> Element {
    rsx! {
        button { r#type: "button", role: "radio", aria_checked: theme.preset == preset,
            class: if theme.preset == preset { "theme-preset-choice selected" } else { "theme-preset-choice" },
            onclick: move |_| {
                let mut next = theme.clone();
                next.preset = preset;
                on_change.call(next);
            },
            span { class: "theme-preset-swatch", style: "--theme-swatch: {preset.color()}", aria_hidden: "true" }
            span { "{preset.label()}" }
        }
    }
}

#[component]
fn DialogStyleGallery(initial_style_b: bool, on_close: EventHandler<()>) -> Element {
    let mut style_b = use_signal(|| initial_style_b);
    let mut scene = use_signal(|| 0usize);
    let titles = [
        "保存对当前文档的更改吗？",
        "打开文档",
        "无法保存文档",
        "正在打开文档",
    ];
    rsx! {
        DialogRoot {
            open: true,
            on_open_change: move |open: bool| { if !open { on_close.call(()); } },
            class: "editor-progress-backdrop",
            DialogContent { class: "dialog-preview-gallery",
                header { class: "dialog-preview-heading",
                    DialogTitle { "对话框预览" }
                    button { r#type: "button", class: "dialog-preview-trigger",
                        onclick: move |_| on_close.call(()), "关闭"
                    }
                }
                div { class: "dialog-preview-controls", role: "group", aria_label: "预览风格",
                    for (desktop, label) in [(false, "A · 编辑器原生"), (true, "B · 桌面办公")] {
                        button { r#type: "button", aria_pressed: style_b() == desktop,
                            onclick: move |_| style_b.set(desktop), "{label}"
                        }
                    }
                }
                div { class: "dialog-preview-controls", role: "group", aria_label: "预览场景",
                    for (index, label) in ["保存确认", "打开文档", "操作失败", "处理中"].into_iter().enumerate() {
                        button { r#type: "button", aria_pressed: scene() == index,
                            onclick: move |_| scene.set(index), "{label}"
                        }
                    }
                }
                div { class: if style_b() { "dialog-preview-stage style-b" } else { "dialog-preview-stage" },
                    div { class: "dialog-preview-window", role: "img",
                        aria_label: format!("{}：{}，仅作外观展示", if style_b() { "桌面办公" } else { "编辑器原生" }, titles[scene()]),
                        div { class: "dialog-preview-example", aria_hidden: "true",
                            header { "{titles[scene()]}" }
                            div { class: "dialog-preview-body",
                                match scene() {
                                    0 => rsx! { p { "新建文档前，可以保存未命名文档中的修改。" } },
                                    1 => rsx! {
                                        span { class: "dialog-preview-label", "文件路径" }
                                        span { class: "dialog-preview-input", "/Documents/notes.md" }
                                        p { "☑ 自动检测编码　　☐ 只读" }
                                    },
                                    2 => rsx! {
                                        p { "保存位置不可用。请检查路径，或选择其他位置。" }
                                        p { class: "dialog-preview-error", "详细信息：无法写入目标文件" }
                                    },
                                    _ => rsx! {
                                        p { "正在读取 notes.md，请稍候。" }
                                        div { class: "dialog-preview-progress", span {} }
                                    },
                                }
                            }
                            footer {
                                if scene() == 0 {
                                    span { class: "dialog-preview-discard", "不保存" }
                                }
                                span { class: "dialog-preview-action",
                                    if scene() == 2 { "关闭" } else { "取消" }
                                }
                                if scene() != 3 {
                                    span { class: "dialog-preview-action primary",
                                        match scene() { 0 => "保存并新建", 1 => "打开", _ => "另存为" }
                                    }
                                }
                            }
                        }
                    }
                }
                p { class: "dialog-preview-hint", "仅预览外观，实际样式请在设置中选择。" }
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
    open_pending: bool,
    on_close: EventHandler<()>,
    on_path_input: EventHandler<String>,
    on_toggle_read_only: EventHandler<()>,
    on_toggle_auto_detect: EventHandler<()>,
    on_browse: EventHandler<()>,
    on_confirm: EventHandler<()>,
) -> Element {
    rsx! {
        DialogRoot {
            open: visible,
            on_open_change: move |open: bool| { if !open { on_close.call(()); } },
            class: "editor-progress-backdrop",
            DialogContent {
                class: "dialog-card",
                header { class: "dialog-header",
                    DialogTitle { class: "open-document-title", "打开文档" }
                    p { role: "status", if open_pending { "正在读取文档，请稍候…" } else { "先配置打开参数，再加载文件。" } }
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
                            disabled: browse_pending || open_pending,
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
                        disabled: open_pending,
                        onclick: move |_| on_confirm.call(()),
                        if open_pending { "正在打开…" } else { "打开" }
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

#[component]
pub fn NewDocumentDialog(
    visible: bool,
    saving: bool,
    status: String,
    importing: bool,
    on_cancel: EventHandler<()>,
    on_discard: EventHandler<()>,
    on_save: EventHandler<()>,
) -> Element {
    rsx! {
        DialogRoot {
            open: visible,
            on_open_change: move |open: bool| { if !open && !saving { on_cancel.call(()); } },
            class: "editor-progress-backdrop",
            DialogContent {
                id: "new-document-dialog",
                class: "dialog-card new-document-dialog",
                header { class: "dialog-header",
                    DialogTitle { class: "new-document-title", "保存对当前文档的更改吗？" }
                    p { if importing { "导入文件前，可以保存当前文档中的修改。" } else { "新建文档前，可以保存当前文档中的修改。" } }
                }
                if !status.is_empty() {
                    p { class: "new-document-feedback", role: "status", "{status}" }
                }
                footer { class: "dialog-footer",
                    button { id: "new-discard", class: "dialog-btn discard", disabled: saving, onclick: move |_| on_discard.call(()), "不保存" }
                    button { id: "new-cancel", class: "dialog-btn ghost", disabled: saving, onclick: move |_| on_cancel.call(()), "取消" }
                    button { id: "new-save", class: "dialog-btn primary", disabled: saving, onclick: move |_| on_save.call(()),
                        if saving { "正在保存…" } else if importing { "保存并导入" } else { "保存并新建" }
                    }
                }
            }
        }
    }
}
