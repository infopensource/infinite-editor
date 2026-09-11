import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { normalizeBlockWhitespace } from './document_renderer/whitespace.js';

test('list formatting newlines are removed without losing authored inline whitespace', () => {
  const dom = new JSDOM();
  const root = dom.window.document.createElement('div');
  root.className = 'markdown-rendered-html';
  root.innerHTML = '<ul>\n<li>\n<p>第一项  正文\n软换行</p>\n</li>\n<li>第二项  内容\n<ul>\n<li>A</li>\n<li>B</li>\n</ul>\n</li>\n<li>\n<p>第三项</p>\n<p>第二段</p>\n</li>\n</ul>\n<pre><code>  code\n\n next\n</code></pre>\n';
  const paragraph = root.querySelector('p').textContent;
  const code = root.querySelector('code').textContent;
  normalizeBlockWhitespace(root);
  assert.equal(root.querySelector('li').firstChild.nodeName, 'P');
  assert.equal(root.querySelector('ul').childNodes.length, 3);
  assert.equal(root.querySelectorAll('li')[1].firstChild.data, '第二项  内容');
  assert.equal(root.querySelector('p').textContent, paragraph);
  assert.equal(root.querySelector('code').textContent, code);
  const html = root.innerHTML;
  normalizeBlockWhitespace(root);
  assert.equal(root.innerHTML, html);
  dom.window.close();
});
