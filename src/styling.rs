// Keep this order in sync with the original cascade. Later files deliberately
// refine rules from earlier ones. PDF export uses the same document CSS.
macro_rules! word_css {
    () => {
        concat!(
            include_str!("../assets/styling/word/base.css"),
            include_str!("../assets/styling/word/title-bar.css"),
            include_str!("../assets/styling/word/ribbon.css"),
            include_str!("../assets/styling/word/file-backstage.css"),
            include_str!("../assets/styling/word/file-backstage-refinements.css"),
            include_str!("../assets/styling/word/dialogs.css"),
            include_str!("../assets/styling/word/markdown.css"),
            include_str!("../assets/styling/word/paper.css"),
            include_str!("../assets/styling/word/status.css"),
            include_str!("../assets/styling/word/page-furniture.css"),
            include_str!("../assets/styling/word/outline.css"),
            include_str!("../assets/styling/word/title-bar-refinements.css"),
            include_str!("../assets/styling/word/page-furniture-refinements.css"),
            include_str!("../assets/styling/word/title-bar-actions.css"),
            include_str!("../assets/styling/word/dialog-themes.css"),
        )
    };
}

pub(crate) const DOCUMENT_CSS: &str = word_css!();

pub(crate) const APP_CSS: &str = concat!(
    include_str!("../assets/styling/main.css"),
    "\n",
    include_str!("../assets/styling/theme.css"),
    "\n",
    word_css!(),
    "\n",
    include_str!("../assets/styling/wysiwyg_core.css"),
    "\n",
    include_str!("../assets/styling/theme-overrides.css"),
);
