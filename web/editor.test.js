import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<!doctype html><div id="host"></div><textarea id="bridge"></textarea>',
  { pretendToBeVisual: true }
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.DOMRect = dom.window.DOMRect;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

if (!dom.window.Range.prototype.getClientRects) {
  dom.window.Range.prototype.getClientRects = () => [];
}
if (!dom.window.Range.prototype.getBoundingClientRect) {
  dom.window.Range.prototype.getBoundingClientRect = () => ({
    bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0
  });
}

await import("./editor.js");
const api = window.InfiniteMarkdownEditor;

function resetDom() {
  api.destroy("host");
  document.body.innerHTML = '<div id="host"></div><textarea id="bridge"></textarea>';
}

test.beforeEach(resetDom);
test.after(() => {
  api.destroy("host");
  dom.window.close();
});

test("mounts CodeMirror with the initial Markdown", () => {
  const result = api.mount("host", "bridge", "# 标题", 1);

  assert.equal(result.ok, true);
  assert.equal(api.getValue("host"), "# 标题");
  assert.ok(document.querySelector("#host .cm-editor"));
});

test("sends user edits through the Dioxus bridge", () => {
  api.mount("host", "bridge", "hello", 1);
  let received = null;
  document.getElementById("bridge").addEventListener("input", (event) => {
    received = event.target.value;
  });

  api.insertText("host", " world");

  assert.equal(received, " worldhello");
  assert.equal(api.getValue("host"), " worldhello");
});

test("synchronizes external content without adding an undo step", () => {
  api.mount("host", "bridge", "old", 1);

  const result = api.setValue("host", "external", 1);

  assert.equal(result.ok, true);
  assert.equal(api.getValue("host"), "external");
  assert.equal(api.undo("host"), false);
});

test("switching document revisions clears the previous undo history", () => {
  api.mount("host", "bridge", "document A", 1);
  api.insertText("host", "edited ");
  assert.equal(api.undo("host"), true);
  api.insertText("host", "edited again ");

  const result = api.setValue("host", "document B", 2);

  assert.equal(result.ok, true);
  assert.equal(api.getValue("host"), "document B");
  assert.equal(api.undo("host"), false);
  assert.equal(api.getValue("host"), "document B");
});

test("returns a useful error when mount nodes are missing", () => {
  const result = api.mount("missing", "bridge", "", 1);

  assert.equal(result.ok, false);
  assert.match(result.error, /挂载节点/);
});
