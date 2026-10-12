import {
  chainCommands, deleteSelection, joinBackward, joinTextblockBackward,
  selectNodeBackward, splitBlockKeepMarks,
} from "prosemirror-commands";
import { closeHistory } from "prosemirror-history";
import { splitListItem } from "prosemirror-schema-list";
import { TextSelection } from "prosemirror-state";
import { changeIndent } from "./indentation.js";

function joinContinuations(tr) {
  // Once the separating paragraph is deleted, rejoin the two parts of the
  // original list. Keeping adjacent fragments would let Markdown merge them
  // as separate numbered items on reload, counting the hidden heading twice.
  if (!tr.docChanged) return tr;
  for (;;) {
    let boundary = null;
    tr.doc.descendants((node, pos) => {
      if (boundary || !node.type.name.endsWith("_list")) return;
      const $pos = tr.doc.resolve(pos);
      const before = $pos.nodeBefore;
      if (before?.type !== node.type) return;
      const continuation = node.firstChild.attrs.continuation;
      if (node.type.name === "ordered_list" && node.attrs.order !== before.attrs.order + before.childCount - (continuation ? 1 : 0)) return;
      const attrs = before.lastChild.attrs;
      if (continuation && (attrs.indent !== node.firstChild.attrs.indent || attrs.checked !== node.firstChild.attrs.checked)) return;
      boundary = { list: pos, item: continuation ? pos - 1 : null };
    });
    if (!boundary) return tr;
    tr.join(boundary.list);
    if (boundary.item === null) continue;
    tr.join(boundary.item);
    // Joining the wrappers left the continuation's empty first paragraph
    // inside the previous item, where deleting it cannot strand a sublist.
    tr.delete(boundary.item - 1, boundary.item + 1);
  }
}

function isolated(command) {
  return (state, dispatch, view) => command(
    state,
    dispatch ? (transaction) => dispatch(closeHistory(joinContinuations(transaction)).setMeta("infinite-structural-command", true)) : undefined,
    view,
  );
}

export function listCommands(schema) {
  const item = schema.nodes.list_item;
  const outdent = changeIndent(schema, -1);
  const reduceParagraphIndent = (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.attrs.indent) return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(), undefined, {
      ...$from.parent.attrs, indent: $from.parent.attrs.indent - 1,
    }).setMeta("infinite-level-exit", true).scrollIntoView());
    return true;
  };
  // Extract just the selected paragraph from its list. Retain the following
  // blocks inside a continuation of the original item, so neither siblings
  // nor descendants change their list depth or numbering.
  const extractParagraph = (tr) => {
    const { $from } = tr.selection;
    const itemDepth = $from.depth - 1;
    const listDepth = itemDepth - 1;
    const owner = $from.node(itemDepth);
    const list = $from.node(listDepth);
    const index = $from.index(listDepth);
    const preceding = owner.content.cut(0, $from.before() - $from.start(itemDepth));
    const following = owner.content.cut($from.after() - $from.start(itemDepth));
    const beforeItems = [];
    for (let i = 0; i < index; i++) beforeItems.push(list.child(i));
    if (preceding.size && !(owner.attrs.continuation && preceding.childCount === 1)) {
      beforeItems.push(owner.copy(preceding));
    }
    const afterItems = [];
    if (following.size) {
      afterItems.push(item.create({ ...owner.attrs, continuation: true }, [
        schema.nodes.paragraph.create(), ...following.content,
      ]));
    }
    for (let i = index + 1; i < list.childCount; i++) afterItems.push(list.child(i));
    const replacement = [];
    if (beforeItems.length) replacement.push(list.type.create(list.attrs, beforeItems));
    const paragraphPos = $from.before(listDepth) + (replacement[0]?.nodeSize ?? 0);
    replacement.push(schema.nodes.paragraph.create($from.parent.attrs, $from.parent.content));
    if (afterItems.length) replacement.push(list.type.create({
      ...list.attrs,
      ...(list.type === schema.nodes.ordered_list ? { order: list.attrs.order + index + (following.size ? 0 : 1) } : {}),
    }, afterItems));
    tr.replaceWith($from.before(listDepth), $from.after(listDepth), replacement);
    tr.setSelection(TextSelection.create(tr.doc, paragraphPos + 1));
    return tr;
  };
  const makeMarker = (tr) => {
    const { $from } = tr.selection;
    if ($from.depth < 2 || $from.node(-1).type !== item) return tr;
    const owner = $from.node(-1);
    const stepStart = tr.steps.length;
    const cursor = $from.pos;
    tr.split($from.before(), 1, [{
      type: item, attrs: { ...owner.attrs, continuation: false, checked: owner.attrs.checked === null ? null : false },
    }]);
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.slice(stepStart).map(cursor)));
    return tr;
  };
  const exitEmptyBody = (state, dispatch, deleting = false) => {
    const { $from } = state.selection;
    const previous = $from.node(-1).child($from.index(-1) - 1);
    let tr = state.tr;
    if (deleting || !previous.type.name.endsWith("_list")) tr = extractParagraph(tr);
    if (!deleting) makeMarker(tr);
    if (dispatch) dispatch(tr.setMeta("infinite-level-exit", true).scrollIntoView());
    return true;
  };
  const splitCurrentItem = (state, dispatch, view) => {
    const { $from, empty } = state.selection;
    if (empty && $from.parent.isTextblock && !$from.parent.type.spec.code
      && $from.parent.content.size === 0 && reduceParagraphIndent(state, dispatch)) return true;
    if ($from.depth >= 2 && $from.node(-1).type === item) {
      if ($from.index(-1) > 0) {
        if ($from.parent.type.spec.code) return false;
        if (empty && $from.parent.content.size === 0) return exitEmptyBody(state, dispatch);
        // Populated body text splits within the item. Empty body text exits
        // one level instead of accumulating blank continuation paragraphs.
        return splitBlockKeepMarks(state, dispatch, view);
      }
      if (empty && $from.parent.content.size === 0) {
        if (dispatch) dispatch(makeMarker(extractParagraph(state.tr)).setMeta("infinite-level-exit", true).scrollIntoView());
        return true;
      }
    }
    let task = false;
    let indent = 0;
    for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
      const ancestor = state.selection.$from.node(depth);
      if (ancestor.type === item) {
        task = ancestor.attrs.checked !== null;
        indent = ancestor.attrs.indent;
        break;
      }
    }
    return splitListItem(item, { checked: task ? false : null, indent })(state, dispatch && ((transaction) => {
      if (task || indent) {
        const { $from } = transaction.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const ancestor = $from.node(depth);
          if (ancestor.type === item) {
            transaction.setNodeMarkup($from.before(depth), undefined, {
              ...ancestor.attrs,
              checked: task ? false : null,
              indent,
            });
            break;
          }
        }
      }
      dispatch(transaction);
    }));
  };
  const deleteLevelAtStart = (state, dispatch, view) => {
    const { $cursor } = state.selection;
    if (!$cursor || $cursor.parentOffset !== 0 || $cursor.parent.type.spec.code) return false;
    if (reduceParagraphIndent(state, dispatch)) return true;
    if ($cursor.depth < 2 || $cursor.node(-1).type !== item) return false;
    if ($cursor.index(-1) === 0) {
      if ($cursor.node(-1).attrs.indent) return outdent(state, dispatch);
      // Remove the marker/wrapper first; do not concatenate the visible text
      // of two list items in the same keystroke.
      return joinBackward(state, dispatch, view);
    }
    // A blank body must survive each exit from a containing list. Only when
    // it has no remaining list levels may Backspace remove the paragraph.
    if ($cursor.parent.content.size === 0) return exitEmptyBody(state, dispatch, true);
    return false;
  };
  return {
    enter: isolated(splitCurrentItem),
    backspace: isolated(chainCommands(deleteSelection, deleteLevelAtStart, joinTextblockBackward, joinBackward, selectNodeBackward)),
    indent: isolated(changeIndent(schema, 1)),
    outdent: isolated(outdent),
  };
}

export function listKeyBindings(schema) {
  const commands = listCommands(schema);
  return {
    Enter: commands.enter,
    Backspace: commands.backspace,
    Tab: commands.indent,
    "Shift-Tab": commands.outdent,
  };
}
