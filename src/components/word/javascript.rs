use dioxus::prelude::*;
use serde::de::DeserializeOwned;

// Dioxus Desktop 0.7.3 owns an evaluator through its JS query. When a
// completed query is garbage-collected, a queued `drop` can invalidate Eval
// before Rust polls join(). Keep the JS query alive until Rust acknowledges
// receipt, using the public send/recv API instead of the return channel.
pub(super) async fn eval_reply<T: DeserializeOwned>(script: &str) -> Result<T, String> {
    let script = format!(
        r#"
        try {{
            const value = await (async () => {{ {script} }})();
            dioxus.send({{ ok: true, value: value ?? null }});
        }} catch (error) {{
            dioxus.send({{ ok: false, error: String(error) }});
        }}
        await dioxus.recv();
        "#
    );
    let mut reply = AcknowledgeOnDrop(document::eval(&script));
    let response = reply.0.recv::<Reply>().await.map_err(|error| error.to_string())?;
    if !response.ok {
        return Err(response.error.unwrap_or_else(|| "JavaScript 执行失败".into()));
    }
    serde_json::from_value(response.value).map_err(|error| error.to_string())
}

// Also releases the waiting JS query if the Rust caller is cancelled or
// deserializing its response fails.
struct AcknowledgeOnDrop(document::Eval);

impl Drop for AcknowledgeOnDrop {
    fn drop(&mut self) {
        let _ = self.0.send(());
    }
}

#[derive(serde::Deserialize)]
struct Reply {
    ok: bool,
    #[serde(default)]
    value: serde_json::Value,
    error: Option<String>,
}
