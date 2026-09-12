import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const root = resolve('target/dx/infinite-editor/debug/web/public');
const missing = [];
const output = mkdtempSync(join(tmpdir(), 'infinite-furniture-entry-'));
let delayedBundle = 'editor.bundle';
const server = createServer(async (request, response) => {
  const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const file = path === root ? join(root, 'index.html') : path;
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
    const content = readFileSync(file);
    if (file.includes(delayedBundle)) await new Promise(resolve => setTimeout(resolve, 700));
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(content);
  } catch { if (!request.url.startsWith('/_dioxus') && request.url !== '/favicon.ico') missing.push(request.url); response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = spawn(process.env.CHROMIUM || 'chromium', [
  '--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-pipe',
  `--user-data-dir=${join(output, 'profile')}`,
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let sequence = 0, buffer = '', stderr = '';
const pending = new Map(), exceptions = [];
function rejectAll(error) {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
  pending.clear();
}
browser.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
browser.on('error', rejectAll);
browser.on('exit', () => rejectAll(new Error(stderr || 'Browser exited')));
browser.stdio[3].on('error', rejectAll);
browser.stdio[4].on('error', rejectAll);
browser.stdio[4].setEncoding('utf8');
browser.stdio[4].on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    const entry = pending.get(message.id);
    if (!entry) continue;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Evaluation failed');
    return result.result.value;
  };
  const until = async (expression, message) => {
    for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await pause(50); }
    throw new Error(message + ': ' + exceptions.join('\n') + JSON.stringify({missing, dom: await evaluate(`({body: document.body.innerText.slice(-1800), snapshot: window.InfiniteMarkdownEditor?.getSnapshot(), rich: window.InfiniteWysiwygEditor?.prepareModeSwitch('infinite-prosemirror-host'), trap: typeof window.createFocusTrap, scripts: [...document.scripts].map(s=>s.src)})`)}));
  };

  await send('Network.enable', {}, sessionId);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.editorReadyOrder = [];
    for (const name of ['markdown', 'wysiwyg']) window.addEventListener('infinite-' + name + '-editor-ready', () => window.editorReadyOrder.push(name));
  ` }, sessionId);
  for (const delayed of ['editor.bundle', 'wysiwyg.bundle']) {
    delayedBundle = delayed;
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
    await until(`window.InfiniteMarkdownEditor?.getSnapshot()?.documentRevision != null`, 'Document did not initialize');
    const firstReady = await evaluate(`window.editorReadyOrder[0]`);
    if (firstReady !== (delayed === 'editor.bundle' ? 'wysiwyg' : 'markdown')) throw new Error('Test did not exercise the intended load order');
    await evaluate(`[...document.querySelectorAll('.tabs-row button')].find(button => button.textContent === '插入').click()`);
    await until(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === '页眉页脚')`, 'Insert ribbon did not mount');
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === '页眉页脚').click()`);
    await until(`!!document.querySelector('#page-furniture-dialog[open]')`, 'Page furniture entry did not open');
    if (!await evaluate(`document.querySelectorAll('#page-furniture-dialog .page-furniture-text-editor').length === 6`)) throw new Error('Missing text editors');
    await evaluate(`document.querySelector('#page-furniture-dialog .page-furniture-cancel').click()`);
    await until(`!document.getElementById('page-furniture-dialog')`, 'Cancel did not close');
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === '页眉页脚').click()`);
    await until(`!!document.querySelector('#page-furniture-dialog[open]')`, 'Reopening failed');
    if (exceptions.length || missing.length) throw new Error(JSON.stringify({ exceptions, missing }));
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(output, delayed + '-entry.png'), Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({ ok: true, entry: 'production Dioxus ribbon', delayed, output }));
  }
} finally {
  browser.kill();
  server.close();
}
