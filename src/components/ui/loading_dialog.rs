use dioxus::prelude::*;
use dioxus_primitives::dialog::{DialogContent, DialogDescription, DialogRoot, DialogTitle};

/// The progress dialog follows the job state and cannot be dismissed while it runs.
#[component]
pub fn LoadingDialog(
    active: ReadSignal<bool>,
    title: String,
    description: String,
    #[props(default)] immediate: bool,
) -> Element {
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
            return;
        }
        if immediate {
            delay_elapsed.set(true);
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
    use_effect(move || {
        if active() && delay_elapsed() && focus_ready() == Some(true) {
            // The primitive's focus trap only seeks interactive descendants.
            // Progress has no action, so focus its dialog container instead.
            let _ = document::eval(
                r#"requestAnimationFrame(() => {
                    document.querySelector('.editor-progress-backdrop[data-state="open"] [role="dialog"]')?.focus();
                });"#,
            );
        }
    });

    rsx! {
        DialogRoot {
            open: active() && delay_elapsed(),
            is_modal: focus_ready().unwrap_or(false),
            on_open_change: move |_: bool| {},
            class: "editor-progress-backdrop",
            DialogContent {
                class: "editor-progress-dialog",
                tabindex: 0,
                div { class: "editor-progress-spinner", aria_hidden: "true" }
                DialogTitle { "{title}" }
                DialogDescription { "{description}" }
                p { class: "editor-progress-note", "完成后会自动关闭，请稍候。" }
            }
        }
    }
}
