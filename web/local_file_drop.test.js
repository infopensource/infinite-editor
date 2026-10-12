import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { handleLocalFileDrop } from "./local_file_drop.js";
import { MinimalWysiwygEditor } from "./wysiwyg/editor.js";

function drag(text, type = "text/plain") {
  return { dataTransfer: { files: [], types: [type], getData: format => format === type ? text : "" } };
}

test("recognizes Linux file-manager URLs before the editor inserts them", () => {
  assert.equal(handleLocalFileDrop(drag("file:///home/user/My%20Document.docx", "text/uri-list")), true);
  assert.equal(handleLocalFileDrop(drag("# files\nfile:///home/user/One.docx\nfile:///home/user/Two.pdf\n", "text/uri-list")), true);
  assert.equal(handleLocalFileDrop(drag("", "text/plain"), "file:///home/user/Document.docx"), true);
});

test("ordinary text and web URLs remain editable drop content", () => {
  assert.equal(handleLocalFileDrop(drag("ordinary text")), false);
  assert.equal(handleLocalFileDrop(drag("https://example.com/document.docx", "text/uri-list")), false);
  assert.equal(handleLocalFileDrop(drag("file:///home/user/A.docx\nordinary text")), false);
});

test("WYSIWYG forwards a file URL instead of adding it to the document", () => {
  const dom = new JSDOM('<div id="host"></div><textarea id="desktop-file-drop-bridge"></textarea>', { pretendToBeVisual: true });
  const globals = ["window", "document", "navigator", "Node", "NodeFilter", "HTMLElement", "Element", "MutationObserver", "DOMParser", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"];
  const previous = Object.fromEntries(globals.map(key => [key, globalThis[key]]));
  for (const key of Object.keys(previous)) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  try {
    const host = dom.window.document.getElementById("host");
    const editor = new MinimalWysiwygEditor(host, "Original");
    const bridge = dom.window.document.getElementById("desktop-file-drop-bridge");
    let received = null;
    bridge.addEventListener("input", () => { received = JSON.parse(bridge.value); });
    let bubbledDrops = 0;
    host.addEventListener("drop", () => { bubbledDrops++; });
    const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: drag("file:///home/user/My%20Document.docx", "text/uri-list").dataTransfer });
    editor.view.posAtCoords = () => ({ pos: 1, inside: 0 });
    editor.view.dom.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(editor.state.doc.textContent, "Original");
    assert.deepEqual(received, ["file:///home/user/My%20Document.docx"]);
    assert.equal(bubbledDrops, 0);

    const nativeFileDrop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(nativeFileDrop, "dataTransfer", { value: {
      files: [{ name: "Document.docx" }], types: ["Files"], getData: () => "",
    } });
    editor.view.dom.dispatchEvent(nativeFileDrop);
    assert.equal(nativeFileDrop.defaultPrevented, true);
    assert.equal(editor.state.doc.textContent, "Original");
    assert.equal(bubbledDrops, 1);
    editor.destroy();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});
