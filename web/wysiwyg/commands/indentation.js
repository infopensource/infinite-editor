import { EditorState, TextSelection } from "prosemirror-state";
import { liftListItem, sinkListItem } from "prosemirror-schema-list";

// Work on whole blocks touched by the selection. An endpoint at the start of
// the next paragraph does not select that paragraph (including reverse drags).
function selectedBlocks(state, itemType) {
  const { from, to, empty } = state.selection;
  const blocks = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return;
    if (!empty && (pos + 1 >= to || pos + node.nodeSize - 1 < from)) return false;
    const $pos = state.doc.resolve(pos + 1);
    const depth = $pos.depth - 1;
    const parent = $pos.node(depth);
    if (parent.type === itemType && $pos.index(depth) === 0) {
      blocks.push({ pos: $pos.before(depth), node: parent, list: $pos.before(depth - 1), index: $pos.index(depth - 1) });
    } else if (["paragraph", "heading", "code_block"].includes(node.type.name)) {
      blocks.push({ pos, node });
    }
    return false;
  });
  // A selected parent item carries its existing subtree. Never indent that
  // subtree again just because its paragraphs also intersect the selection.
  let selectedItemEnd = -1;
  return blocks.filter(block => {
    if (block.pos < selectedItemEnd) return false;
    if (block.node.type === itemType) selectedItemEnd = block.pos + block.node.nodeSize;
    return true;
  });
}

function indentCode(tr, pos, selection, direction) {
  const node = tr.doc.nodeAt(pos);
  const start = pos + 1;
  const from = Math.max(start, selection.from);
  const to = Math.min(start + node.content.size, selection.to);
  const text = node.textContent;
  const lines = [];
  for (let offset = 0; offset <= text.length;) {
    const end = text.indexOf("\n", offset);
    const lineEnd = end === -1 ? text.length : end;
    if (start + lineEnd >= from && (start + offset < to || (selection.empty && start + offset <= to))) {
      lines.push({ pos: start + offset, remove: /^(?:\t| {1,2})/u.exec(text.slice(offset))?.[0].length ?? 0 });
    }
    if (end === -1) break;
    offset = end + 1;
  }
  for (const line of lines.reverse()) {
    if (direction > 0) tr.insertText("  ", line.pos);
    else if (line.remove) tr.delete(line.pos, line.pos + line.remove);
  }
}

export function changeIndent(schema, direction) {
  const itemType = schema.nodes.list_item;
  const structural = direction > 0 ? sinkListItem(itemType) : liftListItem(itemType);
  return (state, dispatch) => {
    const blocks = selectedBlocks(state, itemType);
    if (!blocks.length) return false;
    const groups = [];
    for (const block of blocks) {
      const previous = groups.at(-1)?.at(-1);
      // Siblings must move together so lifting one does not adopt another
      // selected item as a child. Different containers get separate commands.
      if (block.list !== undefined && previous?.list === block.list
        && previous.index + 1 === block.index
        && Boolean(previous.node.attrs.indent) === Boolean(block.node.attrs.indent)) {
        groups.at(-1).push(block);
      } else groups.push([block]);
    }
    const tr = state.tr;
    const bookmark = state.selection.getBookmark();
    for (const group of groups.reverse()) {
      const first = group[0];
      const pos = tr.mapping.map(first.pos, 1);
      const node = tr.doc.nodeAt(pos);
      if (first.list !== undefined && !node.attrs.indent) {
        const lastPos = tr.mapping.map(group.at(-1).pos, 1);
        const localState = EditorState.create({
          schema, doc: tr.doc,
          selection: TextSelection.create(tr.doc, pos + 2, lastPos + 2),
        });
        let changed = false;
        structural(localState, localTr => {
          for (const step of localTr.steps) tr.step(step);
          changed = true;
        });
        if (changed) continue;
      }
      for (const block of group.slice().reverse()) {
        const mappedPos = tr.mapping.map(block.pos, 1);
        const current = tr.doc.nodeAt(mappedPos);
        if (current.type === schema.nodes.code_block) {
          indentCode(tr, mappedPos, state.selection.map(tr.doc, tr.mapping), direction);
          continue;
        }
        // The first item has no preceding item to become its parent. Give it
        // a visual indent instead of swallowing Tab or inventing empty items.
        const indent = Math.max(0, (current.attrs.indent ?? 0) + direction);
        if (indent !== current.attrs.indent) tr.setNodeMarkup(mappedPos, undefined, { ...current.attrs, indent });
      }
    }
    if (dispatch && tr.docChanged) {
      tr.setSelection(bookmark.map(tr.mapping).resolve(tr.doc));
      dispatch(tr.scrollIntoView());
    }
    // Consume Tab even at the outer boundary; focus stays in the document.
    return true;
  };
}
