use crate::config::{
    DEFAULT_CUSTOM_PAPER_HEIGHT_MM, DEFAULT_CUSTOM_PAPER_WIDTH_MM, DEFAULT_PAGE_MARGIN_LEFT_MM,
    DEFAULT_PAGE_MARGIN_RIGHT_MM, DEFAULT_PAGE_MARGIN_VERTICAL_MM, MAX_CUSTOM_PAPER_MM,
    MIN_CUSTOM_PAPER_MM, MIN_PAGE_CONTENT_HEIGHT_MM, MIN_PAGE_CONTENT_WIDTH_MM,
};
use serde::{Deserialize, Serialize};

pub const LAYOUT_FORMAT: &str = "infinite-editor-layout";
pub const LAYOUT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectDocument {
    pub markdown: String,
    pub layout: LayoutDocument,
}

impl ProjectDocument {
    pub fn new(markdown: String) -> Self {
        Self {
            markdown,
            layout: LayoutDocument::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LayoutDocument {
    pub format: String,
    pub version: u32,
    pub document: DocumentReference,
    pub paper: PaperSettings,
    pub margins: PageMargins,
    pub pagination: PaginationSettings,
    pub typography: TypographySettings,
    pub resources: ResourceSettings,
    pub export: ExportSettings,
}

impl Default for LayoutDocument {
    fn default() -> Self {
        Self {
            format: LAYOUT_FORMAT.to_string(),
            version: LAYOUT_VERSION,
            document: DocumentReference::default(),
            paper: PaperSettings::default(),
            margins: PageMargins::default(),
            pagination: PaginationSettings::default(),
            typography: TypographySettings::default(),
            resources: ResourceSettings::default(),
            export: ExportSettings::default(),
        }
    }
}

impl LayoutDocument {
    pub fn validate_and_normalize(&mut self) -> Result<Vec<String>, String> {
        if self.format != LAYOUT_FORMAT {
            return Err(format!("不支持的布局格式：{}", self.format));
        }
        if self.version == 0 || self.version > LAYOUT_VERSION {
            return Err(format!(
                "不支持的布局版本：{}（当前最高支持 {}）",
                self.version, LAYOUT_VERSION
            ));
        }

        let mut warnings = Vec::new();
        let paper = &mut self.paper;
        if !paper.width_mm.is_finite() || !paper.height_mm.is_finite() {
            return Err("纸张尺寸必须是有限数值".to_string());
        }
        paper.width_mm = paper
            .width_mm
            .clamp(MIN_CUSTOM_PAPER_MM as f32, MAX_CUSTOM_PAPER_MM as f32);
        paper.height_mm = paper
            .height_mm
            .clamp(MIN_CUSTOM_PAPER_MM as f32, MAX_CUSTOM_PAPER_MM as f32);

        let width = paper.resolved_width_mm().unwrap_or(paper.width_mm);
        let height = paper.resolved_height_mm().unwrap_or(paper.height_mm);
        let margins = &mut self.margins;
        if [
            margins.top_mm,
            margins.right_mm,
            margins.bottom_mm,
            margins.left_mm,
        ]
        .into_iter()
        .any(|value| !value.is_finite())
        {
            return Err("页边距必须是有限数值".to_string());
        }
        margins.top_mm = margins.top_mm.max(0.0);
        margins.right_mm = margins.right_mm.max(0.0);
        margins.bottom_mm = margins.bottom_mm.max(0.0);
        margins.left_mm = margins.left_mm.max(0.0);
        let maximum_total = (width - MIN_PAGE_CONTENT_WIDTH_MM as f32).max(0.0);
        if margins.left_mm + margins.right_mm > maximum_total {
            warnings.push("左右页边距过大，已缩小以保留最小正文宽度".to_string());
            margins.left_mm = margins.left_mm.min(maximum_total);
            margins.right_mm = margins.right_mm.min(maximum_total - margins.left_mm);
        }
        let maximum_vertical_total = (height - MIN_PAGE_CONTENT_HEIGHT_MM as f32).max(0.0);
        if margins.top_mm + margins.bottom_mm > maximum_vertical_total {
            warnings.push("上下页边距过大，已缩小以保留最小正文高度".to_string());
            margins.top_mm = margins.top_mm.min(maximum_vertical_total);
            margins.bottom_mm = margins
                .bottom_mm
                .min(maximum_vertical_total - margins.top_mm);
        }
        if !self.typography.body_font_size_pt.is_finite()
            || !self.typography.line_height.is_finite()
            || !self.typography.paragraph_spacing_pt.is_finite()
        {
            return Err("排版参数必须是有限数值".to_string());
        }
        self.typography.body_font_size_pt = self.typography.body_font_size_pt.clamp(1.0, 512.0);
        self.typography.line_height = self.typography.line_height.clamp(0.5, 10.0);
        self.typography.paragraph_spacing_pt = self.typography.paragraph_spacing_pt.max(0.0);
        if !self.export.pdf.scale.is_finite() {
            return Err("PDF 缩放比例必须是有限数值".to_string());
        }
        self.export.pdf.scale = self.export.pdf.scale.clamp(0.1, 2.0);
        Ok(warnings)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct DocumentReference {
    pub source: String,
    pub source_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaperMode {
    Seamless,
    A4,
    A5,
    Custom,
}

impl PaperMode {
    pub fn label(self) -> &'static str {
        match self {
            Self::Seamless => "无缝",
            Self::A4 => "A4",
            Self::A5 => "A5",
            Self::Custom => "自定义",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Orientation {
    #[default]
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PaperSettings {
    pub mode: PaperMode,
    pub width_mm: f32,
    pub height_mm: f32,
    pub orientation: Orientation,
}

impl Default for PaperSettings {
    fn default() -> Self {
        Self {
            mode: PaperMode::A4,
            width_mm: DEFAULT_CUSTOM_PAPER_WIDTH_MM as f32,
            height_mm: DEFAULT_CUSTOM_PAPER_HEIGHT_MM as f32,
            orientation: Orientation::Portrait,
        }
    }
}

impl PaperSettings {
    pub fn resolved_width_mm(&self) -> Option<f32> {
        let (width, height) = match self.mode {
            PaperMode::Seamless => return None,
            PaperMode::A4 => (210.0, 297.0),
            PaperMode::A5 => (148.0, 210.0),
            PaperMode::Custom => (self.width_mm, self.height_mm),
        };
        Some(match self.orientation {
            Orientation::Portrait => width,
            Orientation::Landscape => height,
        })
    }

    pub fn resolved_height_mm(&self) -> Option<f32> {
        let (width, height) = match self.mode {
            PaperMode::Seamless => return None,
            PaperMode::A4 => (210.0, 297.0),
            PaperMode::A5 => (148.0, 210.0),
            PaperMode::Custom => (self.width_mm, self.height_mm),
        };
        Some(match self.orientation {
            Orientation::Portrait => height,
            Orientation::Landscape => width,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PageMargins {
    pub top_mm: f32,
    pub right_mm: f32,
    pub bottom_mm: f32,
    pub left_mm: f32,
}

impl Default for PageMargins {
    fn default() -> Self {
        Self {
            top_mm: DEFAULT_PAGE_MARGIN_VERTICAL_MM as f32,
            right_mm: DEFAULT_PAGE_MARGIN_RIGHT_MM as f32,
            bottom_mm: DEFAULT_PAGE_MARGIN_VERTICAL_MM as f32,
            left_mm: DEFAULT_PAGE_MARGIN_LEFT_MM as f32,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PaginationSettings {
    pub enabled: bool,
    pub header_height_mm: f32,
    pub footer_height_mm: f32,
    pub widow_lines: u8,
    pub orphan_lines: u8,
}

impl Default for PaginationSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            header_height_mm: 0.0,
            footer_height_mm: 0.0,
            widow_lines: 2,
            orphan_lines: 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TypographySettings {
    pub body_font: String,
    pub body_font_size_pt: f32,
    pub line_height: f32,
    pub paragraph_spacing_pt: f32,
}

impl Default for TypographySettings {
    fn default() -> Self {
        Self {
            body_font: "system-ui".to_string(),
            body_font_size_pt: 11.0,
            line_height: 1.8,
            paragraph_spacing_pt: 8.0,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ResourceSettings {
    pub root: String,
    pub fonts: Vec<FontResource>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FontResource {
    pub family: String,
    pub path: String,
    pub weight: u16,
    pub style: String,
}

impl Default for FontResource {
    fn default() -> Self {
        Self {
            family: String::new(),
            path: String::new(),
            weight: 400,
            style: "normal".to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ExportSettings {
    pub pdf: PdfExportSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PdfExportSettings {
    pub print_background: bool,
    pub prefer_css_page_size: bool,
    pub scale: f32,
    pub embed_fonts: bool,
}

impl Default for PdfExportSettings {
    fn default() -> Self {
        Self {
            print_background: true,
            prefer_css_page_size: true,
            scale: 1.0,
            embed_fonts: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_round_trips_through_toml() {
        let layout = LayoutDocument::default();
        let encoded = toml::to_string_pretty(&layout).expect("布局应可编码");
        let decoded: LayoutDocument = toml::from_str(&encoded).expect("布局应可解码");
        assert_eq!(decoded, layout);
    }

    #[test]
    fn invalid_future_version_is_rejected() {
        let mut layout = LayoutDocument {
            version: LAYOUT_VERSION + 1,
            ..LayoutDocument::default()
        };
        assert!(layout.validate_and_normalize().is_err());
    }
}
