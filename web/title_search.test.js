import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { TextSelection } from "prosemirror-state";

const dom = new JSDOM(
  '<!doctype html><main class="editor-surface"><div id="wysiwyg"></div></main><textarea id="bridge"></textarea>',
  { pretendToBeVisual: true },
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

if (!dom.window.Range.prototype.getClientRects) {
  dom.window.Range.prototype.getClientRects = () => [];
}
if (!dom.window.Range.prototype.getBoundingClientRect) {
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
}

await import("./editor.js");
const { WysiwygBridgeSession } = await import("./wysiwyg/bridge/session.js");
const { remarkReferenceBackend } = await import("./wysiwyg/markdown/backend.js");
const documentSession = window.InfiniteMarkdownEditor;


const { installWysiwygBridge } = await import('./wysiwyg/bridge.js');
test('rich search crosses inline formatting without changing content or history', () => {
  const markdown = '中**文**测试 中文测试';
  const api = installWysiwygBridge(window);
  assert.equal(api.mount({ host_id: 'wysiwyg', bridge_id: 'bridge', markdown,
    ast: remarkReferenceBackend.parse(markdown), document_revision: 1, edit_revision: 0 }).ok, true);
  assert.deepEqual(api.search('wysiwyg', '中文', 0), { index: 0, total: 2 });
  assert.deepEqual(api.search('wysiwyg', '中文', -1), { index: 1, total: 2 });
  assert.deepEqual(api.search('wysiwyg', '不存在', 0), { index: -1, total: 0 });
  assert.equal(api.prepareModeSwitch('wysiwyg').markdown, markdown);
  api.destroy('wysiwyg');
});
test('replace all is literal and can be undone as one rich-text operation', () => {
  const markdown = '中文 中文 **保留格式**';
  const api = installWysiwygBridge(window);
  assert.equal(api.mount({ host_id: 'wysiwyg', bridge_id: 'bridge', markdown,
    ast: remarkReferenceBackend.parse(markdown), document_revision: 20, edit_revision: 0 }).ok, true);
  assert.equal(api.replaceMatches('wysiwyg', '中文', '$&', 0, true).count, 2);
  assert.equal(api.prepareModeSwitch('wysiwyg').markdown, String.raw`\$& \$& **保留格式**`);
  api.command('wysiwyg', 'undo');
  assert.equal(api.prepareModeSwitch('wysiwyg').markdown, markdown);
  assert.equal(api.replaceMatches('wysiwyg', '中文', '', 1, false).count, 1);
  assert.equal(api.search('wysiwyg', '中文', 0).total, 1);
  api.destroy('wysiwyg');
});
test('source replace all preserves literal replacement and one-step undo', () => {
  documentSession.initialize('中文 中文', 30);
  assert.equal(documentSession.replaceMatches('中文', '$&', 0, true).count, 2);
  assert.equal(documentSession.getValue(), '$& $&');
  documentSession.undo();
  assert.equal(documentSession.getValue(), '中文 中文');
  assert.equal(documentSession.replaceMatches('', 'x', 0, true).count, 0);
});
test.after(() => { documentSession.destroy('source'); dom.window.close(); });
