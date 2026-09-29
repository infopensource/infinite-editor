import { Plugin } from "prosemirror-state";
import { lift, setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { liftListItem, wrapInList } from "prosemirror-schema-list";
import { blockCommands } from "./blocks.js";

function toggleBlock(type, fallback) {
  return (state, dispatch) => {
    const active = state.selection.$from.parent.type === type;
    return setBlockType(active ? fallback : type)(state, dispatch);
  };
}

function toggleHeading(schema, level) {
  return (state, dispatch) => {
    const parent = state.selection.$from.parent;
    const active = parent.type === schema.nodes.heading && parent.attrs.level === level;
    return setBlockType(
      active ? schema.nodes.paragraph : schema.nodes.heading,
      active ? undefined : { level },
    )(state, dispatch);
  };
}

function toggleBlockquote(schema) {
  return (state, dispatch) => {
    for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
      if (state.selection.$from.node(depth).type === schema.nodes.blockquote) {
        return lift(state, dispatch);
      }
    }
    return wrapIn(schema.nodes.blockquote)(state, dispatch);
  };
}

function toggleList(schema, targetType) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type !== schema.nodes.bullet_list && node.type !== schema.nodes.ordered_list) continue;
      if (node.type === targetType) return liftListItem(schema.nodes.list_item)(state, dispatch);
      if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(depth), targetType));
      return true;
    }
    return wrapInList(targetType)(state, dispatch);
  };
}

export function setParagraphAlignment(textAlign) {
  return (state, dispatch) => {
    if (!["left", "center", "right", "justify"].includes(textAlign)) return false;
    const tr = state.tr;
    let applicable = false;
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
      if (!["paragraph", "heading"].includes(node.type.name)) return;
      applicable = true;
      if (node.attrs.textAlign !== textAlign) tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign });
      return false;
    });
    if (dispatch && tr.docChanged) dispatch(tr.scrollIntoView());
    return applicable;
  };
}

export function alignmentKeyBindings() {
  return Object.fromEntries([["l", "left"], ["e", "center"], ["r", "right"], ["j", "justify"]]
    .map(([key, align]) => [`Mod-${key}`, setParagraphAlignment(align)]));
}

export function toolbarCommands(schema) {
  const blocks = blockCommands(schema);
  return {
    ...Object.fromEntries(["left", "center", "right", "justify"].map(align => [`align_${align}`, setParagraphAlignment(align)])),
    undo,
    redo,
    bold: toggleMark(schema.marks.strong),
    italic: toggleMark(schema.marks.em),
    strike: toggleMark(schema.marks.strike),
    code_block: toggleBlock(schema.nodes.code_block, schema.nodes.paragraph),
    quote: toggleBlockquote(schema),
    unordered_list: toggleList(schema, schema.nodes.bullet_list),
    ordered_list: toggleList(schema, schema.nodes.ordered_list),
    horizontal_rule: blocks.horizontalRule(),
    page_break: blocks.pageBreak(),
    heading1: toggleHeading(schema, 1),
    heading2: toggleHeading(schema, 2),
    heading3: toggleHeading(schema, 3),
    paragraph: setBlockType(schema.nodes.paragraph),
  };
}

// The ribbon lives outside ProseMirror; expose the current paragraph selection
// on its alignment buttons without moving focus away from the document.
export function alignmentToolbarPlugin() {
  return new Plugin({
    view(view) {
      const update = () => {
        const values = new Set();
        view.state.doc.nodesBetween(view.state.selection.from, view.state.selection.to, node => {
          if (["paragraph", "heading"].includes(node.type.name)) values.add(node.attrs.textAlign ?? "left");
        });
        for (const button of view.dom.ownerDocument.querySelectorAll("[data-paragraph-alignment]")) {
          const active = values.size === 1 && values.has(button.dataset.paragraphAlignment);
          button.setAttribute("aria-pressed", String(active));
          button.classList.toggle("active", active);
        }
      };
      update();
      return { update };
    },
  });
}
