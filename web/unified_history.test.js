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

function applyRustProjection(session) {
  const snapshot = documentSession.getSnapshot();
  return session.setDocument({
    ast: remarkReferenceBackend.parse(snapshot.markdown),
    markdown: snapshot.markdown,
    documentRevision: snapshot.documentRevision,
    editRevision: snapshot.editRevision,
    selection: snapshot.selection,
  });
}

test.after(() => {
  documentSession.destroy("source");
  dom.window.close();
});

test("source and WYSIWYG edits share one chronological undo and redo history", () => {
  const bridge = document.getElementById("bridge");
  let wysiwyg = new WysiwygBridgeSession({
    host: document.getElementById("wysiwyg"),
    bridge,
    ast: remarkReferenceBackend.parse("原文"),
    markdown: "原文",
    documentRevision: 1,
    documentSession,
    changeDebounceMs: 1000,
  });

  wysiwyg.editor.view.dispatch(wysiwyg.editor.state.tr.setSelection(
    TextSelection.create(wysiwyg.editor.state.doc, 3),
  ));
  wysiwyg.editor.view.dispatch(wysiwyg.editor.state.tr.insertText("一"));
  wysiwyg.flushChange("wysiwyg-input");
  assert.equal(documentSession.getValue(), "原文一");

  const scroller = document.querySelector(".editor-surface");
  scroller.scrollTop = 240;
  assert.equal(wysiwyg.command("undo").changed, true);
  assert.equal(applyRustProjection(wysiwyg).preservedHistory, true);
  assert.equal(wysiwyg.editor.getMarkdown(), "原文");
  assert.equal(wysiwyg.editor.state.selection.head, 3);
  assert.equal(wysiwyg.editor.view.hasFocus(), true);

  assert.equal(wysiwyg.command("redo").changed, true);
  assert.equal(applyRustProjection(wysiwyg).preservedHistory, true);
  assert.equal(wysiwyg.editor.getMarkdown(), "原文一");

  wysiwyg.destroy();
  document.body.innerHTML = '<div id="source"></div><textarea id="bridge"></textarea>';
  assert.equal(documentSession.mount("source", "bridge", "原文一", 1).ok, true);
  documentSession.insertText("source", "源码");
  assert.equal(documentSession.getValue(), "原文一源码");
  documentSession.detach("source");

  document.body.innerHTML = '<main class="editor-surface"><div id="wysiwyg"></div></main><textarea id="bridge"></textarea>';
  const current = documentSession.getSnapshot();
  wysiwyg = new WysiwygBridgeSession({
    host: document.getElementById("wysiwyg"),
    bridge: document.getElementById("bridge"),
    ast: remarkReferenceBackend.parse(current.markdown),
    markdown: current.markdown,
    documentRevision: current.documentRevision,
    editRevision: current.editRevision,
    documentSession,
  });

  assert.equal(wysiwyg.command("undo").changed, true);
  applyRustProjection(wysiwyg);
  assert.equal(wysiwyg.editor.getMarkdown(), "原文一");
  assert.equal(wysiwyg.command("undo").changed, true);
  applyRustProjection(wysiwyg);
  assert.equal(wysiwyg.editor.getMarkdown(), "原文");
  wysiwyg.destroy();
});

test("attaching a source view does not reset the persistent history", () => {
  document.body.innerHTML = '<div id="source"></div><textarea id="bridge"></textarea>';
  documentSession.initialize("A", 2, "bridge", 0);
  documentSession.replaceAll("AB", "wysiwyg-input", "input.type", false, {
    anchor: 2,
    head: 2,
  });

  documentSession.mount("source", "bridge", "AB", 2);
  assert.equal(documentSession.undo(), true);
  assert.equal(documentSession.getValue(), "A");
  documentSession.detach("source");
});

test("grouped edits restore matching rich selections through rapid history and reject old echoes", () => {
  document.body.innerHTML = '<main class="editor-surface"><div id="wysiwyg"></div></main><textarea id="bridge"></textarea>';
  const session = new WysiwygBridgeSession({
    host: document.getElementById("wysiwyg"),
    bridge: document.getElementById("bridge"),
    ast: remarkReferenceBackend.parse("abcd"),
    markdown: "abcd",
    documentRevision: 3,
    documentSession,
  });
  session.editor.view.dispatch(session.editor.state.tr.setSelection(
    TextSelection.create(session.editor.state.doc, 2, 4),
  ));
  session.editor.view.dispatch(session.editor.state.tr.insertText("X"));
  session.flushChange();
  session.editor.view.dispatch(session.editor.state.tr.insertText("Y"));
  session.flushChange();
  const finalSelection = session.editor.state.selection.toJSON();
  const finalText = session.editor.getMarkdown();
  session.command("undo");
  assert.equal(session.editor.getMarkdown(), documentSession.getValue());
  assert.equal(session.editor.getMarkdown(), "abcd");
  assert.deepEqual(session.editor.state.selection.toJSON(), { type: "text", anchor: 2, head: 4 });
  const old = documentSession.getSnapshot();
  session.command("redo");
  assert.equal(session.editor.getMarkdown(), finalText);
  assert.deepEqual(session.editor.state.selection.toJSON(), finalSelection);
  assert.equal(session.setDocument({ ...old, ast: remarkReferenceBackend.parse(old.markdown) }).stale, true);
  assert.equal(session.editor.getMarkdown(), finalText);
  session.destroy();
});

test("header and footer styles undo independently between body edits and survive remount", () => {
  document.body.innerHTML = '<main data-page-furniture="" class="editor-surface"><div id="wysiwyg"></div></main><textarea id="bridge"></textarea>';
  const session = new WysiwygBridgeSession({
    host: document.getElementById('wysiwyg'), bridge: document.getElementById('bridge'),
    ast: remarkReferenceBackend.parse('Body'), markdown: 'Body', documentRevision: 10, documentSession,
  });
  const original = documentSession.getPageFurniture();
  const settings = structuredClone(original);
  settings.header.enabled = true;
  settings.header.left = [{ kind: 'text', value: 'Header' }];
  settings.header.style.color = '#ff0000';
  settings.footer.enabled = true;
  settings.footer.center = [{ kind: 'page' }, { kind: 'text', value: '/' }, { kind: 'pages' }];
  settings.footer.style.font_size_pt = 12;
  assert.equal(documentSession.setPageFurniture(settings).changed, true);
  const liveState = session.editor.state;
  assert.equal(session.command('undo').changed, true);
  assert.equal(session.editor.state, liveState, 'Metadata undo must not replace the editor state');
  assert.deepEqual(documentSession.getPageFurniture(), original);
  session.command('redo');
  assert.deepEqual(documentSession.getPageFurniture(), settings);
  session.editor.view.dispatch(session.editor.state.tr.insertText('Edited'));
  session.flushChange();
  session.command('undo');
  assert.equal(session.editor.getMarkdown(), 'Body');
  assert.deepEqual(documentSession.getPageFurniture(), settings);
  session.command('undo');
  assert.deepEqual(documentSession.getPageFurniture(), original);
  session.command('redo');
  assert.deepEqual(documentSession.getPageFurniture(), settings);
  const message = JSON.parse(document.getElementById('bridge').value);
  assert.deepEqual(message.page_furniture, settings);
  session.destroy();
  documentSession.initialize('Body', 10, 'bridge');
  assert.deepEqual(documentSession.getPageFurniture(), settings);
  const returned = documentSession.getPageFurniture();
  returned.header.style.font_size_pt = 36;
  assert.equal(documentSession.getPageFurniture().header.style.font_size_pt, 9);
});
