import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { TextSelection } from "prosemirror-state";
import { undo, redo } from "prosemirror-history";
import { MinimalWysiwygEditor } from "./wysiwyg/editor.js";
import { toolbarCommands } from "./wysiwyg/commands/toolbar.js";
import { WysiwygBridgeSession } from "./wysiwyg/bridge/session.js";
import { remarkReferenceBackend } from "./wysiwyg/markdown/backend.js";
import { sourceLinkContext, markdownLink } from "./markdown_links.js";
import { openLinkDialog, validateLinkHref } from "./link_dialog.js";
import { installDocumentLinkNavigation } from "./link_navigation.js";

const dom = new JSDOM('<!doctype html><div id="host"></div>', { pretendToBeVisual: true });
for (const name of ["window", "document", "navigator", "Node", "NodeFilter", "HTMLElement", "Element", "MutationObserver", "DOMParser", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "DOMRect"]) globalThis[name] = name === "window" ? dom.window : dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.innerHeight = 800;
globalThis.innerWidth = 1000;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
dom.window.Range.prototype.getClientRects = () => [];
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
await import("./editor.js");
let editor;
let session;
const commands = () => toolbarCommands(editor.state.schema);
const select = (from, to = from) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
function mount(markdown) {
  editor = new MinimalWysiwygEditor(document.getElementById("host"), markdown);
  return editor;
}
function submit(href, text) {
  const input = document.getElementById("infinite-link-href");
  input.value = href;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (text !== undefined) document.getElementById("infinite-link-text").value = text;
  document.querySelector(".infinite-link-dialog").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
function open() { return commands().link(editor.state, tr => editor.view.dispatch(tr), editor.view); }
test.beforeEach(() => {
  if (session) session.destroy(); else editor?.destroy();
  session = null;
  editor = null;
  window.InfiniteMarkdownEditor.destroy("source");
  installDocumentLinkNavigation(window).destroy();
  document.querySelector(".infinite-link-overlay")?.dispatchEvent(new Event("link-dialog-close"));
  document.body.innerHTML = '<div id="host"></div><textarea id="bridge"></textarea>';
});
test.after(() => {
  if (session) session.destroy(); else editor?.destroy();
  window.InfiniteMarkdownEditor.destroy("source");
  installDocumentLinkNavigation(window).destroy();
  dom.window.close();
});

test("adding a link preserves selected strong/emphasis fragments and supports undo/redo", () => {
  mount("前 **粗体** 与 *斜体* 后");
  select(3, 10);
  const original = editor.state.doc;
  assert.equal(open(), true);
  assert.equal(editor.state.doc, original);
  assert.equal(document.activeElement.id, "infinite-link-href");
  submit("https://example.com");
  assert.equal(editor.state.doc.textContent, original.textContent);
  assert.equal(editor.state.doc.rangeHasMark(3, 5, editor.state.schema.marks.strong), true);
  assert.equal(editor.state.doc.rangeHasMark(8, 10, editor.state.schema.marks.em), true);
  assert.equal(editor.state.doc.rangeHasMark(3, 10, editor.state.schema.marks.link), true);
  assert.equal(editor.view.hasFocus(), true);
  assert.equal(undo(editor.state, tr => editor.view.dispatch(tr)), true);
  assert.equal(editor.state.doc.eq(original), true);
  assert.equal(redo(editor.state, tr => editor.view.dispatch(tr)), true);
  assert.match(editor.getMarkdown(), /https:\/\/example.com/u);
});

test("editing at a caret expands the complete link across formatting and preserves its title", () => {
  mount('前 [**粗体**与*斜体*](https://old.example "标题") 后');
  select(5);
  open();
  assert.equal(document.getElementById("infinite-link-text").value, "粗体与斜体");
  assert.equal(document.getElementById("infinite-link-href").value, "https://old.example");
  submit("https://new.example");
  const links = [];
  editor.state.doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === "link") links.push(mark.attrs); });
  assert.equal(links.length, 3);
  assert.equal(links.every(mark => mark.href === "https://new.example" && mark.title === "标题"), true);
  assert.match(editor.getMarkdown(), /\*\*粗体\*\*/u);
  assert.equal(editor.getMarkdown().includes("old.example"), false);
  select(5);
  open();
  document.querySelector(".infinite-link-button.remove").click();
  assert.equal(editor.getMarkdown(), "前 **粗体**与*斜体* 后");
});

test("unlink acts on the selected fragment, or the whole link at a caret", () => {
  mount("前 [甲乙丙](https://example.com) 后");
  select(4, 5);
  assert.equal(commands().unlink(editor.state, tr => editor.view.dispatch(tr)), true);
  assert.equal(editor.state.doc.rangeHasMark(4, 5, editor.state.schema.marks.link), false);
  assert.equal(editor.state.doc.rangeHasMark(3, 4, editor.state.schema.marks.link), true);
  select(3);
  assert.equal(commands().unlink(editor.state, tr => editor.view.dispatch(tr)), true);
  assert.equal(editor.state.doc.rangeHasMark(3, 4, editor.state.schema.marks.link), false);
  assert.equal(editor.state.doc.textContent, "前 甲乙丙 后");
  select(1);
  assert.equal(commands().unlink(editor.state, tr => editor.view.dispatch(tr)), false);
});

test("Escape cancels without changing text, selection or undo history", () => {
  mount("选中文字");
  select(1, 5);
  const original = editor.state;
  open();
  document.getElementById("infinite-link-href").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(document.querySelector(".infinite-link-overlay"), null);
  assert.equal(editor.state.doc, original.doc);
  assert.equal(editor.state.selection.eq(original.selection), true);
  assert.equal(undo(editor.state), false);
  assert.equal(editor.view.hasFocus(), true);
});

test("unsafe/empty addresses cannot apply and display text remains literal", () => {
  mount("示例");
  select(1, 3);
  open();
  submit("javascript:alert(1)", '<img src=x onerror="alert(1)">');
  assert.equal(editor.getMarkdown(), "示例");
  assert.equal(document.querySelector(".infinite-link-button.primary").disabled, true);
  assert.equal(document.getElementById("infinite-link-href").getAttribute("aria-invalid"), "true");
  assert.equal(document.querySelector(".infinite-link-dialog img"), null);
  submit("https://example.com");
  assert.equal(editor.state.doc.textContent, '<img src=x onerror="alert(1)">');
});

test("inserting at a caret uses the supplied text and ends the link after insertion", () => {
  mount("前后");
  select(2);
  open();
  submit("https://example.com", "说明");
  assert.equal(editor.getMarkdown(), "前[说明](https://example.com)后");
  editor.view.dispatch(editor.state.tr.insertText("续写"));
  assert.equal(editor.getMarkdown(), "前[说明](https://example.com)续写后");
  assert.equal(undo(editor.state, tr => editor.view.dispatch(tr)), true);
  assert.equal(editor.getMarkdown(), "前[说明](https://example.com)后");
});

test("changing display text retains its leading emphasis and avoids conflicting code marks", () => {
  mount("**原文**");
  select(1, 3);
  open();
  submit("https://example.com", "修改");
  assert.equal(editor.state.doc.firstChild.firstChild.marks.some(mark => mark.type.name === "strong"), true);
  editor.setMarkdown("`代码` 文字");
  select(1, 6);
  open();
  submit("https://example.com", "说明");
  assert.equal(editor.state.doc.firstChild.firstChild.marks.some(mark => mark.type.name === "code"), false);
  assert.match(editor.getMarkdown(), /\[说明\]\(https:\/\/example.com\)/u);
});

test("a new link uses its address when no display text is supplied", () => {
  mount("");
  open();
  submit("#section");
  assert.equal(editor.getMarkdown(), "[#section](#section)");
});

test("multi-paragraph selections keep their structure and inline formatting", () => {
  mount("**第一段**\n\n*第二段*");
  select(1, editor.state.doc.content.size - 1);
  open();
  assert.equal(document.getElementById("infinite-link-text").readOnly, true);
  submit("../guide.md");
  assert.equal(editor.state.doc.childCount, 2);
  for (let i = 0; i < 2; i += 1) assert.equal(editor.state.doc.child(i).firstChild.marks.some(mark => mark.type.name === "link"), true);
  assert.equal(editor.state.doc.firstChild.firstChild.marks.some(mark => mark.type.name === "strong"), true);
});

test("code-only selections cannot open an inapplicable link editor", () => {
  for (const source of ["`代码`", "```\n代码\n``` "]) {
    editor?.destroy();
    mount(source);
    select(1, 3);
    assert.equal(open(), false);
    assert.equal(document.querySelector(".infinite-link-overlay"), null);
  }
});

test("document replacement and editor destruction close a pending dialog", () => {
  mount("旧文档");
  open();
  editor.setMarkdown("新文档");
  assert.equal(document.querySelector(".infinite-link-overlay"), null);
  assert.equal(editor.getMarkdown(), "新文档");
  open();
  editor.destroy();
  editor = null;
  assert.equal(document.querySelector(".infinite-link-overlay"), null);
});

test("Ctrl/Command K edits, Shift K removes, and IME composition is protected", () => {
  mount("示例");
  select(1, 3);
  const key = props => editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true, ...props }));
  key({ ctrlKey: true, isComposing: true });
  assert.equal(document.querySelector(".infinite-link-overlay"), null);
  key({ metaKey: true });
  assert.ok(document.querySelector(".infinite-link-overlay"));
  submit("https://example.com");
  key({ ctrlKey: true, shiftKey: true });
  assert.equal(editor.getMarkdown(), "示例");
});

test("link dialogs trap Tab navigation and return focus after cancellation", () => {
  mount("示例");
  open();
  const save = document.querySelector(".infinite-link-button.primary");
  const href = document.getElementById("infinite-link-href");
  href.value = "https://example.com";
  href.dispatchEvent(new Event("input", { bubbles: true }));
  save.focus();
  save.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  assert.equal(document.activeElement.className, "infinite-link-dismiss");
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, save);
});

test("the production bridge opens without stealing focus and saves one shared undo event", () => {
  const api = window.InfiniteMarkdownEditor;
  session = new WysiwygBridgeSession({ host: document.getElementById("host"), bridge: document.getElementById("bridge"),
    ast: remarkReferenceBackend.parse("示例"), markdown: "示例", documentRevision: 1, documentSession: api });
  editor = session.editor;
  select(3);
  editor.view.dispatch(editor.state.tr.insertText("续"));
  select(1, 3);
  const result = session.command("link");
  assert.equal(result.opened, true);
  assert.equal(result.changed, false);
  assert.equal(document.activeElement.id, "infinite-link-href");
  submit("https://example.com");
  assert.equal(api.getValue(), "[示例](https://example.com)续");
  assert.equal(session.command("undo").changed, true);
  assert.equal(api.getValue(), "示例续");
  assert.equal(session.command("undo").changed, true);
  assert.equal(api.getValue(), "示例");
});

test("source context recognises reference links, nested destinations and ignores images/code", () => {
  const source = '[**文字**][ref]\n\n[ref]: <https://example.com/a(b)> "标题"\n\n`[代码](wrong)` ![图片](image.png)';
  const target = sourceLinkContext(source, { from: 3, to: 5 });
  assert.equal(target.text, "**文字**");
  assert.equal(target.href, "https://example.com/a(b)");
  assert.equal(target.rawTitle, '"标题"');
  assert.equal(sourceLinkContext(source, { from: source.indexOf("代码"), to: source.length }).links.length, 0);
  assert.equal(markdownLink(target.text, target.href, target.rawTitle), '[**文字**](https://example.com/a\\(b\\) "标题")');
});

test("address validation accepts intended destinations and rejects executable schemes", () => {
  for (const href of ["https://example.com", "http://localhost:8080", "mailto:hello@example.com", "tel:+123", "../guide.md", "/docs", "#章节"]) assert.equal(validateLinkHref(href), "");
  for (const href of ["", "javascript:alert(1)", "data:text/html,test", "https://", "https:example.com", "https://exa mple.com", "java\nscript:test"]) assert.notEqual(validateLinkHref(href), "");
});

test("opening another dialog cancels the previous one across independently loaded bundles", () => {
  const closed = [];
  openLinkDialog({ onSave() {}, onClose: () => closed.push(1) });
  const second = openLinkDialog({ onSave() {}, onClose: () => closed.push(2) });
  assert.equal(document.querySelectorAll(".infinite-link-overlay").length, 1);
  assert.deepEqual(closed, [1]);
  second.close();
  assert.deepEqual(closed, [1, 2]);
});

test("only Ctrl-click opens a link, without changing the document or editor selection", () => {
  mount('[**说明**](https://example.com "作者标题")');
  select(1, 3);
  const initial = editor.state;
  const opened = [];
  const originalOpen = window.open;
  window.open = (...args) => opened.push(args);
  let ancestorClicks = 0;
  const ancestor = () => { ancestorClicks += 1; };
  window.addEventListener("click", ancestor);
  try {
    const link = editor.view.dom.querySelector("a strong");
    const ordinary = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true });
    link.dispatchEvent(ordinary);
    assert.equal(ordinary.defaultPrevented, true);
    assert.equal(opened.length, 0);
    const middle = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    link.dispatchEvent(middle);
    assert.equal(middle.defaultPrevented, true);
    assert.equal(opened.length, 0);
    const down = new MouseEvent("mousedown", { button: 0, ctrlKey: true, bubbles: true, cancelable: true });
    link.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    link.dispatchEvent(new MouseEvent("click", { button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
    assert.deepEqual(opened, [["https://example.com/", "_blank", "noopener,noreferrer"]]);
    assert.equal(ancestorClicks, 0, "Dioxus ancestor must not open links a second time");
    assert.equal(editor.state.doc, initial.doc);
    assert.equal(editor.state.selection.eq(initial.selection), true);
    assert.equal(undo(editor.state), false);
    link.dispatchEvent(new MouseEvent("dblclick", { ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(document.querySelector(".infinite-link-dialog"), null);
  } finally {
    window.open = originalOpen;
    window.removeEventListener("click", ancestor);
  }
});

test("desktop Ctrl-click uses the native system-browser bridge and rejects unsafe links", () => {
  mount("[说明](https://example.com/guide)");
  const original = window.interpreter;
  const calls = [];
  window.interpreter = { intercept_link_redirects: true, sendIpcMessage: (...args) => calls.push(args) };
  try {
    const link = editor.view.dom.querySelector("a");
    link.dispatchEvent(new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }));
    assert.equal(calls.length, 0);
    link.dispatchEvent(new MouseEvent("click", { button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
    assert.deepEqual(calls, [["browser_open", { href: "https://example.com/guide" }]]);
    const preview = document.createElement("div");
    preview.className = "markdown-rendered-html";
    preview.innerHTML = '<a href="javascript:alert(1)">unsafe</a>';
    document.body.append(preview);
    preview.firstChild.dispatchEvent(new MouseEvent("click", { button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(calls.length, 1);
  } finally { window.interpreter = original; }
});

test("hovering a link shows its full address and modifier hint without altering its title or history", async () => {
  mount('[**说明**](https://example.com/guide "作者标题")');
  const original = editor.state.doc;
  const link = editor.view.dom.querySelector("a");
  link.firstChild.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 340));
  const tip = document.querySelector('[role="tooltip"]');
  assert.equal(tip.querySelector(".infinite-link-tooltip-address").textContent, "https://example.com/guide");
  assert.equal(tip.querySelector("kbd").textContent, "Ctrl");
  assert.match(tip.textContent, /单击打开链接/u);
  assert.equal(link.getAttribute("title"), "作者标题");
  assert.equal(editor.state.doc, original);
  assert.equal(editor.getMarkdown(), '[**说明**](https://example.com/guide "作者标题")');
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }));
  assert.equal(document.documentElement.classList.contains("infinite-link-open-modifier"), true);
  document.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true }));
  assert.equal(document.documentElement.classList.contains("infinite-link-open-modifier"), false);
  document.dispatchEvent(new Event("scroll"));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  editor.destroy();
  editor = null;
  await new Promise(resolve => setTimeout(resolve, 340));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
});

test("rendered preview links follow the modifier rule after content swaps and bookmarks scroll locally", () => {
  const controller = installDocumentLinkNavigation(window);
  assert.equal(installDocumentLinkNavigation(window), controller);
  const preview = document.createElement("div");
  preview.className = "markdown-rendered-html";
  preview.innerHTML = '<a href="https://example.com/first">一</a>';
  document.body.append(preview);
  const originalOpen = window.open;
  const opened = [];
  window.open = (...args) => opened.push(args);
  try {
    preview.firstChild.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.equal(opened.length, 0);
    preview.innerHTML = '<a href="https://example.com/next">二</a><a href="#%E7%AB%A0%E8%8A%82">章节</a><h2 id="章节">目标</h2>';
    preview.firstChild.dispatchEvent(new MouseEvent("click", { button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(opened.length, 1);
    assert.equal(opened[0][0], "https://example.com/next");
    let scrolled = false;
    preview.lastChild.scrollIntoView = () => { scrolled = true; };
    preview.children[1].dispatchEvent(new MouseEvent("click", { button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(scrolled, true);
    assert.equal(opened.length, 1);
  } finally { window.open = originalOpen; }
});

test("macOS hints and navigation also support Command-click", async () => {
  const platform = window.navigator.platform;
  Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
  const originalOpen = window.open;
  const opened = [];
  window.open = (...args) => opened.push(args);
  try {
    mount("[说明](https://example.com/guide)");
    const link = editor.view.dom.querySelector("a");
    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 340));
    assert.equal(document.querySelector(".infinite-link-tooltip kbd").textContent, "Ctrl / ⌘");
    link.dispatchEvent(new MouseEvent("click", { button: 0, metaKey: true, bubbles: true, cancelable: true }));
    assert.equal(opened.length, 1);
  } finally {
    Object.defineProperty(window.navigator, "platform", { configurable: true, value: platform });
    window.open = originalOpen;
    installDocumentLinkNavigation(window).destroy();
  }
});
