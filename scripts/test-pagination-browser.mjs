import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv[2] === 'dialog') {
  await import('./test-loading-dialog-browser.mjs');
  process.exit(process.exitCode ?? 0);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const output = mkdtempSync(join(tmpdir(), 'infinite-pagination-'));
const scenarios = process.argv.length > 2 ? process.argv.slice(2) : ['nested', 'table', 'table-long-cell', 'table-long-header', 'mixed', 'math-input', 'page-furniture'];
const bundle = await build({
  entryPoints: [resolve(root, scenarios.includes('zoom') ? 'web/zoom_browser.js' : scenarios.includes('tables-rendering') ? 'web/document_renderer/tables_browser.js' : scenarios.includes('lists') ? 'web/document_renderer/lists_browser.js' : scenarios.includes('selection') ? 'web/wysiwyg/selection_browser.js' : scenarios.includes('performance') ? 'web/wysiwyg/performance_browser.js' : 'web/wysiwyg/pagination_browser.js')],
  loader: { '.md': 'text', '.png': 'dataurl' }, bundle: true, write: false, format: 'iife',
});
const zoomCss = scenarios.includes('zoom') || scenarios.includes('tables-rendering') || scenarios.includes('lists') || scenarios.includes('selection') || scenarios.includes('page-furniture') ? readFileSync(resolve(root, 'assets/styling/word.css'), 'utf8') : '';
const css = readFileSync(resolve(root, 'assets/styling/wysiwyg_core.css'), 'utf8')
  + readFileSync(resolve(root, 'assets/math.bundle.css'), 'utf8');
const math = readFileSync(resolve(root, 'assets/math.bundle.js'), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><style>
* { box-sizing: border-box; } body { margin: 0; background: #eef2f7; }
.document-page { width: var(--page-width); min-height: var(--page-height); padding: var(--page-padding-top) var(--page-padding-right) var(--page-padding-bottom) var(--page-padding-left); margin: 20px auto; border: 1px solid #d1d5db; background: white; }
${zoomCss}
${css}</style>${scenarios.includes('selection') ? '<div class="word-shell" style="grid-template-rows:minmax(0,1fr)"><main class="editor-surface">' : ''}<div class="infinite-pm-surface paged"><article class="document-page infinite-pm-page" style="--page-width:210mm;--page-height:120mm;--page-padding-top:15mm;--page-padding-bottom:15mm;--page-padding-left:22mm;--page-padding-right:22mm"><div id="host" class="infinite-pm-host"></div></article></div>${scenarios.includes('selection') ? '</main></div>' : ''}<pre id="result"></pre><script>${math}</script><script>${bundle.outputFiles[0].text}</script>`;
const path = join(output, 'test.html');
writeFileSync(path, html);

// Real time and native animation frames. CDP pipes avoid a network listener,
// virtual-clock distortions and timing-dependent --dump-dom snapshots.
const browser = spawn(process.env.CHROMIUM || 'chromium', [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking',
  '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--remote-debugging-pipe', `--user-data-dir=${join(output, 'profile')}`,
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const pending = new Map();
let sequence = 0;
let buffer = '';
let errors = '';
browser.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
function rejectPending(error) {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
  pending.clear();
}
browser.on('error', rejectPending);
browser.on('exit', () => rejectPending(new Error(errors || 'Browser exited')));
browser.stdio[3].on('error', rejectPending);
browser.stdio[4].on('error', rejectPending);
browser.stdio[4].on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}
let templateServer;
try {
  if (scenarios.includes('page-furniture')) {
    // Read the actual Dioxus-rendered markup, never a duplicated HTML fixture.
    // Build with: dx build --web --example page_furniture_harness --no-default-features --features web --offline
    const fixtureRoot = resolve(root, 'target/dx/page_furniture_harness/debug/web/public');
    readFileSync(join(fixtureRoot, 'index.html'));
    templateServer = createServer((request, response) => {
      const requested = resolve(fixtureRoot, '.' + new URL(request.url, 'http://localhost').pathname);
      if (requested !== fixtureRoot && !requested.startsWith(fixtureRoot + sep)) { response.writeHead(403).end(); return; }
      try {
        const file = requested === fixtureRoot ? join(fixtureRoot, 'index.html') : requested;
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
        const content = readFileSync(file);
        response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
        response.end(content);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise((resolve, reject) => {
      templateServer.once('error', reject);
      templateServer.listen(0, '127.0.0.1', resolve);
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Page.navigate', { url: `http://127.0.0.1:${templateServer.address().port}/` }, sessionId);
    let template;
    for (let attempt = 0; attempt < 120 && !template; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const result = await send('Runtime.evaluate', {
        expression: "document.querySelector('#page-furniture-dialog-template')?.outerHTML", returnByValue: true,
      }, sessionId);
      template = result.result?.value;
    }
    if (!template) throw new Error('Dioxus page furniture template did not mount');
    writeFileSync(path, html.replace('<pre id="result">', () => template + '<pre id="result">'));
    await send('Target.closeTarget', { targetId });
  }
  for (const scenario of scenarios) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.bringToFront', {}, sessionId);
    await send('Page.navigate', { url: `${pathToFileURL(path)}?case=${scenario}` }, sessionId);
    let report;
    const deadline = Date.now() + 25000;
    while (!report && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const evaluated = await send('Runtime.evaluate', {
        expression: 'document.getElementById("result")?.textContent || ""', returnByValue: true,
      }, sessionId);
      if (evaluated.result?.value) report = JSON.parse(evaluated.result.value);
    }
    if (!report) throw new Error(`No result from ${scenario}`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const imagePath = join(output, scenario + '.png');
    writeFileSync(imagePath, Buffer.from(screenshot.data, 'base64'));
    writeFileSync(join(output, scenario + '.json'), JSON.stringify(report, null, 2));
    console.log(scenario, report, imagePath);
    if (!report.ok) process.exitCode = 1;
    if (scenario === 'page-furniture' && report.ok) {
      const retainedChrome = await send('Runtime.evaluate', {
        expression: `(async () => {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const selectors = ['.infinite-pm-pagination-layer', '.infinite-pm-furniture-layer'];
          const layers = selectors.map(selector => document.querySelector(selector));
          const before = layers.map(layer => [...layer.children]);
          if (before.some(nodes => nodes.length === 0)) return false;
          window.dispatchEvent(new Event('scroll'));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return layers.every((layer, index) => layer.children.length === before[index].length
            && [...layer.children].every((node, i) => node === before[index][i]));
        })()`, awaitPromise: true, returnByValue: true,
      }, sessionId);
      if (!retainedChrome.result.value) throw new Error('Unchanged scroll rebuilt page chrome or furniture');

      const sourceZoom = await send('Runtime.evaluate', { expression: `(() => {
        const shell = document.createElement('div');
        shell.className = 'word-shell';
        shell.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:500px;display:block;--editor-zoom:2';
        const source = document.createElement('main'); source.className = 'editor-surface markdown-mode';
        source.style.cssText = 'width:100%;height:100%';
        source.innerHTML = '<div class="markdown-code-editor">Source</div><div class="markdown-preview-pane">Preview</div>';
        shell.appendChild(source); document.body.appendChild(shell);
        const before = source.getBoundingClientRect().width;
        const unscaled = getComputedStyle(source).transform === 'none';
        source.classList.remove('markdown-mode');
        const richScaled = getComputedStyle(source).transform !== 'none';
        source.classList.add('markdown-mode');
        const restored = source.getBoundingClientRect().width === before;
        shell.remove(); return unscaled && richScaled && restored;
      })()`, returnByValue: true }, sessionId);
      if (!sourceZoom.result.value) throw new Error('Document zoom leaked into Markdown mode');

      for (const [width, height] of [[1000, 600], [680, 480], [1280, 720]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
        await new Promise(resolve => setTimeout(resolve, 180));
        const visibility = await send('Runtime.evaluate', { expression: `(() => {
          const dialog = document.getElementById('page-furniture-dialog');
          const buttons = [...dialog.querySelectorAll('.page-furniture-buttons button')];
          return buttons.every(button => {
            const box = button.getBoundingClientRect();
            return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth
              && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === button;
          }) && dialog.scrollHeight <= dialog.clientHeight + 1;
        })()`, returnByValue: true }, sessionId);
        if (!visibility.result.value) throw new Error(`Settings actions clipped at ${width}x${height}`);
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        writeFileSync(join(output, `page-furniture-${width}x${height}.png`), Buffer.from(shot.data, 'base64'));
      }

      await send('Runtime.evaluate', { expression: `
        document.body.innerHTML = window.furniturePrintHtml;
        const style = document.createElement('style');
        style.textContent = '@page { size: 210mm 120mm; margin: 0; } html,body {margin:0;padding:0;} .document-flow {display:block;padding:0;} .document-page {margin:0;box-shadow:none;break-after:page;} .document-page:last-child {break-after:auto;}';
        document.head.appendChild(style);
      ` }, sessionId);
      const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true }, sessionId);
      writeFileSync(join(output, 'page-furniture.pdf'), Buffer.from(pdf.data, 'base64'));
    }
    await send('Target.closeTarget', { targetId });
  }
} finally {
  templateServer?.close();
  for (const entry of pending.values()) clearTimeout(entry.timer);
  browser.kill();
}
