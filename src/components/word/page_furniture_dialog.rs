use dioxus::prelude::*;

/// Dioxus owns the settings markup. The browser controller clones this inert
/// template for each editing session, so preview, IME and history retain their
/// synchronous lifecycle without mutating a Dioxus-owned subtree. Templates have
/// no IDs; the controller assigns dialog/tab IDs only to the live instance.
#[component]
pub fn PageFurnitureDialogTemplate() -> Element {
    rsx! {
        div { id: "page-furniture-dialog-template", hidden: true,
            dialog { class: "page-furniture-dialog",
                header { class: "page-furniture-heading",
                    h2 { "页眉页脚" }
                    button { class: "page-furniture-close", r#type: "button", aria_label: "关闭页眉页脚设置", "×" }
                }
                form { class: "page-furniture-form", novalidate: true,
                    div { class: "page-furniture-tabs", role: "tablist", aria_label: "编辑区域",
                        for (kind, title) in [("header", "页眉"), ("footer", "页脚")] {
                            button { class: "page-furniture-tab", r#type: "button", role: "tab", "data-region": kind, "{title}" }
                        }
                    }
                    div { class: "page-furniture-scroll",
                        div { class: "page-furniture-panels",
                            for (kind, title) in [("header", "页眉"), ("footer", "页脚")] {
                                RegionPanel { kind, title }
                            }
                        }
                        section { class: "page-furniture-preview-section",
                            div { class: "page-furniture-preview-label" }
                            div { class: "page-furniture-preview-frame",
                                div { class: "page-furniture-preview" }
                                span { class: "page-furniture-placeholder" }
                            }
                        }
                    }
                    footer { class: "page-furniture-actions",
                        p { class: "page-furniture-error", role: "status" }
                        div { class: "page-furniture-buttons",
                            button { class: "page-furniture-cancel", r#type: "button", "取消" }
                            button { class: "page-furniture-apply", r#type: "submit", "应用" }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn Field(
    title: String,
    name: String,
    field: String,
    input_type: String,
    #[props(default = "6".into())] min: String,
    #[props(default = "36".into())] max: String,
    #[props(default = "0.5".into())] step: String,
) -> Element {
    let checkbox = input_type == "checkbox";
    let number = input_type == "number";
    rsx! {
        label { class: if checkbox { "page-furniture-check" } else { "page-furniture-control" },
            if !checkbox { span { "{name}" } }
            input {
                r#type: input_type, aria_label: "{title}{name}", "data-field": field,
                min: if number { min }, max: if number { max }, step: if number { step }, required: number,
            }
            if checkbox { span { "{name}" } }
        }
    }
}

#[component]
fn RegionPanel(kind: String, title: String) -> Element {
    rsx! {
        section { class: "page-furniture-panel", role: "tabpanel", "data-region": kind,
            div { class: "page-furniture-ribbon",
                section { class: "page-furniture-group page-furniture-visibility",
                    h3 { "显示" }
                    Field { title: title.clone(), name: "启用", field: "enabled", input_type: "checkbox" }
                    Field { title: title.clone(), name: "首页隐藏", field: "hide_first_page", input_type: "checkbox" }
                }
                section { class: "page-furniture-group page-furniture-typography",
                    h3 { "字体与线条" }
                    Field { title: title.clone(), name: "字体", field: "font_family", input_type: "text" }
                    Field { title: title.clone(), name: "字号 (pt)", field: "font_size_pt", input_type: "number" }
                    Field { title: title.clone(), name: "颜色", field: "color", input_type: "color" }
                    Field { title: title.clone(), name: "分隔线", field: "separator", input_type: "checkbox" }
                }
                section { class: "page-furniture-group page-furniture-spacing",
                    h3 { "留白与间距 · mm" }
                    for (field, name) in [("margin_top_mm", "上留白"), ("margin_bottom_mm", "下留白"), ("margin_left_mm", "左缩进"), ("margin_right_mm", "右缩进"), ("column_gap_mm", "栏间距")] {
                        Field { title: title.clone(), name, field, input_type: "number", min: "0", max: "100" }
                    }
                }
            }
            p { class: "page-furniture-spacing-hint", "上下留白位于对应页边距内；左右缩进以正文边缘为基准。" }
            details { class: "page-furniture-padding",
                summary { "内容与分隔线的内边距 · mm" }
                div { class: "page-furniture-padding-controls",
                    for (field, name) in [("padding_top_mm", "上内边距"), ("padding_bottom_mm", "下内边距"), ("padding_left_mm", "左内边距"), ("padding_right_mm", "右内边距")] {
                        Field { title: title.clone(), name, field, input_type: "number", min: "0", max: "100" }
                    }
                }
                p { "页眉内容靠下方分隔线，页脚内容靠上方分隔线；内边距不会改变线的位置。" }
            }
            section { class: "page-furniture-content",
                div { class: "page-furniture-content-heading",
                    h3 { "内容" }
                    span { "{{page}} 页码 · {{pages}} 总页数" }
                }
                div { class: "page-furniture-slots",
                    for (slot, label) in [("left", "左侧"), ("center", "中间"), ("right", "右侧")] {
                        SlotEditor { title: title.clone(), slot, label }
                    }
                }
            }
        }
    }
}

#[component]
fn SlotEditor(title: String, slot: String, label: String) -> Element {
    rsx! {
        div { class: "page-furniture-slot", "data-slot": slot,
            Field { title: title.clone(), name: label.clone(), field: "text", input_type: "text" }
            div { class: "page-furniture-image-controls",
                img { class: "page-furniture-image-thumbnail" }
                button { class: "page-furniture-image-button", r#type: "button", aria_label: "{title}{label}插入图片", "插入图片" }
                button { class: "page-furniture-image-remove", r#type: "button", aria_label: "{title}{label}移除图片", "移除" }
                input { r#type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true, aria_label: "{title}{label}图片文件" }
            }
            div { class: "page-furniture-image-sizing",
                for (caption, action) in [("−", "缩小"), ("+", "放大"), ("适应栏位", "适应栏位")] {
                    button { r#type: "button", "data-action": action, aria_label: "{title}{label}图片{action}", "{caption}" }
                }
            }
            div { class: "page-furniture-image-dimensions",
                Field { title: title.clone(), name: format!("{label}图片宽 (mm)"), field: "width_mm", input_type: "number", min: "0.1", max: "100", step: "0.1" }
                Field { title: title.clone(), name: format!("{label}图片高 (mm)"), field: "height_mm", input_type: "number", min: "0.1", max: "100", step: "0.1" }
            }
        }
    }
}
