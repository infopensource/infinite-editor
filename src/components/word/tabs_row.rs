use dioxus::prelude::*;

use super::RibbonTab;

#[component]
pub fn TabsRow(active_tab: RibbonTab, on_switch: EventHandler<RibbonTab>) -> Element {
    rsx! {
        nav { class: "tabs-row",
            for tab in RibbonTab::all() {
                button {
                    class: if active_tab == tab { "tab-item active" } else { "tab-item" },
                    onclick: move |_| on_switch.call(tab),
                    "{tab.label()}"
                }
            }
        }
    }
}
