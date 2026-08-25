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
    received = JSON.parse(event.target.value);
  });

  api.insertText("host", " world");

  assert.deepEqual(received, {
    document_revision: 1,
    edit_revision: 1,
    origin: "source",
    markdown: " worldhello",
  });
  assert.equal(api.getValue("host"), " worldhello");
});

test("requests a system clipboard image through the Dioxus bridge", () => {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<textarea id="clipboard-paste-bridge" data-native-clipboard="true"></textarea>',
  );
  let received = null;
  document.getElementById("clipboard-paste-bridge").addEventListener("input", (event) => {
    received = JSON.parse(event.target.value);
  });
  let completed = null;
  assert.equal(api.requestClipboardImage((path) => completed = path), true);
  assert.equal(typeof received.request_id, "number");
  assert.equal(
    api.completeClipboardImagePaste(received.request_id, "document.assets/pasted-image.png"),
    true,
  );
  assert.equal(completed, "document.assets/pasted-image.png");
});

test("pastes a native clipboard image into Markdown source", () => {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<textarea id="clipboard-paste-bridge" data-native-clipboard="true"></textarea>',
  );
  api.mount("host", "bridge", "正文", 2);
  let request = null;
  document.getElementById("clipboard-paste-bridge").addEventListener("input", (event) => {
    request = JSON.parse(event.target.value);
  });
  const paste = new dom.window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { types: { length: 0 }, getData: () => "" },
  });

  assert.equal(document.querySelector("#host .cm-content").dispatchEvent(paste), false);
  assert.ok(request);
  api.completeClipboardImagePaste(request.request_id, "document.assets/pasted-image.png");
  assert.equal(api.getValue(), "![粘贴的图片](document.assets/pasted-image.png)正文");
});

test("ignores an asynchronous stale snapshot from the same document revision", () => {
  api.mount("host", "bridge", "old", 1);
  api.insertText("host", "new ");

  const result = api.setValue("host", "old", 1);

  assert.equal(result.ok, true);
  assert.equal(result.ignoredSnapshot, true);
  assert.equal(api.getValue("host"), "new old");
  assert.equal(api.undo("host"), true);
  assert.equal(api.getValue("host"), "old");
});

test("does not let another view steal the document bridge", () => {
  document.body.insertAdjacentHTML("beforeend", '<textarea id="other-bridge"></textarea>');
  api.mount("host", "bridge", "正文", 3);
  let primaryEvents = 0;
  let otherEvents = 0;
  document.getElementById("bridge").addEventListener("input", () => primaryEvents += 1);
  document.getElementById("other-bridge").addEventListener("input", () => otherEvents += 1);

  api.initialize("过期快照", 3, "other-bridge");
  api.applyChange(2, 2, "更新", "wysiwyg-input", "input.type", false);

  assert.equal(primaryEvents, 1);
  assert.equal(otherEvents, 0);
  assert.equal(api.getValue(), "正文更新");
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

test("keeps WYSIWYG Markdown changes in the shared undo and redo history", () => {
  api.initialize("原文", 7, "bridge");

  assert.equal(api.replaceAll("修改后的 Markdown", "wysiwyg").changed, true);
  assert.equal(api.getValue(), "修改后的 Markdown");
  assert.equal(api.undo(), true);
  assert.equal(api.getValue(), "原文");
  assert.equal(api.redo(), true);
  assert.equal(api.getValue(), "修改后的 Markdown");
});

test("applies bold and italic toolbar commands in Markdown source mode", () => {
  api.mount("host", "bridge", "Markdown source", 20);
  api.setSelection("host", 0, 8);

  assert.equal(api.command("bold").changed, true);
  assert.equal(api.getValue(), "**Markdown** source");
  assert.equal(api.command("italic").changed, true);
  assert.equal(api.getValue(), "***Markdown*** source");
});

test("toggles quote prefixes from the Markdown source toolbar", () => {
  api.mount("host", "bridge", "第一行\n第二行", 21);
  api.setSelection("host", 0, api.getValue().length);

  assert.equal(api.command("quote").changed, true);
  assert.equal(api.getValue(), "> 第一行\n> 第二行");
  assert.equal(api.command("quote").changed, true);
  assert.equal(api.getValue(), "第一行\n第二行");
});

test("closes bold markers independently inside each selected list item", () => {
  const first = "- 这是一个基于 Markdown 扩展 的富文本引擎原型。";
  const second = "- 这是一个基于 Markdown 扩展 的富文本引擎原型。这是";
  const markdown = `${first}\n${second}`;
  api.mount("host", "bridge", markdown, 22);
  api.setSelection("host", first.indexOf("Markdown"), first.length + 1 + second.indexOf(" 的富文本"));

  assert.equal(api.command("bold").changed, true);
  assert.equal(
    api.getValue(),
    "- 这是一个基于 **Markdown 扩展 的富文本引擎原型。**\n- **这是一个基于 Markdown 扩展** 的富文本引擎原型。这是",
  );

  assert.equal(api.command("bold").changed, true);
  assert.equal(api.getValue(), markdown);
});

test("does not include a trailing unselected line when toggling multiline bold", () => {
  const markdown = "第一行\n第二行\n第三行";
  api.mount("host", "bridge", markdown, 25);
  api.setSelection("host", 0, markdown.indexOf("第三行"));

  assert.equal(api.command("bold").changed, true);
  assert.equal(api.getValue(), "**第一行**\n**第二行**\n第三行");
  assert.equal(api.command("bold").changed, true);
  assert.equal(api.getValue(), markdown);
});

test("converts bullet markers to numbering instead of stacking markers", () => {
  api.mount("host", "bridge", "- 第一项\n- 第二项", 23);
  api.setSelection("host", 0, api.getValue().length);

  assert.equal(api.command("ordered_list").changed, true);
  assert.equal(api.getValue(), "1. 第一项\n2. 第二项");
});

test("numbering full lines does not consume the following blank line", () => {
  const markdown = "- 第一项\n- 第二项\n\n后文";
  api.mount("host", "bridge", markdown, 24);
  api.setSelection("host", 0, markdown.indexOf("\n\n") + 1);

  assert.equal(api.command("ordered_list").changed, true);
  assert.equal(api.getValue(), "1. 第一项\n2. 第二项\n\n后文");
});

test("groups a long WYSIWYG typing run into one undo step", () => {
  api.initialize("", 8, "bridge");
  for (let index = 0; index < 180; index += 1) {
    const position = api.getValue().length;
    const result = api.applyChange(
      position,
      position,
      "字",
      "wysiwyg-input",
      "input.type",
      false
    );
    assert.equal(result.changed, true);
  }

  assert.equal(api.undo(), true);
  assert.equal(api.getValue(), "");
});

test("supports immediate repeated undo and redo for isolated commands", () => {
  api.initialize("A", 9, "bridge");
  for (const value of ["B", "C", "D"]) {
    const result = api.applyChange(
      api.getValue().length,
      api.getValue().length,
      value,
      "wysiwyg-command",
      "input",
      true
    );
    assert.equal(result.changed, true);
  }

  assert.equal(api.undo(), true);
  assert.equal(api.undo(), true);
  assert.equal(api.undo(), true);
  assert.equal(api.getValue(), "A");
  assert.equal(api.redo(), true);
  assert.equal(api.redo(), true);
  assert.equal(api.redo(), true);
  assert.equal(api.getValue(), "ABCD");
});

test("undoes through the first edit after interleaved typing and Enter transactions", () => {
  api.initialize("", 10, "bridge");
  const apply = (insert, userEvent, isolate) => api.applyChange(
    api.getValue().length,
    api.getValue().length,
    insert,
    "wysiwyg-input",
    userEvent,
    isolate
  );

  apply("**a**", "input.type", false);
  apply("\n\n", "input", true);
  apply("**r**", "input.type", false);
  apply("\n\n", "input", true);
  apply("**k**", "input.type", false);

  let undoCount = 0;
  while (api.undo()) undoCount += 1;

  assert.equal(undoCount, 5);
  assert.equal(api.getValue(), "");
});

test("rejects a late initializer from an older document session", () => {
  api.initialize("new document", 12, "bridge");

  const result = api.initialize("old document", 11, "bridge", 0);

  assert.equal(result.staleDocument, true);
  assert.equal(api.getValue(), "new document");
  assert.equal(api.getSnapshot().documentRevision, 12);
});

test("returns a useful error when mount nodes are missing", () => {
  const result = api.mount("missing", "bridge", "", 1);

  assert.equal(result.ok, false);
  assert.match(result.error, /挂载节点/);
});
