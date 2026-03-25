use dioxus::prelude::*;

use super::document_layout::{
    page_layout_px, paginate_blocks, resolved_paper_size, DocumentBlock, PaperMode, MM_TO_PX,
};

fn sample_document_blocks() -> Vec<DocumentBlock> {
    let mut blocks = vec![
        DocumentBlock::Heading1("项目计划书".to_string()),
        DocumentBlock::Paragraph(
            "这是一个基于 Dioxus 0.7 构建的 Word Ribbon 风格编辑器界面示例。".to_string(),
        ),
        DocumentBlock::Paragraph(
            "界面重点还原了：标题栏、选项卡、功能区、文档纸张以及底部状态栏。".to_string(),
        ),
        DocumentBlock::Paragraph(
            "该版本专注于 UI 结构与可维护性，便于后续接入真实 Markdown/富文本引擎。"
                .to_string(),
        ),
    ];

    for section in 1..=30 {
        blocks.push(DocumentBlock::Heading2(format!("章节 {section}")));
        blocks.push(DocumentBlock::Paragraph(
            "这里是示例段落，用于验证文档区分页与独立滚动行为。滚动时顶部 Ribbon 与底部状态栏保持固定，只有文档内容区域上下移动。".to_string(),
        ));
        blocks.push(DocumentBlock::Paragraph(
            "后续可以把这部分替换成真实文档模型渲染结果，例如按段落、标题、列表和图片块分块，再通过统一布局管线分页，为 PDF 导出复用相同分页结果。".to_string(),
        ));
    }

    blocks
}

fn render_block(block: &DocumentBlock) -> Element {
    match block {
        DocumentBlock::Heading1(text) => rsx! {
            h1 { "{text}" }
        },
        DocumentBlock::Heading2(text) => rsx! {
            h2 { "{text}" }
        },
        DocumentBlock::Paragraph(text) => rsx! {
            p { "{text}" }
        },
    }
}

#[component]
pub fn EditorSurface(
    paper_mode: PaperMode,
    custom_width_mm: u16,
    custom_height_mm: u16,
    show_ruler: bool,
) -> Element {
    let mut left_slider = use_signal(|| 10u16);
    let mut right_slider = use_signal(|| 90u16);

    let blocks = sample_document_blocks();
    let paper_size = resolved_paper_size(paper_mode, custom_width_mm, custom_height_mm);

    let (ruler_major_count, page_style, pages, seamless) = if let Some(size) = paper_size {
        let layout = page_layout_px(size);
        let marks = (size.width / 10.0).floor().clamp(10.0, 120.0) as usize;
        let style = format!(
            "--page-width: {:.2}px; --page-height: {:.2}px; --page-padding-x: {:.2}px; --page-padding-y: {:.2}px; --ruler-major-step: {:.2}px;",
            layout.page_width,
            layout.page_height,
            layout.padding_x,
            layout.padding_y,
            10.0 * MM_TO_PX
        );
        let paged_blocks = paginate_blocks(&blocks, layout.content_height, layout.content_width);

        (marks, style, paged_blocks, false)
    } else {
        let style = format!(
            "--page-width: min(1120px, 94vw); --page-height: auto; --page-padding-x: 88px; --page-padding-y: 72px; --ruler-major-step: {:.2}px;",
            10.0 * MM_TO_PX
        );
        (30usize, style, vec![blocks], true)
    };

    let ruler_minor_count = ruler_major_count * 10;

    rsx! {
        main { class: "editor-surface",
            if show_ruler {
                div { class: "page-ruler-sticky",
                    div { class: "page-ruler", style: page_style.clone(),
                        div { class: "ruler-track",
                            for index in 0..=ruler_minor_count {
                                if index % 10 != 0 {
                                    span {
                                        class: if index % 5 == 0 { "ruler-tick mid" } else { "ruler-tick minor" },
                                        style: format!("left: {:.6}%;", index as f32 * 100.0 / ruler_minor_count as f32),
                                    }
                                }
                            }
                            for index in 0..=ruler_major_count {
                                span {
                                    class: "ruler-tick major",
                                    style: format!("left: {:.6}%;", index as f32 * 100.0 / ruler_major_count as f32),
                                }
                                span {
                                    class: if index == 0 { "ruler-mark origin" } else { "ruler-mark" },
                                    style: format!("left: {:.6}%;", index as f32 * 100.0 / ruler_major_count as f32),
                                    "{index}"
                                }
                            }
                            input {
                                class: "ruler-slider left",
                                r#type: "range",
                                min: 0,
                                max: 100,
                                step: 1,
                                value: "{left_slider}",
                                oninput: move |evt| {
                                    if let Ok(next) = evt.value().parse::<u16>() {
                                        let capped = next.min(right_slider().saturating_sub(1));
                                        left_slider.set(capped);
                                    }
                                },
                            }
                            input {
                                class: "ruler-slider right",
                                r#type: "range",
                                min: 0,
                                max: 100,
                                step: 1,
                                value: "{right_slider}",
                                oninput: move |evt| {
                                    if let Ok(next) = evt.value().parse::<u16>() {
                                        let capped = next.max(left_slider() + 1).min(100);
                                        right_slider.set(capped);
                                    }
                                },
                            }
                        }
                    }
                }
            }

            div { class: if seamless { "document-flow seamless" } else { "document-flow paged" },
                for page_blocks in pages.iter() {
                    article {
                        class: if seamless { "document-page seamless-page" } else { "document-page paged-page" },
                        style: page_style.clone(),
                        for block in page_blocks {
                            {render_block(block)}
                        }
                    }
                }
            }
        }
    }
}
