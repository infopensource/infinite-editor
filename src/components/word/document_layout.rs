#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PaperMode {
    Seamless,
    A4,
    A5,
    Custom,
}

impl PaperMode {
    pub fn label(self) -> &'static str {
        match self {
            PaperMode::Seamless => "无缝",
            PaperMode::A4 => "A4",
            PaperMode::A5 => "A5",
            PaperMode::Custom => "自定义",
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub struct PaperSizeMm {
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Copy, PartialEq)]
pub struct PageLayoutPx {
    pub page_width: f32,
    pub page_height: f32,
    pub content_width: f32,
    pub content_height: f32,
    pub padding_x: f32,
    pub padding_y: f32,
}

#[derive(Clone, PartialEq)]
pub enum DocumentBlock {
    Heading1(String),
    Heading2(String),
    Paragraph(String),
}

pub const MM_TO_PX: f32 = 96.0 / 25.4;
const CONTENT_MARGIN_X_MM: f32 = 22.0;
const CONTENT_MARGIN_Y_MM: f32 = 25.0;

pub fn resolved_paper_size(mode: PaperMode, custom_width_mm: u16, custom_height_mm: u16) -> Option<PaperSizeMm> {
    match mode {
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
            width: custom_width_mm.max(80) as f32,
            height: custom_height_mm.max(80) as f32,
        }),
    }
}

pub fn page_layout_px(paper: PaperSizeMm) -> PageLayoutPx {
    let page_width = paper.width * MM_TO_PX;
    let page_height = paper.height * MM_TO_PX;
    let padding_x = CONTENT_MARGIN_X_MM * MM_TO_PX;
    let padding_y = CONTENT_MARGIN_Y_MM * MM_TO_PX;
    let content_width = (page_width - padding_x * 2.0).max(220.0);
    let content_height = (page_height - padding_y * 2.0).max(240.0);

    PageLayoutPx {
        page_width,
        page_height,
        content_width,
        content_height,
        padding_x,
        padding_y,
    }
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

pub fn paginate_blocks(blocks: &[DocumentBlock], content_height: f32, content_width: f32) -> Vec<Vec<DocumentBlock>> {
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
