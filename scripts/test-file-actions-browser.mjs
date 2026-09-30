import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const root = resolve('target/dx/infinite-editor/debug/web/public');
const missing = [];
const output = mkdtempSync(join(tmpdir(), 'infinite-file-actions-'));
const server = createServer(async (request, response) => {
  const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const file = path === root ? join(root, 'index.html') : path;
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
    const content = readFileSync(file);
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

  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
  await until(`!!document.querySelector('.ProseMirror') && !!window.InfiniteMarkdownEditor?.getSnapshot() && !document.querySelector('[data-slot="dialog-content"]')`, 'Editor did not initialize');
  await until(`!!document.getElementById('title-auto-save')`, 'AutoSave did not mount');
  const toggle = `document.getElementById('title-auto-save')`;
  if (await evaluate(`${toggle}.disabled`)) throw new Error('AutoSave is disabled for an empty untitled document');
  await evaluate(`${toggle}.click()`);
  await until(`${toggle}.getAttribute('aria-checked') === 'true'`, 'Cannot enable AutoSave without a path');
  const fileTab = `[...document.querySelectorAll('.tabs-row button')].find(button => button.textContent === '文件')`;
  const enterFile = async () => {
    await evaluate(`${fileTab}.click()`);
    await until(`!!document.getElementById('file-new')`, 'Missing New action');
  };
  const initialRevision = await evaluate(`window.InfiniteMarkdownEditor.getSnapshot().documentRevision`);
  await enterFile();
  await evaluate(`document.getElementById('file-new').click()`);
  await until(`!!document.querySelector('.ProseMirror') && window.InfiniteMarkdownEditor.getSnapshot().documentRevision > ${initialRevision}`, 'Blank New did not reset session');
  if (await evaluate(`!!document.getElementById('new-document-dialog')`)) throw new Error('Blank document prompted to discard');
  await evaluate(`document.querySelector('.doc-title-trigger').click()`);
  await until(`!!document.querySelector('.doc-title-input')`, 'Title input did not mount');
  await evaluate(`(() => { const input = document.querySelector('.doc-title-input'); input.value = '旧文档标题'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
  await until(`document.querySelector('.doc-title-trigger')?.textContent.includes('旧文档标题')`, 'Rename did not apply');
  await evaluate(`document.querySelector('.ProseMirror').focus()`);
  await send('Input.insertText', { text: '需要保留的内容' }, sessionId);
  // Immediately leave the editor, exercising its final pending change.
  await enterFile();
  await evaluate(`document.getElementById('file-new').click()`);
  await until(`!!document.getElementById('new-document-dialog')`, 'Missing unsaved-changes confirmation');
  if (!await evaluate(`(() => {
    const dialog = document.getElementById('new-document-dialog');
    const header = dialog.querySelector('.dialog-header').getBoundingClientRect();
    const footer = dialog.querySelector('.dialog-footer').getBoundingClientRect();
    return !dialog.querySelector('.dialog-body, .new-document-feedback') && footer.top - header.bottom < 3;
  })()`)) throw new Error('Empty status area leaves a gap in New confirmation');
  await evaluate(`document.getElementById('new-cancel').click()`);
  await until(`!document.getElementById('new-document-dialog')`, 'Cancel did not dismiss');
  if (!await evaluate(`window.InfiniteMarkdownEditor.getValue().includes('需要保留的内容')`)) throw new Error('Cancel lost content');
  await evaluate(`document.getElementById('file-new').click()`);
  await until(`!!document.getElementById('new-save')`, 'Confirmation did not reopen');
  await evaluate(`document.getElementById('new-save').click()`);
  await until(`document.getElementById('new-document-dialog')?.textContent.includes('不支持') && !document.getElementById('new-save').disabled`, 'Unsupported web save did not preserve dialog');
  if (!await evaluate(`window.InfiniteMarkdownEditor.getValue().includes('需要保留的内容')`)) throw new Error('Failed save lost content');
  await evaluate(`document.getElementById('new-cancel').click()`);
  await until(`!document.getElementById('new-document-dialog')`, 'Cannot cancel after save failure');
  await evaluate(`document.getElementById('file-new').click()`);
  await until(`!!document.getElementById('new-document-dialog')`, 'Cannot reopen after save failure');
  if (await evaluate(`!!document.querySelector('#new-document-dialog .new-document-feedback')`)) throw new Error('Old save error leaked into a new confirmation');
  const oldRevision = await evaluate(`window.InfiniteMarkdownEditor.getSnapshot().documentRevision`);
  await evaluate(`document.getElementById('new-discard').click()`);
  await until(`!!document.querySelector('.ProseMirror') && window.InfiniteMarkdownEditor.getSnapshot().documentRevision > ${oldRevision}`, 'Discard did not create a new session');
  if (!await evaluate(`window.InfiniteMarkdownEditor.getValue() === '' && !window.InfiniteMarkdownEditor.historyStatus().undo && !window.InfiniteMarkdownEditor.historyStatus().redo`)) throw new Error('New retained old content or history');
  if (!await evaluate(`document.querySelector('.doc-title-trigger').textContent.includes('未命名文档')`)) throw new Error('New retained old title');
  if (!await evaluate(`${toggle}.getAttribute('aria-checked') === 'true' && !${toggle}.disabled`)) throw new Error('New lost AutoSave preference');
  for (const width of [1200, 760, 520, 400]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    // Include desktop window buttons when inspecting the production title bar.
    await evaluate(`document.querySelector('.title-right').hidden = false`);
    await pause(80);
    const fits = await evaluate(`(() => {
      const switchRect = ${toggle}.getBoundingClientRect();
      const save = document.getElementById('title-save').getBoundingClientRect();
      const close = document.querySelector('.window-btn.close').getBoundingClientRect();
      return switchRect.left >= 0 && switchRect.right <= save.left && save.right <= innerWidth && close.right <= innerWidth;
    })()`);
    if (!fits) throw new Error(`Title controls overlap at ${width}px: ` + JSON.stringify(await evaluate(`Array.from(document.querySelectorAll('.title-bar, .title-left, .title-center, .title-right, .window-btn')).map(el => ({class: el.className, rect: el.getBoundingClientRect().toJSON(), grid: getComputedStyle(el).gridTemplateColumns, minWidth: getComputedStyle(el).minWidth}))`)));
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(output, `title-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  if (exceptions.length || missing.length) throw new Error(JSON.stringify({ exceptions, missing }));
  console.log(JSON.stringify({ ok: true, checks: ['untitled AutoSave toggle', 'blank New', 'cancel New', 'save failure preserves content', 'discard resets history', 'responsive title bar'], output }));
} finally {
  browser.kill();
  server.close();
}
