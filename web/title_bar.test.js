import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('search panel supports keyboard opening, navigation and closing', () => {
  const dom = new JSDOM(`<header class="title-bar"><button id="title-save"></button><input id="title-search"><div id="title-search-panel" hidden><span id="title-search-count"></span><button id="title-search-prev"></button><button id="title-search-next"></button><button id="title-search-close"></button></div></header>`, { runScripts: 'outside-only' });
  const { window } = dom;
  let saved = 0;
  window.document.getElementById('title-save').onclick = () => saved++;
  window.InfiniteMarkdownEditor = { search: () => ({ index: 0, total: 2 }) };
  window.eval(readFileSync(new URL('./title_bar.js', import.meta.url), 'utf8'));
  const panel = window.document.getElementById('title-search-panel');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  assert.equal(panel.hidden, false);
  const input = window.document.getElementById('title-search');
  assert.equal(window.document.activeElement, input);
  input.value = '正文';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(window.document.getElementById('title-search-count').textContent, '1 / 2 项匹配');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(panel.hidden, true);
  assert.notEqual(window.document.activeElement, input);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  assert.equal(saved, 1);
  window.__infiniteTitleBarAbort.abort();
  dom.window.close();
});
