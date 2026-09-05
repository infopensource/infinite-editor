import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { redo, undo } from "prosemirror-history";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { blockCommands } from "./wysiwyg/commands/blocks.js";
import { listCommands } from "./wysiwyg/commands/lists.js";
import { toolbarCommands } from "./wysiwyg/commands/toolbar.js";
import { WysiwygBridgeSession } from "./wysiwyg/bridge.js";
import { remarkReferenceBackend } from "./wysiwyg/markdown/backend.js";
import { MarkdownPositionMapper } from "./wysiwyg/markdown/position_mapper.js";
import {
  calculatePaginationBoundaries,
  calculatePaginationLayout,
  paginationKey,
  setPaginationBoundaries,
} from "./wysiwyg/plugins/pagination.js";
import {
  MinimalWysiwygEditor,
  createEditorState,
  parseMarkdown,
  serializeMarkdown,
  wysiwygSchema,
} from "./wysiwyg/editor.js";

const dom = new JSDOM('<!doctype html><div id="host"></div>', {
  pretendToBeVisual: true,
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Event = dom.window.Event;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.CompositionEvent = dom.window.CompositionEvent;
globalThis.InputEvent = dom.window.InputEvent;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

if (!dom.window.Range.prototype.getClientRects) {
  dom.window.Range.prototype.getClientRects = () => [];
}
if (!dom.window.Range.prototype.getBoundingClientRect) {
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
}

const nestedListMarkdown = `1. A
   1. A.1
      1. A.1.1
      2. A.1.2
   2. A.2
2. B`;

let activeEditor = null;

test.beforeEach(() => {
  activeEditor?.destroy();
  activeEditor = null;
  document.body.innerHTML = '<div id="host"></div>';
});

test.after(() => {
  activeEditor?.destroy();
  dom.window.close();
});

function textPosition(documentNode, text, offset = 0) {
  let found = null;
  documentNode.descendants((node, position) => {
    if (found === null && node.isText && node.text === text) {
      found = position + offset;
    }
  });
  assert.notEqual(found, null, `找不到文本节点：${text}`);
  return found;
}

function listItemPosition(documentNode, label) {
  let found = null;
  documentNode.descendants((node, position) => {
    if (
      found === null
      && node.type.name === "list_item"
      && node.firstChild?.textContent === label
    ) {
      found = position;
    }
  });
  assert.notEqual(found, null, `找不到列表项：${label}`);
  return found;
}

function nodePosition(documentNode, typeName, predicate = () => true) {
  let found = null;
  documentNode.descendants((node, position) => {
    if (found === null && node.type.name === typeName && predicate(node)) found = position;
  });
  assert.notEqual(found, null, `找不到节点：${typeName}`);
  return found;
}

function listDepth(documentNode, label) {
  const resolved = documentNode.resolve(listItemPosition(documentNode, label) + 1);
  let depth = 0;
  for (let index = 0; index <= resolved.depth; index += 1) {
    if (["bullet_list", "ordered_list"].includes(resolved.node(index).type.name)) {
      depth += 1;
    }
  }
  return depth;
}

function selectionListDepth(state) {
  let depth = 0;
  for (let index = 0; index <= state.selection.$from.depth; index += 1) {
    if (["bullet_list", "ordered_list"].includes(state.selection.$from.node(index).type.name)) {
      depth += 1;
    }
  }
  return depth;
}

function harness(markdown) {
  let state = createEditorState(markdown);
  const dispatch = (transaction) => {
    state = state.apply(transaction);
  };
  return {
    get state() { return state; },
    dispatch,
    select(text, offset = 0) {
      dispatch(state.tr.setSelection(TextSelection.create(
        state.doc,
        textPosition(state.doc, text, offset),
      )));
    },
    run(command) {
      return command(state, dispatch);
    },
  };
}

function keydown(editor, key, options = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  const dispatched = editor.view.dom.dispatchEvent(event);
  return { dispatched, event };
}

function flushDomObserver() {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

test("schema exposes phase 1 core and phase 2 business nodes from one source", () => {
  for (const name of [
    "doc", "paragraph", "blockquote", "heading", "code_block", "text",
    "ordered_list", "bullet_list", "list_item", "table", "image",
    "math_inline", "math_block", "page_break", "opaque_block", "opaque_inline",
  ]) {
    assert.ok(wysiwygSchema.nodes[name], name);
  }
  for (const name of ["link", "em", "strong", "code", "strike"]) {
    assert.ok(wysiwygSchema.marks[name], name);
  }
  for (const name of [
    "horizontal_rule", "image", "math_inline", "math_block", "page_break",
    "opaque_block", "opaque_inline",
  ]) {
    assert.equal(wysiwygSchema.nodes[name].isAtom, true, name);
  }
});

test("basic Markdown reaches a stable second roundtrip", () => {
  const initial = `# 标题

含有 **粗体**、*斜体*、[链接](https://example.com) 和 \`代码\`。

> 引用

${nestedListMarkdown}

\`\`\`
let 中文 = true;
\`\`\``;
  const first = serializeMarkdown(parseMarkdown(initial));
  const second = serializeMarkdown(parseMarkdown(first));

  assert.equal(second, first);
  assert.match(first, /A\.1\.1/);
  assert.match(first, /let 中文 = true/);
});

test("phase 2 syntax becomes explicit nodes instead of escaped ordinary text", () => {
  const documentNode = parseMarkdown(
    "| A | B |\n| --- | --- |\n| C | D |\n\n行内公式 $x^2$\n\n<div>保留</div>",
  );
  assert.equal(documentNode.child(0).type.name, "table");
  assert.equal(documentNode.child(1).child(1).type.name, "math_inline");
  assert.equal(documentNode.child(2).type.name, "opaque_block");
});

test("the math renderer exposes the renderInto API required by math node views", async () => {
  const math = await import("./math.js");
  const formula = document.createElement("span");
  const result = window.InfiniteMathRenderer.renderInto(formula, "x^2", false);

  assert.equal(window.InfiniteMathRenderer.renderInto, math.renderInto);
  assert.equal(result.ok, true);
  assert.ok(formula.querySelector(".katex"));
});

test("double-clicking math opens a live editor and applies the updated source", async () => {
  await import("./math.js");
  activeEditor = new MinimalWysiwygEditor(
    document.getElementById("host"),
    "公式 $x^2$。",
  );
  const formula = activeEditor.view.dom.querySelector(".infinite-math");
  formula.dispatchEvent(new Event("dblclick", { bubbles: true, cancelable: true }));

  const overlay = document.querySelector(".infinite-math-editor-overlay");
  const input = overlay.querySelector(".infinite-math-editor-input");
  const preview = overlay.querySelector(".infinite-math-editor-preview-content");
  assert.equal(input.value, "x^2");
  assert.ok(preview.querySelector(".katex"));

  input.value = String.raw`\frac{a}{b}`;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  assert.ok(preview.querySelector(".katex"));
  overlay.querySelector(".infinite-math-editor-button.primary").click();

  assert.equal(document.querySelector(".infinite-math-editor-overlay"), null);
  assert.equal(activeEditor.getMarkdown(), String.raw`公式 $\frac{a}{b}$。`);
});

test("a focused formula can open the math editor from the keyboard", async () => {
  await import("./math.js");
  activeEditor = new MinimalWysiwygEditor(
    document.getElementById("host"),
    "公式 $x^2$。",
  );
  const formula = activeEditor.view.dom.querySelector(".infinite-math");
  formula.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  }));

  assert.ok(document.querySelector(".infinite-math-editor-overlay"));
  document.querySelector(".infinite-math-editor-close").click();
});

test("the math editor reports invalid syntax without overwriting the formula", async () => {
  await import("./math.js");
  activeEditor = new MinimalWysiwygEditor(
    document.getElementById("host"),
    "公式 $x^2$。",
  );
  activeEditor.view.dom.querySelector(".infinite-math").dispatchEvent(
    new Event("dblclick", { bubbles: true, cancelable: true }),
  );
  const input = document.querySelector(".infinite-math-editor-input");
  input.value = String.raw`\frac{`;
  input.dispatchEvent(new Event("input", { bubbles: true }));

  const save = document.querySelector(".infinite-math-editor-button.primary");
  assert.equal(save.disabled, true);
  assert.match(document.querySelector(".infinite-math-editor-error").textContent, /expected|Expected/u);
  document.querySelector(".infinite-math-editor-close").click();
  assert.equal(activeEditor.getMarkdown(), "公式 $x^2$。");
});

test("phase 2 regression corpus reaches a stable second roundtrip", () => {
  const initial = `- [x] 已完成
- [ ] 待办

| 左 | 右 |
| :--- | ---: |
| **粗体** | ~~删除~~ |

行内公式 $x^2$。

$$
E = mc^2
$$

<!-- infinite-editor:page-break -->

![资源图片](document.assets/sample-image.png "示例")

---`;
  const documentNode = parseMarkdown(initial);
  const first = serializeMarkdown(documentNode);
  const second = serializeMarkdown(parseMarkdown(first));

  assert.equal(second, first);
  assert.deepEqual(
    documentNode.content.content.map((node) => node.type.name),
    [
      "bullet_list", "table", "paragraph", "math_block", "page_break",
      "paragraph", "horizontal_rule",
    ],
  );
  assert.equal(documentNode.child(0).child(0).attrs.checked, true);
  assert.equal(documentNode.child(1).attrs.align[0], "left");
  assert.equal(documentNode.child(1).attrs.align[1], "right");
});

test("unknown HTML and directives remain opaque and byte-stable", () => {
  const initial = `<custom-directive data-preserve="true">未知源码</custom-directive>

:::warning{#keep}
unknown **body**
:::

正文 :abbr[HTML]{title="Hypertext"} 结尾`;
  const documentNode = parseMarkdown(initial);
  const first = serializeMarkdown(documentNode);
  const second = serializeMarkdown(parseMarkdown(first));

  assert.equal(first, initial);
  assert.equal(second, first);
  assert.equal(documentNode.child(0).type.name, "paragraph");
  assert.equal(documentNode.child(0).child(0).type.name, "opaque_inline");
  assert.equal(documentNode.child(1).attrs.kind, "containerDirective");
  assert.equal(documentNode.child(2).child(1).type.name, "opaque_inline");
});

test("reference links normalize semantically while preserving their source definition", () => {
  const initial = `[ref]: https://example.com "标题"

访问 [链接][ref]。`;
  const documentNode = parseMarkdown(initial);
  const first = serializeMarkdown(documentNode);
  const second = serializeMarkdown(parseMarkdown(first));

  assert.equal(documentNode.child(0).type.name, "link_definition");
  assert.equal(documentNode.child(0).attrs.identifier, "ref");
  assert.equal(documentNode.child(0).attrs.href, "https://example.com");
  assert.equal(second, first);
  assert.match(first, /^\[ref\]: https:\/\/example\.com "标题"/u);
  assert.match(first, /\[链接\]\(https:\/\/example\.com "标题"\)/u);
});

test("reference definitions stay in Markdown but are hidden in WYSIWYG", () => {
  const editor = new MinimalWysiwygEditor(
    document.getElementById("host"),
    `[guide]: https://www.markdownguide.org/ "Markdown Guide"

[普通链接][guide]`,
  );
  activeEditor = editor;

  const definition = editor.view.dom.querySelector("[data-link-definition]");
  assert.ok(definition);
  assert.equal(definition.hidden, true);
  assert.equal(definition.getAttribute("aria-hidden"), "true");
  assert.match(editor.getMarkdown(), /^\[guide\]: https:\/\/www\.markdownguide\.org\//u);
  assert.equal(editor.view.dom.querySelector("[data-opaque-source]"), null);
});

test("the editor core depends on an injectable AST backend contract", () => {
  let received = null;
  const backend = {
    parse(markdown) {
      received = markdown;
      return {
        version: 1,
        children: [{
          kind: "paragraph",
          children: [{ kind: "text", value: "来自统一 AST" }],
        }],
      };
    },
  };
  const state = createEditorState("后端输入", { backend });

  assert.equal(received, "后端输入");
  assert.equal(state.doc.textContent, "来自统一 AST");
});

test("Remark adapter matches the shared Infinite AST v1 golden contract", () => {
  const markdown = readFileSync(
    new URL("./wysiwyg/fixtures/infinite_ast_v1.md", import.meta.url),
    "utf8",
  );
  const expected = JSON.parse(readFileSync(
    new URL("./wysiwyg/fixtures/infinite_ast_v1.json", import.meta.url),
    "utf8",
  ));

  const actual = remarkReferenceBackend.parse(markdown);
  const { source_map: sourceMap, ...semanticDocument } = actual;
  assert.deepEqual(semanticDocument, expected);
  assert.ok(sourceMap.length > actual.children.length);
});

test("Remark source maps use the same UTF-16 coordinate contract as Rust", () => {
  const documentNode = remarkReferenceBackend.parse("中文 **粗体**");
  assert.deepEqual(documentNode.source_map, [
    { path: [0], from: 0, to: 9 },
    { path: [0, 0], from: 0, to: 3 },
    { path: [0, 1], from: 3, to: 9 },
    { path: [0, 1, 0], from: 5, to: 7 },
  ]);
});

test("source and ProseMirror positions map through Chinese marked text", () => {
  const markdown = "# 中文 **粗体** 尾";
  const ast = remarkReferenceBackend.parse(markdown);
  const documentNode = parseMarkdown(markdown);
  const mapper = new MarkdownPositionMapper(ast, documentNode, markdown);

  assert.equal(mapper.sourceToProseMirror(8), 5);
  assert.equal(mapper.proseMirrorToSource(5), 8);
  assert.equal(mapper.sourceToProseMirror(2), 1);
  assert.equal(mapper.proseMirrorToSource(1), 2);
});

test("the editor rejects an unknown Infinite AST version before constructing state", () => {
  const backend = {
    parse() {
      return { version: 2, children: [] };
    },
  };

  assert.throws(
    () => createEditorState("", { backend }),
    /不支持 Infinite AST v2/u,
  );
});

test("the versioned bridge debounces transaction snapshots into one revisioned envelope", async () => {
  const changes = [];
  const session = new WysiwygBridgeSession({
    host: document.getElementById("host"),
    ast: remarkReferenceBackend.parse("正文"),
    markdown: "正文",
    documentRevision: 7,
    editRevision: 3,
    changeDebounceMs: 10,
    onChange: (change) => changes.push(change),
  });
  activeEditor = session.editor;

  session.editor.view.dispatch(session.editor.state.tr.insertText("新", 3));
  session.editor.view.dispatch(session.editor.state.tr.insertText("版", 4));
  assert.equal(changes.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], {
    bridge_version: 1,
    document_revision: 7,
    edit_revision: 5,
    origin: "wysiwyg-input",
    markdown: "正文新版",
  });
});

test("blur flushes the latest WYSIWYG transaction before a mode or tab switch", async () => {
  const changes = [];
  const session = new WysiwygBridgeSession({
    host: document.getElementById("host"),
    ast: remarkReferenceBackend.parse("正文"),
    markdown: "正文",
    documentRevision: 7,
    changeDebounceMs: 1000,
    onChange: (change) => changes.push(change),
  });
  activeEditor = session.editor;

  session.editor.view.dispatch(session.editor.state.tr.insertText("新", 3));
  session.editor.view.dom.dispatchEvent(new Event("blur"));

  assert.equal(changes.length, 1);
  assert.equal(changes[0].origin, "wysiwyg-blur");
  assert.equal(changes[0].markdown, "正文新");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(changes.length, 1);
});

test("the bridge defers external replacement and mode switching during Chinese composition", async () => {
  const session = new WysiwygBridgeSession({
    host: document.getElementById("host"),
    ast: remarkReferenceBackend.parse("原文"),
    markdown: "原文",
    documentRevision: 8,
    editRevision: 1,
  });
  activeEditor = session.editor;
  session.editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", {
    bubbles: true,
    data: "中",
  }));

  assert.deepEqual(session.prepareModeSwitch(), {
    ok: false,
    deferred: true,
    reason: "composition",
  });
  assert.deepEqual(session.setDocument({
    ast: remarkReferenceBackend.parse("外部新文档"),
    markdown: "外部新文档",
    documentRevision: 9,
    editRevision: 0,
  }), { ok: true, applied: false, deferred: true });
  assert.equal(session.editor.getMarkdown(), "原文");

  session.editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", {
    bubbles: true,
    data: "中文",
  }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(session.editor.getMarkdown(), "外部新文档");
  assert.equal(session.documentRevision, 9);
});

test("the bridge rejects stale snapshots and prepares an explicit switch snapshot", () => {
  const changes = [];
  const session = new WysiwygBridgeSession({
    host: document.getElementById("host"),
    ast: remarkReferenceBackend.parse("稳定内容"),
    markdown: "稳定内容",
    documentRevision: 10,
    editRevision: 2,
    changeDebounceMs: 1000,
    onChange: (change) => changes.push(change),
  });
  activeEditor = session.editor;

  assert.deepEqual(session.setDocument({
    ast: remarkReferenceBackend.parse("过期"),
    markdown: "过期",
    documentRevision: 10,
    editRevision: 1,
  }), { ok: true, applied: false, stale: true });
  session.editor.view.dispatch(session.editor.state.tr.insertText("！", 5));
  const snapshot = session.prepareModeSwitch();

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.document_revision, 10);
  assert.equal(snapshot.edit_revision, 3);
  assert.equal(snapshot.markdown, "稳定内容！");
  assert.equal(typeof snapshot.view.scroll_ratio, "number");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].origin, "wysiwyg-switch");
});

test("production node views resolve resource paths without changing Markdown", () => {
  const path = "document.assets/image.png";
  const session = new WysiwygBridgeSession({
    host: document.getElementById("host"),
    ast: remarkReferenceBackend.parse(`![图](${path})`),
    markdown: `![图](${path})`,
    documentRevision: 11,
    resources: { [path]: "data:image/png;base64,AQID" },
  });
  activeEditor = session.editor;

  const image = document.querySelector(".infinite-pm-image");
  assert.equal(image.dataset.markdownSrc, path);
  assert.equal(image.src, "data:image/png;base64,AQID");
  assert.equal(session.prepareModeSwitch().markdown, `![图](${path})`);
});

test("native image paste returns through the existing Rust clipboard request channel", () => {
  let complete = null;
  window.InfiniteMarkdownEditor = {
    clipboardMayContainImage: () => true,
    requestClipboardImage(callback) {
      complete = callback;
      return true;
    },
  };
  const session = new WysiwygBridgeSession({
    host: document.getElementById("host"),
    ast: remarkReferenceBackend.parse("前后"),
    markdown: "前后",
    documentRevision: 12,
  });
  activeEditor = session.editor;
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      types: ["image/png"],
      getData: () => "",
    },
  });

  session.editor.view.dom.dispatchEvent(event);
  complete("document.assets/pasted.png");

  assert.match(session.editor.getMarkdown(), /!\[粘贴的图片\]\(document\.assets\/pasted\.png\)/u);
  delete window.InfiniteMarkdownEditor;
});

test("production toolbar block commands toggle without trapping the selection", () => {
  const session = new WysiwygBridgeSession({
    host: document.getElementById("host"),
    ast: remarkReferenceBackend.parse("段落"),
    markdown: "段落",
    documentRevision: 13,
  });
  activeEditor = session.editor;

  assert.equal(session.command("heading2").changed, true);
  assert.equal(session.editor.getMarkdown(), "## 段落");
  assert.equal(session.command("heading2").changed, true);
  assert.equal(session.editor.getMarkdown(), "段落");
  assert.equal(session.command("quote").changed, true);
  assert.equal(session.editor.getMarkdown(), "> 段落");
  assert.equal(session.command("quote").changed, true);
  assert.equal(session.editor.getMarkdown(), "段落");
  assert.equal(session.command("unordered_list").changed, true);
  assert.equal(session.editor.getMarkdown(), "* 段落");
  assert.equal(session.command("unordered_list").changed, true);
  assert.equal(session.editor.getMarkdown(), "段落");
});

test("Markdown input rules create structural heading and list nodes", () => {
  const heading = new MinimalWysiwygEditor(document.getElementById("host"), "");
  activeEditor = heading;
  let handled = false;
  heading.view.someProp("handleTextInput", (handler) => {
    handled = handler(heading.view, 1, 1, "## ");
    return handled;
  });
  assert.equal(handled, true);
  assert.equal(heading.state.doc.child(0).type.name, "heading");
  assert.equal(heading.state.doc.child(0).attrs.level, 2);

  heading.setMarkdown("");
  heading.view.someProp("handleTextInput", (handler) => {
    handled = handler(heading.view, 1, 1, "- ");
    return handled;
  });
  assert.equal(handled, true);
  assert.equal(heading.state.doc.child(0).type.name, "bullet_list");
});

test("visual pagination uses decorations without changing content or history", () => {
  const editor = new MinimalWysiwygEditor(document.getElementById("host"), "第一页\n\n第二页");
  activeEditor = editor;
  const before = editor.state.doc;
  const boundary = editor.state.doc.child(0).nodeSize;

  assert.equal(setPaginationBoundaries(editor.view, [boundary]), true);
  assert.equal(editor.state.doc.eq(before), true);
  assert.equal(paginationKey.getState(editor.state).decorations.find().length, 1);
  assert.equal(undo(editor.state, editor.view.dispatch), false);
});

test("pagination gaps fill the unused page area before the next block", () => {
  const blocks = [
    { position: 0, top: 0, bottom: 180 },
    { position: 5, top: 220, bottom: 980 },
    { position: 10, top: 1000, bottom: 1200 },
  ];
  assert.deepEqual(calculatePaginationBoundaries(blocks, 900, 200), [
    { position: 5, height: 880, kind: "automatic" },
    { position: 10, height: 320, kind: "automatic" },
  ]);
  assert.equal(calculatePaginationLayout(blocks, 900, 200).tailHeight, 700);
});

test("an explicit page-break node always starts the following block on a new page", () => {
  const blocks = [
    { position: 0, endPosition: 5, top: 0, bottom: 100 },
    {
      position: 5,
      endPosition: 6,
      top: 120,
      bottom: 148,
      forcePageBreakAfter: true,
    },
    { position: 6, endPosition: 12, top: 180, bottom: 300 },
  ];
  assert.deepEqual(calculatePaginationBoundaries(blocks, 900, 200), [
    { position: 6, height: 920, kind: "explicit" },
  ]);
  assert.equal(calculatePaginationLayout(blocks, 900, 200).tailHeight, 780);
});

test("pagination fills a short final page without adding document content", () => {
  assert.deepEqual(calculatePaginationLayout([
    { position: 0, top: 0, bottom: 260 },
  ], 900, 200), {
    boundaries: [],
    tailHeight: 640,
  });
});

test("task and strike commands produce ordinary undoable transactions", () => {
  const editor = harness("- [ ] 待办\n\n删除文字");
  editor.select("待办");
  assert.equal(editor.run(blockCommands(wysiwygSchema).setTaskChecked(true)), true);
  editor.dispatch(editor.state.tr.setSelection(TextSelection.create(
    editor.state.doc,
    textPosition(editor.state.doc, "删除文字"),
    textPosition(editor.state.doc, "删除文字", 4),
  )));
  assert.equal(editor.run(toolbarCommands(wysiwygSchema).strike), true);
  assert.equal(serializeMarkdown(editor.state.doc), "* [x] 待办\n\n~~删除文字~~");
  assert.equal(editor.run(undo), true);
  assert.equal(serializeMarkdown(editor.state.doc), "* [x] 待办\n\n删除文字");
});

test("business-node insertion commands create schema-owned atomic nodes", () => {
  const editor = harness("前后");
  const commands = blockCommands(wysiwygSchema);
  editor.select("前后", 1);
  assert.equal(editor.run(commands.image({ src: "a.png", alt: "A", title: null })), true);
  assert.equal(editor.run(commands.inlineMath("x^2")), true);
  assert.equal(serializeMarkdown(editor.state.doc), "前![A](a.png)$x^2$后");

  editor.dispatch(editor.state.tr.setSelection(TextSelection.create(
    editor.state.doc,
    editor.state.doc.content.size - 1,
  )));
  assert.equal(editor.run(commands.pageBreak()), true);
  assert.equal(nodePosition(editor.state.doc, "page_break") > 0, true);
  assert.equal(editor.state.selection.$from.parent.type, wysiwygSchema.nodes.paragraph);
});

test("a trailing explicit page break opens with an editable paragraph after it", () => {
  const documentNode = parseMarkdown("正文\n\n<!-- infinite-editor:page-break -->");
  assert.equal(documentNode.child(documentNode.childCount - 2).type.name, "page_break");
  assert.equal(documentNode.lastChild.type.name, "paragraph");
  assert.equal(serializeMarkdown(documentNode), "正文\n\n<!-- infinite-editor:page-break -->");
});

test("one deletion removes exactly one selected atomic image and undo restores it", () => {
  const editor = harness("前![A](a.png)后");
  const imagePosition = nodePosition(editor.state.doc, "image");
  editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePosition)));
  editor.dispatch(editor.state.tr.deleteSelection());

  assert.equal(serializeMarkdown(editor.state.doc), "前后");
  assert.equal(editor.run(undo), true);
  assert.equal(serializeMarkdown(editor.state.doc), "前![A](a.png)后");
});

test("Enter in a task item creates one new unchecked task item", () => {
  const editor = harness("- [x] 前后\n- [ ] 后续");
  editor.select("前后", 1);
  assert.equal(editor.run(listCommands(wysiwygSchema).enter), true);
  assert.equal(serializeMarkdown(editor.state.doc), "* [x] 前\n* [ ] 后\n* [ ] 后续");
  assert.deepEqual(
    editor.state.doc.child(0).content.content.map((item) => item.attrs.checked),
    [true, false, false],
  );
});

test("code fence language and hard breaks stabilize without dropping semantics", () => {
  const initial = "```rust title=demo\nfn main() {}\n```\n\n第一行  \n第二行";
  const first = serializeMarkdown(parseMarkdown(initial));
  const second = serializeMarkdown(parseMarkdown(first));

  assert.equal(second, first);
  assert.match(first, /^```rust title=demo/mu);
  assert.match(first, /第一行\\\n第二行/u);
});

test("Shift+Tab lifts only A.1.1 and its legal subtree", () => {
  const editor = harness(nestedListMarkdown);
  const commands = listCommands(wysiwygSchema);
  editor.select("A.1.1");

  assert.equal(editor.run(commands.outdent), true);
  assert.deepEqual(
    Object.fromEntries(["A", "A.1", "A.1.1", "A.1.2", "A.2", "B"]
      .map((label) => [label, listDepth(editor.state.doc, label)])),
    { A: 1, "A.1": 2, "A.1.1": 2, "A.1.2": 3, "A.2": 2, B: 1 },
  );
});

test("Tab and Shift+Tab are single-level transactions with undo/redo", () => {
  const editor = harness(nestedListMarkdown);
  const commands = listCommands(wysiwygSchema);
  editor.select("A.1.1");

  assert.equal(editor.run(commands.outdent), true);
  const outdented = serializeMarkdown(editor.state.doc);
  assert.equal(listDepth(editor.state.doc, "A.1.1"), 2);
  assert.equal(editor.run(commands.indent), true);
  const indented = serializeMarkdown(editor.state.doc);
  assert.equal(listDepth(editor.state.doc, "A.1.1"), 3);
  assert.equal(listDepth(editor.state.doc, "A.1.2"), 4);

  assert.equal(editor.run(undo), true);
  assert.equal(serializeMarkdown(editor.state.doc), outdented);
  assert.equal(editor.state.selection.$from.parent.textContent, "A.1.1");
  assert.equal(editor.run(undo), true);
  assert.equal(serializeMarkdown(editor.state.doc), nestedListMarkdown);
  assert.equal(editor.state.selection.$from.parent.textContent, "A.1.1");
  assert.equal(editor.run(redo), true);
  assert.equal(serializeMarkdown(editor.state.doc), outdented);
  assert.equal(editor.run(redo), true);
  assert.equal(serializeMarkdown(editor.state.doc), indented);
  assert.equal(editor.state.selection.$from.parent.textContent, "A.1.1");
});

test("Enter splits a nested non-empty list item without changing its siblings", () => {
  const editor = harness("- 父项\n  - 子项\n  - 后续\n- B");
  const commands = listCommands(wysiwygSchema);
  editor.select("子项", 1);

  assert.equal(editor.run(commands.enter), true);
  assert.equal(serializeMarkdown(editor.state.doc), "* 父项\n  * 子\n  * 项\n  * 后续\n* B");
  assert.equal(listDepth(editor.state.doc, "后续"), 2);
  assert.equal(listDepth(editor.state.doc, "B"), 1);
});

test("Enter on an empty nested item exits exactly one list level", () => {
  const editor = harness("- 父项\n  - 临时\n  - 后续\n- B");
  const temporary = textPosition(editor.state.doc, "临时");
  editor.dispatch(
    editor.state.tr
      .delete(temporary, temporary + 2)
      .setMeta("addToHistory", false),
  );
  const commands = listCommands(wysiwygSchema);

  assert.equal(editor.run(commands.enter), true);
  assert.equal(selectionListDepth(editor.state), 1);
  assert.equal(listDepth(editor.state.doc, "后续"), 2);
  assert.equal(listDepth(editor.state.doc, "B"), 1);
});

test("Backspace at a nested item start changes one structural boundary", () => {
  const editor = harness("- 父项\n  - 子项\n  - 后续\n- B");
  const commands = listCommands(wysiwygSchema);
  editor.select("子项");

  assert.equal(editor.run(commands.backspace), true);
  assert.equal(serializeMarkdown(editor.state.doc), "* 父项\n\n  子项\n  * 后续\n* B");
  assert.equal(listDepth(editor.state.doc, "后续"), 2);
  assert.equal(listDepth(editor.state.doc, "B"), 1);
});

test("EditorView keydown routes Tab and Shift+Tab through list transactions", () => {
  activeEditor = new MinimalWysiwygEditor(document.getElementById("host"), nestedListMarkdown);
  activeEditor.view.dispatch(activeEditor.state.tr.setSelection(TextSelection.create(
    activeEditor.state.doc,
    textPosition(activeEditor.state.doc, "A.1.1"),
  )));

  const outdent = keydown(activeEditor, "Tab", { shiftKey: true });
  assert.equal(outdent.dispatched, false);
  assert.equal(outdent.event.defaultPrevented, true);
  assert.equal(listDepth(activeEditor.state.doc, "A.1.1"), 2);

  const indent = keydown(activeEditor, "Tab");
  assert.equal(indent.dispatched, false);
  assert.equal(indent.event.defaultPrevented, true);
  assert.equal(listDepth(activeEditor.state.doc, "A.1.1"), 3);
  assert.equal(listDepth(activeEditor.state.doc, "A.1.2"), 4);
});

test("EditorView keydown routes Enter and Backspace through structural transactions", () => {
  activeEditor = new MinimalWysiwygEditor(
    document.getElementById("host"),
    "- 父项\n  - 子项\n  - 后续\n- B",
  );
  activeEditor.view.dispatch(activeEditor.state.tr.setSelection(TextSelection.create(
    activeEditor.state.doc,
    textPosition(activeEditor.state.doc, "子项", 1),
  )));

  const enter = keydown(activeEditor, "Enter");
  assert.equal(enter.dispatched, false);
  assert.equal(enter.event.defaultPrevented, true);
  assert.equal(activeEditor.getMarkdown(), "* 父项\n  * 子\n  * 项\n  * 后续\n* B");

  activeEditor.view.dispatch(activeEditor.state.tr.setSelection(TextSelection.create(
    activeEditor.state.doc,
    textPosition(activeEditor.state.doc, "项"),
  )));
  const backspace = keydown(activeEditor, "Backspace");
  assert.equal(backspace.dispatched, false);
  assert.equal(backspace.event.defaultPrevented, true);
  assert.equal(activeEditor.getMarkdown(), "* 父项\n  * 子\n\n    项\n  * 后续\n* B");
  assert.equal(activeEditor.state.selection.$from.parent.textContent, "项");
});

test("composition protects Chinese IME text from external document replacement", async () => {
  const compositionStates = [];
  activeEditor = new MinimalWysiwygEditor(document.getElementById("host"), "前", {
    onCompositionChange: (active) => compositionStates.push(active),
  });
  const paragraph = activeEditor.view.dom.querySelector("p");
  const text = paragraph.firstChild;
  const selection = document.getSelection();
  const range = document.createRange();
  range.setStart(text, 1);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  paragraph.dispatchEvent(new CompositionEvent("compositionstart", {
    bubbles: true,
    data: "",
  }));
  assert.equal(activeEditor.compositionActive, true);
  assert.equal(activeEditor.view.composing, true);
  assert.equal(activeEditor.setMarkdown("不应覆盖"), false);
  assert.equal(activeEditor.getMarkdown(), "前");

  text.data = "前中文";
  const composedRange = document.createRange();
  composedRange.setStart(text, text.data.length);
  composedRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(composedRange);
  paragraph.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    data: "中文",
    inputType: "insertCompositionText",
  }));
  paragraph.dispatchEvent(new CompositionEvent("compositionend", {
    bubbles: true,
    data: "中文",
  }));
  await flushDomObserver();

  assert.deepEqual(compositionStates, [true, false]);
  assert.equal(activeEditor.view.composing, false);
  assert.equal(activeEditor.getMarkdown(), "前中文");
  assert.equal(activeEditor.setMarkdown("完成后可替换"), true);
  assert.equal(activeEditor.getMarkdown(), "完成后可替换");
});

test("plain-text copy/paste uses the EditorView transaction pipeline", () => {
  activeEditor = new MinimalWysiwygEditor(document.getElementById("host"), "前后");
  activeEditor.view.dispatch(activeEditor.state.tr.setSelection(TextSelection.create(
    activeEditor.state.doc,
    textPosition(activeEditor.state.doc, "前后", 1),
  )));
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      getData: (type) => type === "text/plain" ? "中文" : "",
      types: ["text/plain"],
    },
  });

  assert.equal(activeEditor.view.dom.dispatchEvent(event), false);
  assert.equal(event.defaultPrevented, true);
  assert.equal(activeEditor.getMarkdown(), "前中文后");

  const start = textPosition(activeEditor.state.doc, "前中文后");
  activeEditor.view.dispatch(activeEditor.state.tr.setSelection(TextSelection.create(
    activeEditor.state.doc,
    start + 1,
    start + 3,
  )));
  const copied = {};
  const copy = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(copy, "clipboardData", {
    value: {
      clearData: () => {},
      setData: (type, value) => { copied[type] = value; },
    },
  });
  assert.equal(activeEditor.view.dom.dispatchEvent(copy), false);
  assert.equal(copy.defaultPrevented, true);
  assert.equal(copied["text/plain"], "中文");
});

test("copying an atomic image exposes Markdown instead of rendered DOM text", () => {
  activeEditor = new MinimalWysiwygEditor(
    document.getElementById("host"),
    '前![图片](document.assets/a.png "标题")后',
  );
  const position = nodePosition(activeEditor.state.doc, "image");
  activeEditor.view.dispatch(activeEditor.state.tr.setSelection(
    NodeSelection.create(activeEditor.state.doc, position),
  ));
  const copied = {};
  const copy = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(copy, "clipboardData", {
    value: {
      clearData: () => {},
      setData: (type, value) => { copied[type] = value; },
    },
  });

  assert.equal(activeEditor.view.dom.dispatchEvent(copy), false);
  assert.equal(copy.defaultPrevented, true);
  assert.equal(copied["text/plain"], '![图片](document.assets/a.png "标题")');
});
