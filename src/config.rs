//! Application-level document and layout defaults.
//!
//! `Dioxus.toml` configures the Dioxus build/runtime. Values that define the
//! editor's document model belong here so Rust validation, UI controls, and
//! tests all use the same source of truth.

pub const MIN_CUSTOM_PAPER_MM: u16 = 80;
pub const MAX_CUSTOM_PAPER_MM: u16 = 2_000;
pub const DEFAULT_CUSTOM_PAPER_WIDTH_MM: u16 = 210;
pub const DEFAULT_CUSTOM_PAPER_HEIGHT_MM: u16 = 297;

pub const DEFAULT_PAGE_MARGIN_LEFT_MM: u16 = 22;
pub const DEFAULT_PAGE_MARGIN_RIGHT_MM: u16 = 22;
pub const DEFAULT_PAGE_MARGIN_VERTICAL_MM: u16 = 25;
pub const MIN_PAGE_CONTENT_WIDTH_MM: u16 = 20;

pub const RULER_MINOR_STEP_MM: u16 = 1;
pub const RULER_MID_STEP_MM: u16 = 5;
pub const RULER_MAJOR_STEP_MM: u16 = 10;

pub fn clamp_custom_paper_mm(value: u16) -> u16 {
    value.clamp(MIN_CUSTOM_PAPER_MM, MAX_CUSTOM_PAPER_MM)
}

pub fn parse_custom_paper_mm(value: &str) -> u16 {
    value
        .parse::<u32>()
        .map(|value| value.clamp(MIN_CUSTOM_PAPER_MM as u32, MAX_CUSTOM_PAPER_MM as u32) as u16)
        .unwrap_or(MIN_CUSTOM_PAPER_MM)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_paper_values_are_clamped_to_configured_limits() {
        assert_eq!(clamp_custom_paper_mm(20), MIN_CUSTOM_PAPER_MM);
        assert_eq!(clamp_custom_paper_mm(210), 210);
        assert_eq!(clamp_custom_paper_mm(u16::MAX), MAX_CUSTOM_PAPER_MM);
        assert_eq!(parse_custom_paper_mm("20"), MIN_CUSTOM_PAPER_MM);
        assert_eq!(parse_custom_paper_mm("99999"), MAX_CUSTOM_PAPER_MM);
        assert_eq!(parse_custom_paper_mm(""), MIN_CUSTOM_PAPER_MM);
    }
}
