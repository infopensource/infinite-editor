use super::chromium::Browser;
use crate::document::{ProjectDocument, ResourceBundle};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub(super) struct ExportDirectory(pub PathBuf);

impl ExportDirectory {
    pub fn new(kind: &str) -> Result<Self, String> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "infinite-editor-{kind}-{}-{timestamp}",
            std::process::id()
        ));
        std::fs::create_dir(&path).map_err(|error| format!("创建导出临时目录失败：{error}"))?;
        Ok(Self(path))
    }
}

impl Drop for ExportDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub(super) struct PageRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub(super) struct RenderedDocument {
    pub browser: Browser,
    // Browser must close before its private profile is removed.
    _directory: ExportDirectory,
    pub pages: Vec<PageRect>,
}

impl RenderedDocument {
    pub fn new(
        document: &ProjectDocument,
        resources: &ResourceBundle,
        seamless: bool,
    ) -> Result<Self, String> {
        let width = if seamless {
            1120.0 * 25.4 / 96.0
        } else {
            document
                .layout
                .paper
                .resolved_width_mm()
                .ok_or("请先选择 A4、A5 或自定义纸张；无缝文档可导出长图")?
        };
        let height = if seamless {
            0.0
        } else {
            document
                .layout
                .paper
                .resolved_height_mm()
                .ok_or("无法确定纸张高度")?
        };
        let directory = ExportDirectory::new("render")?;
        let html = if seamless {
            build_seamless_html(document, resources)?
        } else {
            super::pdf::build_print_html(document, resources, width, height, false)?
        };
        let path = directory.0.join("document.html");
        std::fs::write(&path, html).map_err(|error| format!("写入导出页面失败：{error}"))?;
        let mut browser = Browser::launch(&directory.0)?;
        let url = url::Url::from_file_path(&path).map_err(|_| "无法生成导出页面 URL")?;
        browser.open(
            url.as_str(),
            if seamless {
                1200
            } else {
                (width as f64 * 96.0 / 25.4).ceil() as u32 + 2
            },
        )?;
        let deadline = Instant::now() + Duration::from_secs(30);
        let pages = loop {
            let state = browser.evaluate("window.InfiniteExport ?? null")?;
            if let Some(error) = state["error"].as_str() {
                return Err(format!("导出排版失败：{error}"));
            }
            if state["ready"].as_bool() == Some(true) {
                break serde_json::from_value::<Vec<PageRect>>(state["pages"].clone())
                    .map_err(|error| format!("读取导出页面尺寸失败：{error}"))?;
            }
            if Instant::now() >= deadline {
                return Err("等待导出排版超时，请检查图片和字体资源".into());
            }
            std::thread::sleep(Duration::from_millis(25));
        };
        if pages.is_empty()
            || pages.iter().any(|page| {
                ![page.x, page.y, page.width, page.height]
                    .iter()
                    .all(|n| n.is_finite())
                    || page.width <= 0.0
                    || page.height <= 0.0
            })
        {
            return Err("导出页面尺寸无效".into());
        }
        Ok(Self {
            browser,
            _directory: directory,
            pages,
        })
    }

    pub fn pdf(&mut self, target: &Path) -> Result<(), String> {
        let result = self.browser.command(
            "Page.printToPDF",
            json!({
                "preferCSSPageSize":true,"printBackground":true,"displayHeaderFooter":false,
                "marginTop":0,"marginBottom":0,"marginLeft":0,"marginRight":0
            }),
        )?;
        let bytes = BASE64
            .decode(result["data"].as_str().ok_or("PDF 数据为空")?)
            .map_err(|error| error.to_string())?;
        if !bytes.starts_with(b"%PDF-") {
            return Err("浏览器未生成有效 PDF".into());
        }
        std::fs::write(target, bytes).map_err(|error| format!("写入 PDF 失败：{error}"))
    }

    pub fn capture(&mut self, rect: PageRect, jpeg: bool, scale: f64) -> Result<Vec<u8>, String> {
        let mut params = json!({
            "format": if jpeg { "jpeg" } else { "png" },
            "captureBeyondViewport":true,"fromSurface":true,
            "clip":{"x":rect.x,"y":rect.y,"width":rect.width,"height":rect.height,"scale":scale}
        });
        if jpeg {
            params["quality"] = json!(90);
        }
        let result = self.browser.command("Page.captureScreenshot", params)?;
        BASE64
            .decode(result["data"].as_str().ok_or("截图数据为空")?)
            .map_err(|error| format!("解码图片失败：{error}"))
    }

    pub fn editable_html(&mut self) -> Result<String, String> {
        self.browser.evaluate(r#"(() => {
            const pages = [...document.querySelectorAll('.document-page-content')];
            return '<!doctype html><html><head><meta charset="utf-8"></head><body>' + pages.map(page => {
                const copy = page.cloneNode(true);
                const images = [...page.querySelectorAll('img')];
                [...copy.querySelectorAll('img')].forEach((image,index) => {
                    const rect = images[index].getBoundingClientRect();
                    image.setAttribute('width', String(rect.width));
                    image.setAttribute('height', String(rect.height));
                });
                for (const math of copy.querySelectorAll('.infinite-math')) {
                    const node = document.createElement('span');
                    const display = math.dataset.mathDisplay === 'true';
                    node.className = 'math ' + (display ? 'display' : 'inline');
                    node.textContent = (display ? '\\[' : '\\(') + math.dataset.mathSource + (display ? '\\]' : '\\)');
                    math.replaceWith(node);
                }
                for (const element of copy.querySelectorAll('[style*="text-align"]')) {
                    const wrapper = document.createElement('div');
                    wrapper.setAttribute('custom-style', 'InfiniteAlign' + element.style.textAlign);
                    element.replaceWith(wrapper); wrapper.appendChild(element);
                }
                return copy.innerHTML;
            }).join('<div class="infinite-office-page-break"></div>') + '</body></html>';
        })()"#)?.as_str().map(str::to_owned).ok_or_else(|| "读取分页正文失败".into())
    }
}

/// Use the real WYSIWYG editor's nodes, CSS, math queue and Seamless geometry.
/// There is no stitched or paginated intermediate representation for long PNGs.
fn build_seamless_html(
    document: &ProjectDocument,
    resources: &ResourceBundle,
) -> Result<String, String> {
    use crate::components::{embedded_font_css, escape_css_string};
    const WYSIWYG_CSS: &str = include_str!("../../assets/styling/wysiwyg_core.css");
    const WYSIWYG_JS: &str = include_str!("../../assets/wysiwyg.bundle.js");
    const MATH_CSS: &str = include_str!("../../assets/math.bundle.css");
    const MATH_JS: &str = include_str!("../../assets/math.bundle.js");
    let ast = crate::engine::ParserGateway::markdown_rs()
        .parse_infinite_ast(&document.markdown)
        .map_err(|error| error.message)?;
    let configuration = inline_json(&json!({
        "host_id":"export-host","bridge_id":"export-bridge","ast":ast,
        "markdown":document.markdown,"document_revision":0,"edit_revision":0,
        "resources":resources.entries()
    }))?;
    let typography = &document.layout.typography;
    let style = format!("--page-width:1120px;--page-height:auto;--page-padding-left:88px;--page-padding-right:88px;--page-padding-top:72px;--page-padding-bottom:72px;--document-font-family:\"{}\";--document-font-size:{}pt;--document-line-height:{};--document-paragraph-spacing:{}pt;",escape_css_string(&typography.body_font),typography.body_font_size_pt,typography.line_height,typography.paragraph_spacing_pt);
    let style = super::office_layout::escape(&style);
    let css = crate::styling::DOCUMENT_CSS;
    let fonts = embedded_font_css(&document.layout, resources);
    Ok(format!(
        r#"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
{css}{WYSIWYG_CSS}{MATH_CSS}{fonts}
html,body {{ margin:0; padding:0; background:white; }}
.infinite-pm-surface {{ padding:0; }}
.document-page {{ margin:0; box-shadow:none; border-color:transparent; }}
.infinite-pm-host [data-page-break] {{ display:none; }}
</style></head><body><input id="export-bridge" hidden>
<section class="infinite-pm-surface seamless" style="{style}"><article class="document-page seamless-page infinite-pm-page"><div id="export-host" class="document-page-content infinite-pm-host"></div></article></section>
<script>{MATH_JS}</script><script>{WYSIWYG_JS}</script><script>
window.addEventListener('load', async () => {{
  try {{
    const mounted = window.InfiniteWysiwygEditor.mount({configuration});
    if (!mounted.ok) throw new Error(mounted.error);
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('#export-host img')].map(image => image.decode()));
    const page = document.querySelector('.infinite-pm-page');
    const deadline = performance.now() + 25000;
    while (page.dataset.paginationState !== 'idle') {{
      if (page.dataset.paginationState === 'error') throw new Error('无缝排版失败');
      if (performance.now() > deadline) throw new Error('无缝排版超时');
      await new Promise(resolve => setTimeout(resolve, 25));
    }}
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = page.getBoundingClientRect();
    window.InfiniteExport = {{ready:true,pages:[{{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}]}};
  }} catch (error) {{ window.InfiniteExport = {{error:String(error)}}; }}
}});
</script></body></html>"#
    ))
}

fn inline_json(value: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string(value)
        .map(|text| {
            text.replace('<', "\\u003c")
                .replace('>', "\\u003e")
                .replace('&', "\\u0026")
                .replace('\u{2028}', "\\u2028")
                .replace('\u{2029}', "\\u2029")
        })
        .map_err(|error| error.to_string())
}
