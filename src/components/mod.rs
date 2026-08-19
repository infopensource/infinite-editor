mod word;
#[cfg(feature = "desktop")]
pub(crate) use word::document_renderer::{
    embedded_font_css, escape_css_string, render_html_with_page_breaks,
};
pub use word::WordWorkspace;
