#![allow(dead_code)]

#[cfg(test)]
use crate::config::{
    DEFAULT_PAGE_MARGIN_LEFT_MM, DEFAULT_PAGE_MARGIN_RIGHT_MM, DEFAULT_PAGE_MARGIN_VERTICAL_MM,
};
use crate::config::{MAX_CUSTOM_PAPER_MM, MIN_CUSTOM_PAPER_MM};
use crate::document::{Orientation, PageMargins, PaperMode};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PaperSizeMm {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageLayoutPx {
    pub page_width: f32,
    pub page_height: f32,
    pub content_width: f32,
    pub content_height: f32,
    pub padding_left: f32,
    pub padding_right: f32,
    pub padding_top: f32,
    pub padding_bottom: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DocumentBlock {
    Heading1(String),
    Heading2(String),
    Paragraph(String),
}

pub const MM_TO_PX: f32 = 96.0 / 25.4;

pub fn ruler_position_percent(position_mm: u16, paper_width_mm: u16) -> f32 {
    if paper_width_mm == 0 {
        return 0.0;
    }

    position_mm.min(paper_width_mm) as f32 * 100.0 / paper_width_mm as f32
}

pub fn resolved_paper_size(
    mode: PaperMode,
    custom_width_mm: f32,
    custom_height_mm: f32,
    orientation: Orientation,
) -> Option<PaperSizeMm> {
    let size = match mode {
        PaperMode::Seamless => None,
        PaperMode::A4 => Some(PaperSizeMm {
            width: 210.0,
            height: 297.0,
        }),
        PaperMode::A5 => Some(PaperSizeMm {
            width: 148.0,
            height: 210.0,
        }),
        PaperMode::Custom => Some(PaperSizeMm {
            width: custom_width_mm.clamp(MIN_CUSTOM_PAPER_MM as f32, MAX_CUSTOM_PAPER_MM as f32),
            height: custom_height_mm.clamp(MIN_CUSTOM_PAPER_MM as f32, MAX_CUSTOM_PAPER_MM as f32),
        }),
    }?;
    Some(match orientation {
        Orientation::Portrait => size,
        Orientation::Landscape => PaperSizeMm {
            width: size.height,
            height: size.width,
        },
    })
}

pub fn page_layout_px_with_margins(paper: PaperSizeMm, margins: &PageMargins) -> PageLayoutPx {
    let page_width = paper.width * MM_TO_PX;
    let page_height = paper.height * MM_TO_PX;
    let padding_left = margins.left_mm * MM_TO_PX;
    let padding_right = margins.right_mm * MM_TO_PX;
    let padding_top = margins.top_mm * MM_TO_PX;
    let padding_bottom = margins.bottom_mm * MM_TO_PX;
    let content_width = (page_width - padding_left - padding_right).max(0.0);
    let content_height = (page_height - padding_top - padding_bottom).max(0.0);

    PageLayoutPx {
        page_width,
        page_height,
        content_width,
        content_height,
        padding_left,
        padding_right,
        padding_top,
        padding_bottom,
    }
}

pub fn page_layout_px(paper: PaperSizeMm) -> PageLayoutPx {
    page_layout_px_with_margins(paper, &PageMargins::default())
}

fn estimate_block_height_px(block: &DocumentBlock, content_width: f32) -> f32 {
    let avg_char_px = 8.5;
    let chars_per_line = (content_width / avg_char_px).max(10.0) as usize;

    match block {
        DocumentBlock::Heading1(text) => {
            let lines = text.chars().count().div_ceil(chars_per_line).max(1);
            lines as f32 * 46.0 + 10.0
        }
        DocumentBlock::Heading2(text) => {
            let lines = text.chars().count().div_ceil(chars_per_line).max(1);
            lines as f32 * 34.0 + 8.0
        }
        DocumentBlock::Paragraph(text) => {
            let lines = text.chars().count().div_ceil(chars_per_line).max(1);
            lines as f32 * 30.0 + 8.0
        }
    }
}

pub fn paginate_blocks(
    blocks: &[DocumentBlock],
    content_height: f32,
    content_width: f32,
) -> Vec<Vec<DocumentBlock>> {
    if blocks.is_empty() {
        return vec![Vec::new()];
    }

    let mut pages: Vec<Vec<DocumentBlock>> = Vec::new();
    let mut current_page: Vec<DocumentBlock> = Vec::new();
    let mut current_height = 0.0;

    for block in blocks {
        let block_height = estimate_block_height_px(block, content_width);

        if current_height + block_height > content_height && !current_page.is_empty() {
            pages.push(std::mem::take(&mut current_page));
            current_height = 0.0;
        }

        current_height += block_height;
        current_page.push(block.clone());
    }

    if !current_page.is_empty() {
        pages.push(current_page);
    }

    if pages.is_empty() {
        pages.push(Vec::new());
    }

    pages
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approximately_equal(left: f32, right: f32) -> bool {
        (left - right).abs() < 0.01
    }

    #[test]
    fn resolves_standard_and_seamless_paper_sizes() {
        assert_eq!(
            resolved_paper_size(PaperMode::Seamless, 0.0, 0.0, Orientation::Portrait),
            None
        );

        let a4 = resolved_paper_size(PaperMode::A4, 0.0, 0.0, Orientation::Portrait)
            .expect("A4 应具有固定尺寸");
        assert!(approximately_equal(a4.width, 210.0));
        assert!(approximately_equal(a4.height, 297.0));
    }

    #[test]
    fn clamps_custom_paper_to_the_minimum_size() {
        let paper = resolved_paper_size(PaperMode::Custom, 20.0, 70.0, Orientation::Portrait)
            .expect("自定义纸张应返回有效尺寸");

        assert!(approximately_equal(paper.width, 80.0));
        assert!(approximately_equal(paper.height, 80.0));
    }

    #[test]
    fn calculates_a4_pixel_layout_with_positive_content_area() {
        let paper =
            resolved_paper_size(PaperMode::A4, 0.0, 0.0, Orientation::Portrait).expect("A4 应存在");
        let layout = page_layout_px(paper);

        assert!(approximately_equal(layout.page_width, 210.0 * MM_TO_PX));
        assert!(approximately_equal(layout.page_height, 297.0 * MM_TO_PX));
        assert!(layout.content_width > 0.0);
        assert!(layout.content_height > 0.0);
        assert!(layout.content_width < layout.page_width);
        assert!(layout.content_height < layout.page_height);
        assert!(approximately_equal(
            layout.padding_left,
            DEFAULT_PAGE_MARGIN_LEFT_MM as f32 * MM_TO_PX
        ));
        assert!(approximately_equal(
            layout.padding_right,
            DEFAULT_PAGE_MARGIN_RIGHT_MM as f32 * MM_TO_PX
        ));
        assert!(approximately_equal(
            layout.padding_top,
            DEFAULT_PAGE_MARGIN_VERTICAL_MM as f32 * MM_TO_PX
        ));
    }

    #[test]
    fn ruler_positions_use_the_full_physical_paper_width() {
        assert!(approximately_equal(ruler_position_percent(0, 148), 0.0));
        assert!(approximately_equal(
            ruler_position_percent(10, 148),
            10.0 / 148.0 * 100.0
        ));
        assert!(approximately_equal(ruler_position_percent(148, 148), 100.0));
    }

    #[test]
    fn pagination_keeps_order_and_creates_multiple_pages() {
        let blocks = vec![
            DocumentBlock::Heading1("标题".into()),
            DocumentBlock::Paragraph("第一段".into()),
            DocumentBlock::Paragraph("第二段".into()),
        ];

        let pages = paginate_blocks(&blocks, 100.0, 500.0);

        assert_eq!(pages.len(), 2);
        assert_eq!(pages.concat(), blocks);
    }

    #[test]
    fn empty_document_still_has_one_empty_page() {
        let pages = paginate_blocks(&[], 500.0, 500.0);

        assert_eq!(pages, vec![Vec::<DocumentBlock>::new()]);
    }
}
