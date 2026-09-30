//! Desktop regression: emulate prompt JS query collection before Rust polls
//! a result. Run with `cargo run --offline --example eval_reply_harness`.
#[cfg(feature = "desktop")]
#[path = "../src/components/word/javascript.rs"]
mod javascript;
#[cfg(feature = "desktop")]
use dioxus::prelude::*;

#[cfg(feature = "desktop")]
fn main() {
    eprintln!("Starting desktop eval regression");
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(30));
        eprintln!("FAIL: desktop renderer did not complete within 30 seconds");
        std::process::exit(1);
    });
    dioxus::launch(App);
}

#[cfg(not(feature = "desktop"))]
fn main() {}

#[cfg(feature = "desktop")]
#[component]
fn App() -> Element {
    use_effect(|| {
        eprintln!("Desktop renderer mounted");
        spawn(async {
            let result = tokio::time::timeout(std::time::Duration::from_secs(15), check()).await;
            match result {
                Ok(Ok(())) => {
                    println!("PASS: Desktop eval replies survive query collection; null, JS errors and cancellation handled");
                    std::process::exit(0);
                }
                other => {
                    eprintln!("FAIL: {other:?}");
                    std::process::exit(1);
                }
            }
        });
    });
    rsx! { p { "Running desktop eval regression…" } }
}

#[cfg(feature = "desktop")]
async fn check() -> Result<(), String> {
    use javascript::eval_reply;
    use std::time::Duration;
    // Dioxus normally receives this `drop` message from FinalizationRegistry.
    // Trigger it deterministically after query completion to test the same
    // ownership path without relying on a particular WebKit GC schedule.
    eval_reply::<()>(r#"
        // The fixture supplies collection notifications itself; avoid a later
        // duplicate notification for a slab index that has already been reused.
        window.finalizationRegistry = { register() {} };
        const createQuery = window.createQuery;
        window.createQuery = function(id) {
            const query = createQuery(id);
            const close = query.close.bind(query);
            query.close = function() {
                close();
                setTimeout(() => window.ipc.postMessage(JSON.stringify({
                    method: 'query', params: { id, data: { method: 'drop' } }
                })), 0);
            };
            return query;
        };
    "#).await?;
    let raw = document::eval("return 'snapshot';");
    tokio::time::sleep(Duration::from_millis(200)).await;
    if !matches!(raw.join::<String>().await, Err(document::EvalError::Finished)) {
        return Err("Fixture did not reproduce the original Finished error".into());
    }
    for index in 0..20 {
        let text: String = eval_reply(&format!("return '正文-{index}';")).await?;
        if text != format!("正文-{index}") { return Err("Snapshot mismatch".into()); }
    }
    if eval_reply::<Option<String>>("return null;").await?.is_some() {
        return Err("Null response changed".into());
    }
    if !eval_reply::<String>("throw new Error('expected-test-error');").await.unwrap_err().contains("expected-test-error") {
        return Err("JS error was swallowed".into());
    }
    let pending = spawn(async {
        let _ = eval_reply::<()>("await new Promise(resolve => setTimeout(resolve, 100));").await;
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    pending.cancel();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let active: usize = eval_reply("return window.__msg_queues.filter(Boolean).length;").await?;
    if active != 1 { return Err(format!("Leaked query after cancellation: {active}")); }
    Ok(())
}
