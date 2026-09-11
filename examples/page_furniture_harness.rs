//! Mount the production settings template for the existing browser regression.
#[path = "../src/components/word/page_furniture_dialog.rs"]
mod page_furniture_dialog;
use dioxus::prelude::*;

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! { page_furniture_dialog::PageFurnitureDialogTemplate {} }
}
