use dioxus::prelude::*;
use dioxus_primitives::dialog::{DialogContent, DialogDescription, DialogRoot, DialogTitle};

/// Closing the presentation does not cancel or complete its underlying job.
#[component]
pub fn LoadingDialog(active: ReadSignal<bool>, title: String, description: String) -> Element {
    let mut dismissed = use_signal(|| false);
    let mut delay_elapsed = use_signal(|| false);
    let mut delay_generation = use_signal(|| 0_u64);
    // The official primitive inserts its focus script asynchronously. Opening
    // immediately on mount must not race the first download of that script.
    let focus_ready = use_resource(|| async {
        document::eval(
            r#"
            return await new Promise(resolve => {
                const deadline = performance.now() + 5000;
                const ready = () => {
                    if (typeof window.createFocusTrap === 'function') resolve(true);
                    else if (performance.now() >= deadline) resolve(false);
                    else requestAnimationFrame(ready);
                };
                ready();
            });
        "#,
        )
        .join::<bool>()
        .await
        .unwrap_or(false)
    });
    use_effect(move || {
        delay_generation.with_mut(|generation| *generation = generation.wrapping_add(1));
        let generation = delay_generation();
        delay_elapsed.set(false);
        if !active() {
            dismissed.set(false);
            return;
        }
        spawn(async move {
            let _ = document::eval(
                "return await new Promise(resolve => setTimeout(() => resolve(true), 1000));",
            )
            .join::<bool>()
            .await;
            if active() && delay_generation() == generation {
                delay_elapsed.set(true);
            }
        });
    });

    rsx! {
        DialogRoot {
            open: active() && delay_elapsed() && !dismissed(),
            is_modal: focus_ready().unwrap_or(false),
            on_open_change: move |open: bool| { if !open { dismissed.set(true); } },
            class: "editor-progress-backdrop",
            DialogContent {
                class: "editor-progress-dialog",
                div { class: "editor-progress-spinner", aria_hidden: "true" }
                DialogTitle { "{title}" }
                DialogDescription { "{description}" }
                p { class: "editor-progress-note", "关闭此提示后，任务会继续在后台处理。" }
                button {
                    class: "dialog-btn ghost",
                    onclick: move |_| dismissed.set(true),
                    "后台继续"
                }
            }
        }
    }
}
