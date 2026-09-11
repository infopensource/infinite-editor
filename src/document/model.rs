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
    pub page_furniture: PageFurnitureSettings,
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
            page_furniture: PageFurnitureSettings::default(),
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
        self.page_furniture.validate(&self.margins)?;
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
    pub title: String,
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

/// Templates are document metadata; each region owns its style independently.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PageFurnitureSettings {
    pub header: PageRegion,
    pub footer: PageRegion,
}

impl PageFurnitureSettings {
    pub fn validate(&self, margins: &PageMargins) -> Result<(), String> {
        for (name, region, available) in [
            ("页眉", &self.header, margins.top_mm),
            ("页脚", &self.footer, margins.bottom_mm),
        ] {
            let size = region.style.font_size_pt;
            if !size.is_finite() || !(6.0..=36.0).contains(&size) {
                return Err(format!("{name}字号必须在 6–36 pt 之间"));
            }
            let style = &region.style;
            if [
                style.margin_top_mm,
                style.margin_bottom_mm,
                style.margin_left_mm,
                style.margin_right_mm,
                style.column_gap_mm,
                style.padding_top_mm,
                style.padding_bottom_mm,
                style.padding_left_mm,
                style.padding_right_mm,
            ]
            .into_iter()
            .any(|value| !value.is_finite() || !(0.0..=100.0).contains(&value))
            {
                return Err(format!("{name}留白和栏间距必须在 0–100 mm 之间"));
            }
            let mut content_height = size * 25.4 / 72.0 * 1.3;
            for field in region
                .left
                .iter()
                .chain(&region.center)
                .chain(&region.right)
            {
                if let PageField::Image {
                    src,
                    width_mm,
                    height_mm,
                    ..
                } = field
                {
                    if !width_mm.is_finite()
                        || !height_mm.is_finite()
                        || !(0.1..=100.0).contains(width_mm)
                        || !(0.1..=100.0).contains(height_mm)
                    {
                        return Err(format!("{name}图片尺寸必须在 0.1–100 mm 之间"));
                    }
                    let Some((prefix, encoded)) = src.split_once(',') else {
                        return Err(format!("{name}图片数据无效"));
                    };
                    if ![
                        "data:image/png;base64",
                        "data:image/jpeg;base64",
                        "data:image/webp;base64",
                        "data:image/gif;base64",
                    ]
                    .contains(&prefix)
                        || encoded.len() > 12 * 1024 * 1024
                    {
                        return Err(format!("{name}图片格式或大小无效"));
                    }
                    use base64::Engine as _;
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(encoded)
                        .map_err(|_| format!("{name}图片编码无效"))?;
                    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
                        return Err(format!("{name}图片不能超过 8 MiB"));
                    }
                    content_height = content_height.max(*height_mm);
                }
            }
            let required = content_height
                + if style.separator { 25.4 / 144.0 } else { 0.0 }
                + style.margin_top_mm
                + style.margin_bottom_mm
                + style.padding_top_mm
                + style.padding_bottom_mm;
            if region.enabled && required > available {
                return Err(format!(
                    "{name}放不下，请减少上下留白、增大页边距或减小字号"
                ));
            }
            let color = &region.style.color;
            if color.len() != 7
                || !color.starts_with('#')
                || !color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(format!("{name}颜色必须为 #RRGGBB"));
            }
            for slot in [&region.left, &region.center, &region.right] {
                if slot.iter().any(|part| matches!(part, PageField::Text { value } if value.chars().any(char::is_control))) {
                    return Err(format!("{name}仅支持单行文本"));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PageRegion {
    pub enabled: bool,
    pub hide_first_page: bool,
    pub left: Vec<PageField>,
    pub center: Vec<PageField>,
    pub right: Vec<PageField>,
    pub style: PageRegionStyle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PageField {
    Text {
        value: String,
    },
    Page,
    Pages,
    Image {
        src: String,
        alt: String,
        width_mm: f32,
        height_mm: f32,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PageRegionStyle {
    pub font_family: String,
    pub font_size_pt: f32,
    pub color: String,
    pub separator: bool,
    pub margin_top_mm: f32,
    pub margin_bottom_mm: f32,
    pub margin_left_mm: f32,
    pub margin_right_mm: f32,
    pub column_gap_mm: f32,
    pub padding_top_mm: f32,
    pub padding_bottom_mm: f32,
    pub padding_left_mm: f32,
    pub padding_right_mm: f32,
}

impl Default for PageRegionStyle {
    fn default() -> Self {
        Self {
            font_family: "system-ui".into(),
            font_size_pt: 9.0,
            color: "#64748b".into(),
            separator: false,
            margin_top_mm: 3.0,
            margin_bottom_mm: 3.0,
            margin_left_mm: 0.0,
            margin_right_mm: 0.0,
            column_gap_mm: 2.0,
            padding_top_mm: 0.0,
            padding_bottom_mm: 0.0,
            padding_left_mm: 0.0,
            padding_right_mm: 0.0,
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
    fn page_furniture_round_trips_and_old_layouts_default_to_disabled() {
        let old: LayoutDocument = toml::from_str("version = 1").unwrap();
        assert!(!old.page_furniture.header.enabled);
        let mut layout = old;
        layout.page_furniture.header.enabled = true;
        layout.page_furniture.header.left = vec![PageField::Text {
            value: "标题".into(),
        }];
        layout.page_furniture.header.style.color = "#ff0000".into();
        layout.page_furniture.header.style.margin_top_mm = 1.5;
        layout.page_furniture.header.style.margin_left_mm = 4.0;
        layout.page_furniture.footer.style.column_gap_mm = 5.0;
        layout.page_furniture.footer.center = vec![
            PageField::Page,
            PageField::Text { value: "/".into() },
            PageField::Pages,
        ];
        layout.page_furniture.footer.style.font_size_pt = 12.0;
        let encoded = toml::to_string_pretty(&layout).unwrap();
        let decoded: LayoutDocument = toml::from_str(&encoded).unwrap();
        assert_eq!(decoded, layout);
        assert_eq!(decoded.page_furniture.header.style.font_size_pt, 9.0);
        layout.margins.top_mm = 2.0;
        assert!(layout
            .validate_and_normalize()
            .unwrap_err()
            .contains("页眉"));
    }

    #[test]
    fn image_templates_and_inner_padding_round_trip_and_validate() {
        let mut layout = LayoutDocument::default();
        layout.page_furniture.header.enabled = true;
        layout.page_furniture.header.style.padding_bottom_mm = 1.5;
        layout.page_furniture.header.style.padding_left_mm = 2.0;
        layout.page_furniture.header.left.push(PageField::Image {
            src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQiO0DAAGsAQzvOxmOAAAAAElFTkSuQmCC".into(),
            alt: "标识".into(), width_mm: 4.0, height_mm: 4.0,
        });
        layout.validate_and_normalize().unwrap();
        let encoded = toml::to_string_pretty(&layout).unwrap();
        let decoded: LayoutDocument = toml::from_str(&encoded).unwrap();
        assert_eq!(decoded, layout);
        assert_eq!(decoded.page_furniture.footer.style.padding_bottom_mm, 0.0);
        layout.page_furniture.header.style.padding_bottom_mm = 100.0;
        assert!(layout.validate_and_normalize().is_err());
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
