import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const root = resolve('target/dx/loading_dialog_harness/debug/web/public');
const missing = [];
const output = mkdtempSync(join(tmpdir(), 'infinite-dialog-'));
const server = createServer(async (request, response) => {
  const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const file = path === root ? join(root, 'index.html') : path;
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
    const content = readFileSync(file);
    // Exercise first-mount initialization before the official focus helper loads.
    if (file.includes('focus-trap')) await new Promise(resolve => setTimeout(resolve, 250));
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(content);
  } catch { missing.push(request.url); response.writeHead(404).end(); }
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
    throw new Error(message + ': ' + exceptions.join('\n') + JSON.stringify({missing, dom: await evaluate(`({focus: document.activeElement?.outerHTML.slice(0,300), trap: typeof window.createFocusTrap, scripts: [...document.scripts].map(s=>s.src)})`)}));
  };
  const visible = `!!document.querySelector('.editor-progress-backdrop[data-state="open"] [role="dialog"]')`;
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
  await until(`!!document.getElementById('begin')`, 'Dioxus failed to mount');
  // A short operation must complete without ever mounting a dialog.
  await evaluate(`document.getElementById('begin').click()`);
  await pause(400);
  if (await evaluate(visible)) throw new Error('Dialog appeared before the one-second threshold');
  await evaluate(`document.getElementById('finish').click()`);
  await pause(750);
  if (await evaluate(visible)) throw new Error('A stale delay opened the dialog after completion');

  await evaluate(`document.getElementById('begin').click()`);
  await pause(900);
  if (await evaluate(visible)) throw new Error('Dialog appeared before one second');
  await until(visible, 'Loading did not open');
  await until(`document.activeElement?.textContent === '后台继续'`, 'Dialog did not capture focus');
  const geometry = await evaluate(`(() => { const r = document.querySelector('[role="dialog"]').getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2, width: document.documentElement.clientWidth }; })()`);
  if (Math.abs(geometry.x - geometry.width/2) > 2 || Math.abs(geometry.y - 400) > 2) throw new Error('Dialog is not viewport-centered');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
  await until(`document.querySelector('[role="dialog"]').contains(document.activeElement)`, 'Tab escaped modal');
  await evaluate(`window.scrollTo(0, 900)`); await pause(100);
  if (!await evaluate(`Math.abs(document.querySelector('[role="dialog"]').getBoundingClientRect().y + document.querySelector('[role="dialog"]').getBoundingClientRect().height/2 - 400) < 2`)) throw new Error('Dialog moved with document scroll');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(output, 'dialog.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate(`document.querySelector('[role="dialog"] button').click()`);
  await until(`!(${visible})`, 'Background continue did not dismiss');
  if (!await evaluate(`document.getElementById('task-state').textContent === 'working'`)) throw new Error('Dismissal incorrectly completed the job');
  await evaluate(`document.getElementById('finish').click()`);
  await until(`document.getElementById('task-state').textContent === 'idle'`, 'Completion did not arrive');
  await pause(100);
  await evaluate(`document.getElementById('begin').click()`);
  await until(visible, 'Next load stayed dismissed');
  await evaluate(`document.getElementById('finish').click()`);
  await until(`!(${visible})`, 'Completion did not close dialog');
  await pause(100);
  await evaluate(`document.getElementById('begin').click()`);
  await until(visible, 'Third load failed to open');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
  await until(`!(${visible})`, 'Escape did not dismiss');
  await evaluate(`document.getElementById('finish').click()`);
  if (exceptions.length) throw new Error(exceptions.join('\n'));
  console.log('dialog', { ok: true, delayedOneSecond: true, staleTimerCancelled: true, focusTrap: true, centeredWhileScrolling: true, backgroundContinue: true, completion: true, reopen: true, escape: true }, join(output, 'dialog.png'));
} finally {
  rejectAll(new Error('Test ended'));
  browser.kill();
  await new Promise(resolve => server.close(resolve));
}
