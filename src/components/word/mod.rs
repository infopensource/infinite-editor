mod document_layout;
pub(crate) mod document_renderer;
mod editor_surface;
mod file_actions;
mod file_backstage;
mod prosemirror_surface;
mod resize_handles;
mod ribbon_groups;
mod status_bar;
mod tabs_row;
mod title_bar;
mod workspace;

pub(super) const MARKDOWN_DOCUMENT_BRIDGE_ID: &str = "markdown-document-bridge";
pub(super) const CLIPBOARD_PASTE_BRIDGE_ID: &str = "clipboard-paste-bridge";

pub use crate::document::PaperMode;
pub use editor_surface::EditorSurface;
pub use status_bar::StatusBar;
pub use tabs_row::TabsRow;
pub use title_bar::TitleBar;
pub use workspace::WordWorkspace;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RibbonTab {
    File,
    Home,
    Insert,
    Draw,
    Layout,
    References,
    Review,
    View,
}

impl RibbonTab {
    pub fn all() -> [RibbonTab; 8] {
        [
            RibbonTab::File,
            RibbonTab::Home,
            RibbonTab::Insert,
            RibbonTab::Draw,
            RibbonTab::Layout,
            RibbonTab::References,
            RibbonTab::Review,
            RibbonTab::View,
        ]
    }

    pub fn label(self) -> &'static str {
        match self {
            RibbonTab::File => "文件",
            RibbonTab::Home => "开始",
            RibbonTab::Insert => "插入",
            RibbonTab::Draw => "绘图",
            RibbonTab::Layout => "布局",
            RibbonTab::References => "引用",
            RibbonTab::Review => "审阅",
            RibbonTab::View => "视图",
        }
    }
}
