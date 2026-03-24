use crate::components::WordWorkspace;
use dioxus::prelude::*;

const WORD_CSS: Asset = asset!("/assets/styling/word.css");

/// The Home page component that will be rendered when the current route is `[Route::Home]`
#[component]
pub fn Home() -> Element {
    rsx! {
        document::Stylesheet { href: WORD_CSS }
        WordWorkspace {}

    }
}
