import { TextSelection } from "prosemirror-state";
import { MinimalWysiwygEditor, parseMarkdown } from "./editor.js";

const editor = new MinimalWysiwygEditor(document.getElementById("host"), "正文\n\n- 父\n- 子\n- 后");
window.listEditingBrowserEditor = editor;

function position(text, offset = 0) {
  let found;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) found = pos + offset;
  });
  if (found === undefined) throw new Error(`Missing text: ${text}`);
  return found;
}

function select(from, to = from) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  editor.focus();
}

function press(key, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  if (!event.defaultPrevented) throw new Error(`Unconsumed key: ${shiftKey ? "Shift-" : ""}${key}`);
  if (!editor.view.hasFocus()) throw new Error("Keyboard command moved focus out of the editor");
}

function check(value, message) {
  if (!value) throw new Error(message);
}

function item(label) {
  const $pos = editor.state.doc.resolve(position(label));
  return $pos.node(-1);
}

try {
  const cases = [];
  select(position("正文", 1));
  const paragraph = editor.view.dom.querySelector("p");
  const bodyLeft = paragraph.getBoundingClientRect().left;
  press("Tab");
  const indentedLeft = editor.view.dom.querySelector("p").getBoundingClientRect().left;
  check(indentedLeft - bodyLeft > 20, "Body indentation did not move its rendered text");
  press("Tab", true);
  check(Math.abs(editor.view.dom.querySelector("p").getBoundingClientRect().left - bodyLeft) < 1, "Body outdent did not restore geometry");
  press("Tab", true);
  cases.push("body geometry and boundary focus");

  select(position("父"));
  const itemLeft = editor.view.dom.querySelector("li").getBoundingClientRect().left;
  press("Tab");
  check(editor.view.dom.querySelector("li").getBoundingClientRect().left - itemLeft > 20, "First item indent did not move its marker and text");
  check(parseMarkdown(editor.getMarkdown()).eq(editor.state.doc), "Visual list indent did not survive serialization");
  press("Tab", true);
  check(item("父").attrs.indent === 0, "Shift-Tab did not remove the first item's visual indent");
  cases.push("first item geometry");

  select(position("子"), position("后", 1));
  press("Tab");
  check(editor.state.doc.child(1).firstChild.child(1).childCount === 2, "Selected siblings did not sink together");
  check(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "|") === "子|后", "List indentation lost the selection");
  press("Tab", true);
  check(editor.state.doc.child(1).childCount === 3, "Selected siblings did not lift together");
  cases.push("multiple selected list items");

  select(position("后", 1), position("正文", 1));
  press("Tab");
  check(editor.state.doc.firstChild.attrs.indent === 1 && item("父").attrs.indent === 1 && item("后").attrs.indent === 1, "Mixed reverse selection was only partially indented");
  check(editor.state.selection.anchor > editor.state.selection.head, "Reverse selection direction was lost");
  press("Tab", true);
  check(parseMarkdown(editor.getMarkdown()).eq(editor.state.doc), "Mixed selection did not round trip");
  cases.push("mixed reverse selection");

  editor.setMarkdown("- 父\n  - 临时\n  - 后");
  select(position("临时"), position("临时", 2));
  press("Backspace");
  press("Enter");
  let depth = 0;
  for (let d = editor.state.selection.$from.depth; d > 0; d--) {
    if (editor.state.selection.$from.node(d).type.name.endsWith("_list")) depth++;
  }
  check(depth === 1 && editor.state.selection.$from.index(-1) === 0, "Enter on an empty marker did not return to the parent list");
  press("Enter");
  check(editor.state.selection.$from.depth === 1 && editor.state.selection.$from.parent.content.size === 0, "The next Enter did not exit the outer list");
  cases.push("empty marker exits one level per Enter");

  editor.setMarkdown("- a) 引用\n  - No idea in Westlaw\n\n  &nbsp;\n- b) 下一案例");
  let blank;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "paragraph" && node.content.size === 0) blank = pos + 1; });
  select(blank);
  press("Backspace");
  check(editor.state.selection.$from.depth === 1 && editor.state.selection.$from.parent.content.size === 0, "Backspace deleted the blank before exiting its list");
  press("Backspace");
  check(editor.state.selection.head === position("No idea in Westlaw", 18), "Backspace after all levels were removed did not delete the paragraph boundary");
  cases.push("blank body Backspace exits before deleting the blank");

  // The runner also exercises actual browser key input using CDP.
  window.prepareNativeListEditing = () => {
    editor.setMarkdown("正文\n\n- 父\n- 子");
    select(position("子"));
  };
  window.prepareNativeListBody = () => {
    editor.setMarkdown("- 标题\n- 后项");
    select(position("标题", 2));
  };
  window.prepareNativeBlankAfterSublist = () => {
    editor.setMarkdown("1. Case and Article Analysis\n   - a) [2024] UKSC 0158\n     - No idea in Westlaw\n\n       &nbsp;\n   - b) [2025] UKUT 00305\n     - What were the issues?\n       - Details");
    let blank;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === "paragraph" && node.content.size === 0) blank = pos + 1; });
    select(blank);
  };
  window.nativeListEditingSnapshot = () => {
    const { $from } = editor.state.selection;
    let depth = 0;
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name.endsWith("_list")) depth++;
    return {
      markdown: editor.getMarkdown(), text: $from.parent.textContent,
      offset: $from.parentOffset, depth, marker: $from.depth >= 2 && $from.node(-1).type.name === "list_item" && $from.index(-1) === 0,
      listType: $from.depth >= 3 ? $from.node(-2).type.name : null,
      content: editor.state.doc.textContent, focused: editor.view.hasFocus(),
      roundtrip: parseMarkdown(editor.getMarkdown()).eq(editor.state.doc),
      hiddenHeadings: [...editor.view.dom.querySelectorAll("li[data-list-continuation] > .infinite-task-content > p:first-child")].every(p => p.getBoundingClientRect().height === 0),
      following: ["b) [2025] UKUT 00305", "What were the issues?", "Details"].map(text => {
        let result = null;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== "list_item" || node.firstChild.textContent !== text) return;
          const $pos = editor.state.doc.resolve(pos + 1);
          let depth = 0;
          for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name.endsWith("_list")) depth++;
          const element = editor.view.nodeDOM(pos);
          result = { text, depth, attrs: node.attrs, listType: $pos.node(-1).type.name,
            left: Math.round(element.getBoundingClientRect().left), marker: getComputedStyle(element).listStyleType };
        });
        return result;
      }),
    };
  };
  document.getElementById("result").textContent = JSON.stringify({ ok: true, cases });
} catch (error) {
  document.getElementById("result").textContent = JSON.stringify({ ok: false, error: error.stack });
}
