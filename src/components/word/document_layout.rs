use crate::config::{MAX_CUSTOM_PAPER_MM, MIN_CUSTOM_PAPER_MM};
use crate::document::{Orientation, PaperMode};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PaperSizeMm {
    pub width: f32,
    pub height: f32,
}

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
    fn ruler_positions_use_the_full_physical_paper_width() {
        assert!(approximately_equal(ruler_position_percent(0, 148), 0.0));
        assert!(approximately_equal(
            ruler_position_percent(10, 148),
            10.0 / 148.0 * 100.0
        ));
        assert!(approximately_equal(ruler_position_percent(148, 148), 100.0));
    }
}
