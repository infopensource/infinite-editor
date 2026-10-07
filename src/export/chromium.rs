//! A private browser profile and a synchronous DevTools connection per export.
//! Wait for the actual renderer instead of Chromium's virtual-time heuristic.
use serde_json::{json, Value};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tungstenite::{Message, WebSocket};

pub(super) struct Browser {
    child: Child,
    socket: WebSocket<TcpStream>,
    sequence: u64,
    session: Option<String>,
}

impl Browser {
    pub fn launch(directory: &Path) -> Result<Self, String> {
        let profile = directory.join("browser-profile");
        let endpoint = profile.join("DevToolsActivePort");
        let log = directory.join("browser.log");
        let mut failure = "未找到 Chromium、Google Chrome 或 Microsoft Edge".to_string();
        #[allow(unused_mut)] // Windows adds browser install paths below.
        let mut candidates: Vec<PathBuf> = [
            "chromium",
            "chromium-browser",
            "google-chrome",
            "google-chrome-stable",
            "chrome",
            "msedge",
        ]
        .into_iter()
        .map(PathBuf::from)
        .collect();
        #[cfg(windows)]
        for root in [
            "PROGRAMFILES",
            "ProgramW6432",
            "PROGRAMFILES(X86)",
            "LOCALAPPDATA",
        ] {
            if let Some(directory) = std::env::var_os(root) {
                let directory = PathBuf::from(directory);
                candidates.push(directory.join("Microsoft/Edge/Application/msedge.exe"));
                candidates.push(directory.join("Google/Chrome/Application/chrome.exe"));
            }
        }
        for candidate in candidates {
            let stderr = std::fs::File::create(&log).map_err(|error| error.to_string())?;
            let _ = std::fs::remove_file(&endpoint);
            let mut child = match Command::new(&candidate)
                .args([
                    "--headless=new",
                    "--disable-gpu",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-background-networking",
                    "--disable-dev-shm-usage",
                    "--hide-scrollbars",
                    "--remote-debugging-address=127.0.0.1",
                    "--remote-debugging-port=0",
                ])
                .arg(format!("--user-data-dir={}", profile.display()))
                .arg("about:blank")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(stderr)
                .spawn()
            {
                Ok(child) => child,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    failure = format!("启动 {} 失败：{error}", candidate.display());
                    continue;
                }
            };
            let deadline = Instant::now() + Duration::from_secs(10);
            let address = loop {
                if let Ok(contents) = std::fs::read_to_string(&endpoint) {
                    let mut lines = contents.lines();
                    if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                        if let Ok(port) = port.parse::<u16>() {
                            break Some((port, path.to_string()));
                        }
                    }
                }
                if Instant::now() >= deadline || child.try_wait().ok().flatten().is_some() {
                    break None;
                }
                std::thread::sleep(Duration::from_millis(25));
            };
            if let Some((port, path)) = address {
                let connected = (|| {
                    let address = SocketAddr::from(([127, 0, 0, 1], port));
                    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(5))
                        .map_err(|error| error.to_string())?;
                    stream
                        .set_read_timeout(Some(Duration::from_secs(30)))
                        .map_err(|error| error.to_string())?;
                    stream
                        .set_write_timeout(Some(Duration::from_secs(30)))
                        .map_err(|error| error.to_string())?;
                    tungstenite::client(format!("ws://127.0.0.1:{port}{path}"), stream)
                        .map(|(socket, _)| socket)
                        .map_err(|error| error.to_string())
                })();
                if let Ok(socket) = connected {
                    return Ok(Self {
                        child,
                        socket,
                        sequence: 0,
                        session: None,
                    });
                }
            }
            let _ = child.kill();
            let _ = child.wait();
            let details = std::fs::read_to_string(&log).unwrap_or_default();
            failure = format!(
                "{} 启动失败：{}",
                candidate.display(),
                details.lines().last().unwrap_or("无法连接浏览器")
            );
        }
        Err(failure)
    }

    pub fn command(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.sequence += 1;
        let id = self.sequence;
        let mut request = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = &self.session {
            request["sessionId"] = json!(session);
        }
        self.socket
            .send(Message::Text(request.to_string().into()))
            .map_err(|error| format!("发送 {method} 失败：{error}"))?;
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            let message = self
                .socket
                .read()
                .map_err(|error| format!("等待 {method} 失败：{error}"))?;
            let Message::Text(text) = message else {
                continue;
            };
            let reply: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
            if reply["id"].as_u64() != Some(id) {
                continue;
            }
            if let Some(error) = reply.get("error") {
                return Err(format!("{method}：{error}"));
            }
            return Ok(reply["result"].clone());
        }
        Err(format!("浏览器执行 {method} 超时"))
    }

    pub fn open(&mut self, url: &str, width: u32) -> Result<(), String> {
        let target = self.command("Target.createTarget", json!({"url":"about:blank"}))?;
        let attached = self.command(
            "Target.attachToTarget",
            json!({"targetId":target["targetId"],"flatten":true}),
        )?;
        self.session = attached["sessionId"].as_str().map(str::to_owned);
        self.command("Page.enable", json!({}))?;
        self.command(
            "Emulation.setDeviceMetricsOverride",
            json!({"width":width,"height":1000,"deviceScaleFactor":1,"mobile":false}),
        )?;
        let result = self.command("Page.navigate", json!({"url":url}))?;
        if let Some(error) = result["errorText"].as_str() {
            return Err(format!("加载导出页面失败：{error}"));
        }
        Ok(())
    }

    pub fn evaluate(&mut self, expression: &str) -> Result<Value, String> {
        let reply = self.command(
            "Runtime.evaluate",
            json!({"expression":expression,"returnByValue":true,"awaitPromise":true}),
        )?;
        if let Some(exception) = reply.get("exceptionDetails") {
            return Err(format!("导出排版失败：{exception}"));
        }
        Ok(reply["result"]["value"].clone())
    }
}

impl Drop for Browser {
    fn drop(&mut self) {
        self.session = None;
        // Do not wait for a response to Browser.close (the socket closes too).
        self.sequence += 1;
        let _ = self.socket.send(Message::Text(
            json!({"id":self.sequence,"method":"Browser.close"})
                .to_string()
                .into(),
        ));
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
