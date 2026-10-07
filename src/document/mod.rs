mod model;
mod resources;

pub use model::{
    LayoutDocument, Orientation, PageFurnitureSettings, PageMargins, PaperMode, ProjectDocument,
};
#[cfg(feature = "desktop")]
pub use model::{PageField, PageRegion, PageTextMark};
pub use resources::ResourceBundle;
