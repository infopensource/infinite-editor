import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const output = mkdtempSync(join(tmpdir(), 'infinite-input-profile-'));
const bundle = await build({ entryPoints: ['web/wysiwyg/input_latency_browser.js'], bundle: true, write: false, format: 'iife' });
const css = readFileSync('assets/styling/wysiwyg_core.css', 'utf8');
const file = join(output, 'profile.html');
writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>
body {margin:0;background:#eef2f7} .document-page {box-sizing:border-box;width:210mm;min-height:297mm;padding:20mm;margin:20px auto;background:white}
${css}</style><div class="infinite-pm-surface paged"><article class="document-page infinite-pm-page" style="--page-width:210mm;--page-height:297mm;--page-padding-top:20mm;--page-padding-bottom:20mm;--page-padding-left:20mm;--page-padding-right:20mm"><div id="host" class="infinite-pm-host"></div></article></div><script>${bundle.outputFiles[0].text}</script>`);
if (process.argv.includes('--build-only')) { console.log(file); process.exit(0); }
const browser = spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--remote-debugging-pipe', `--user-data-dir=${join(output, 'profile')}`], {stdio:['ignore','ignore','pipe','pipe','pipe']});
let id = 0, buffer = '';
const pending = new Map();
browser.stdio[4].on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    const entry = pending.get(message.id);
    if (!entry) continue;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const sequence = ++id;
    const timer = setTimeout(() => {pending.delete(sequence);reject(new Error(`Timed out: ${method}`));}, 90000);
    pending.set(sequence, {resolve,reject,timer});
    browser.stdio[3].write(JSON.stringify({id:sequence,method,params,sessionId})+'\0');
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reports = [];
try {
  const {targetId} = await send('Target.createTarget', {url:'about:blank'});
  const {sessionId} = await send('Target.attachToTarget', {targetId,flatten:true});
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true}, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', {width:1100,height:800,deviceScaleFactor:1,mobile:false}, sessionId);
  await send('Page.navigate', {url:pathToFileURL(file).href}, sessionId);
  while (!await evaluate('!!window.inputProfiler')) await pause(50);
  for (const characters of [32768, 131072, 524288]) {
    for (const mode of ['paged', 'seamless']) {
      const document = await evaluate(`inputProfiler.mount(${characters}, '${mode}')`);
      for (const atEnd of [false, true]) {
        await evaluate(`inputProfiler.select(${atEnd})`);
        for (let index = 0; index < 24; index++) {
          await send('Input.dispatchKeyEvent', {type:'keyDown',key:'x',code:'KeyX',text:'x',windowsVirtualKeyCode:88}, sessionId);
          await send('Input.dispatchKeyEvent', {type:'keyUp',key:'x',code:'KeyX',windowsVirtualKeyCode:88}, sessionId);
          await pause(80);
        }
        const report = {characters,mode,atEnd,document,...await evaluate('inputProfiler.report()')};
        if (report.inputToPaint.count !== 24) throw new Error(`Expected 24 input samples, received ${report.inputToPaint.count}`);
        reports.push(report);
        writeFileSync(join(output,'report.json'),JSON.stringify(reports,null,2));
        console.log(JSON.stringify(report));
      }
    }
  }
  console.log(join(output,'report.json'));
} finally {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  browser.kill();
}
