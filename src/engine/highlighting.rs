#![allow(dead_code)]

use std::sync::LazyLock;

use syntect::easy::HighlightLines;
use syntect::highlighting::{Style, Theme, ThemeSet};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;

#[derive(Clone, PartialEq)]
pub struct HighlightedToken {
    pub text: String,
    pub style: String,
}

#[derive(Clone, PartialEq)]
pub struct HighlightedLine {
    pub tokens: Vec<HighlightedToken>,
}

static SYNTAX_SET: LazyLock<SyntaxSet> = LazyLock::new(SyntaxSet::load_defaults_newlines);

static THEME: LazyLock<Theme> = LazyLock::new(|| {
    let themes = ThemeSet::load_defaults();
    themes
        .themes
        .get("InspiredGitHub")
        .cloned()
        .or_else(|| themes.themes.values().next().cloned())
        .unwrap_or_default()
});

pub fn highlight_markdown_source(source: &str) -> Vec<HighlightedLine> {
    let syntax = SYNTAX_SET
        .find_syntax_by_extension("md")
        .unwrap_or_else(|| SYNTAX_SET.find_syntax_plain_text());

    let mut highlighter = HighlightLines::new(syntax, &THEME);
    let mut lines = Vec::new();

    for line in LinesWithEndings::from(source) {
        let Ok(ranges) = highlighter.highlight_line(line, &SYNTAX_SET) else {
            lines.push(HighlightedLine {
                tokens: vec![HighlightedToken {
                    text: line.strip_suffix('\n').unwrap_or(line).to_string(),
                    style: String::new(),
                }],
            });
            continue;
        };

        let tokens = ranges
            .into_iter()
            .map(|(style, text)| HighlightedToken {
                text: text.strip_suffix('\n').unwrap_or(text).to_string(),
                style: color_style(style),
            })
            .collect();

        lines.push(HighlightedLine { tokens });
    }

    if source.is_empty() {
        lines.push(HighlightedLine { tokens: Vec::new() });
    }

    lines
}

fn color_style(style: Style) -> String {
    let color = style.foreground;
    let font_weight = if style.font_style.contains(syntect::highlighting::FontStyle::BOLD) {
        "font-weight: 600;"
    } else {
        ""
    };
    let font_style = if style
        .font_style
        .contains(syntect::highlighting::FontStyle::ITALIC)
    {
        "font-style: italic;"
    } else {
        ""
    };

    format!(
        "color: #{:02x}{:02x}{:02x}; {}{}",
        color.r, color.g, color.b, font_weight, font_style
    )
}
