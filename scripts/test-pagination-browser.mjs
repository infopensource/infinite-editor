import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv[2] === 'dialog') {
  await import('./test-loading-dialog-browser.mjs');
  process.exit(process.exitCode ?? 0);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const output = mkdtempSync(join(tmpdir(), 'infinite-pagination-'));
const scenarios = process.argv.length > 2 ? process.argv.slice(2) : ['nested', 'table', 'table-long-cell', 'table-long-header', 'mixed', 'math-input'];
const bundle = await build({
  entryPoints: [resolve(root, scenarios.includes('selection') ? 'web/wysiwyg/selection_browser.js' : scenarios.includes('performance') ? 'web/wysiwyg/performance_browser.js' : 'web/wysiwyg/pagination_browser.js')],
  loader: { '.md': 'text', '.png': 'dataurl' }, bundle: true, write: false, format: 'iife',
});
const css = readFileSync(resolve(root, 'assets/styling/wysiwyg_core.css'), 'utf8')
  + readFileSync(resolve(root, 'assets/math.bundle.css'), 'utf8');
const math = readFileSync(resolve(root, 'assets/math.bundle.js'), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><style>
* { box-sizing: border-box; } body { margin: 0; background: #eef2f7; }
.document-page { width: var(--page-width); min-height: var(--page-height); padding: var(--page-padding-top) var(--page-padding-right) var(--page-padding-bottom) var(--page-padding-left); margin: 20px auto; border: 1px solid #d1d5db; background: white; }
${css}</style><div class="infinite-pm-surface paged"><article class="document-page infinite-pm-page" style="--page-width:210mm;--page-height:120mm;--page-padding-top:15mm;--page-padding-bottom:15mm;--page-padding-left:22mm;--page-padding-right:22mm"><div id="host" class="infinite-pm-host"></div></article></div><pre id="result"></pre><script>${math}</script><script>${bundle.outputFiles[0].text}</script>`;
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
try {
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
    await send('Target.closeTarget', { targetId });
  }
} finally {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  browser.kill();
}
