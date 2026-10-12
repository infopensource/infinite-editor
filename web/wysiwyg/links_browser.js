import { WysiwygBridgeSession } from "./bridge/session.js";
import { remarkReferenceBackend } from "./markdown/backend.js";
import { TextSelection } from "prosemirror-state";
import "../editor.js";
import "../document_renderer/index.js";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
async function run() {
try {
  const shell = document.createElement("div");
  shell.className = "word-shell theme-light theme-office";
  shell.style.cssText = "position:fixed;inset:0;display:block;height:100vh;overflow:auto";
  const surface = document.querySelector(".infinite-pm-surface");
  surface.querySelector("article").style.cssText += ";--page-height:160mm";
  shell.append(surface);
  document.body.append(shell);
  const bridge = document.createElement("textarea");
  bridge.id = "bridge";
  bridge.hidden = true;
  document.body.append(bridge);
  const markdown = "# 超链接编辑\n\n选中 **重点文字**，添加一个链接。\n\n链接可以随时修改或移除，文字格式会保留。";
  const session = new WysiwygBridgeSession({ host: document.getElementById("host"), bridge,
    ast: remarkReferenceBackend.parse(markdown), markdown, documentRevision: 1,
    documentSession: window.InfiniteMarkdownEditor });
  const editor = session.editor;
  window.linkBrowserSession = session;
  window.linkBrowserOpened = [];
  window.open = (...args) => { window.linkBrowserOpened.push(args); return null; };
  let from;
  editor.state.doc.descendants((node, pos) => { if (node.text === "重点文字") from = pos; });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + 4)));
  assert(session.command("link").opened, "Ribbon did not open link dialog");
  assert(document.activeElement.id === "infinite-link-href", "Bridge stole dialog focus");
  assert(document.getElementById("infinite-link-text").value === "重点文字", "Selection was lost");
  const address = document.getElementById("infinite-link-href");
  address.value = "https://example.com/guide";
  address.dispatchEvent(new Event("input", { bubbles: true }));
  address.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert(editor.view.dom.querySelector("a strong")?.textContent === "重点文字", "Link lost formatting");
  assert(editor.view.hasFocus(), "Editor focus was not restored");
  assert(window.InfiniteMarkdownEditor.getValue().includes("https://example.com/guide"), "Link did not reach shared document");
  assert(session.command("undo").changed, "Link did not enter history");
  assert(!editor.view.dom.querySelector("a"), "Undo did not restore unlinked text");
  assert(session.command("redo").changed, "Link did not redo");
  await frame();
  const anchor = editor.view.dom.querySelector("a");
  const bounds = anchor.getBoundingClientRect();
  window.linkBrowserAnchor = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  // Leave the editor visible so the runner can test a real mouse double click.
  document.getElementById("result").textContent = JSON.stringify({ ok: true, selectionPreserved: true, formattingPreserved: true, sharedUndoRedo: true });
} catch (error) {
  document.getElementById("result").textContent = JSON.stringify({ ok: false, error: error.stack });
}
}
run();
