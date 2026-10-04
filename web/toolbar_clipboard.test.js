import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('./toolbar_clipboard.js', import.meta.url), 'utf8');

test('toolbar clipboard clicks focus the editor and use the native copy and cut events', () => {
  const dom = new JSDOM(`<!doctype html>
    <div id="infinite-prosemirror-host"><div class="ProseMirror" contenteditable="true">选中文字</div></div>
    <button data-clipboard-action="copy">复制</button><button data-clipboard-action="cut">剪切</button>`,
    { runScripts: 'outside-only', url: 'https://editor.example/' });
  const calls = [];
  dom.window.document.execCommand = (action) => {
    calls.push({ action, focused: dom.window.document.activeElement.classList.contains('ProseMirror') });
    return true;
  };
  dom.window.eval(script);
  dom.window.document.querySelector('[data-clipboard-action="copy"]').click();
  dom.window.document.querySelector('[data-clipboard-action="cut"]').click();
  assert.deepEqual(calls, [{ action: 'copy', focused: true }, { action: 'cut', focused: true }]);
  dom.window.close();
});

test('browser paste reads text on the click while desktop paste stays on its native bridge', async () => {
  const dom = new JSDOM(`<!doctype html>
    <div id="infinite-prosemirror-host"><div class="ProseMirror" contenteditable="true"></div></div>
    <textarea id="clipboard-paste-bridge" data-native-clipboard="false"></textarea>
    <button data-clipboard-action="paste">粘贴</button>`,
    { runScripts: 'outside-only', url: 'https://editor.example/' });
  const inserted = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { readText: async () => '剪贴板文字' } });
  dom.window.InfiniteWysiwygEditor = { insertText: (host, value) => { inserted.push([host, value]); return { ok: true }; } };
  dom.window.eval(script);
  const button = dom.window.document.querySelector('[data-clipboard-action="paste"]');
  button.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(inserted, [['infinite-prosemirror-host', '剪贴板文字']]);
  dom.window.document.getElementById('clipboard-paste-bridge').dataset.nativeClipboard = 'true';
  button.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(inserted.length, 1);
  dom.window.close();
});
