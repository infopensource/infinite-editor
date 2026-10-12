import { Plugin, TextSelection } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { openLinkDialog, validateLinkHref } from "../../link_dialog.js";
import { installDocumentLinkNavigation } from "../../link_navigation.js";

const editors = new WeakMap();

// A link may span several text nodes (bold/italic fragments). Expand by the
// actual mark, rather than the DOM anchor or just the node under the caret.
function linkAtCursor(state) {
  const { $from } = state.selection;
  const children = [];
  $from.parent.forEach((node, offset) => children.push({ node, from: $from.start() + offset, to: $from.start() + offset + node.nodeSize }));
  let index = children.findIndex(child => child.from <= $from.pos && child.to > $from.pos
    && state.schema.marks.link.isInSet(child.node.marks));
  if (index < 0) index = children.findIndex(child => child.to === $from.pos && state.schema.marks.link.isInSet(child.node.marks));
  if (index < 0) return null;
  const mark = state.schema.marks.link.isInSet(children[index].node.marks);
  let start = index;
  let end = index;
  while (start > 0 && mark.isInSet(children[start - 1].node.marks)) start -= 1;
  while (end + 1 < children.length && mark.isInSet(children[end + 1].node.marks)) end += 1;
  return { from: children[start].from, to: children[end].to, mark };
}

export function selectedLink(state) {
  if (state.selection.empty) return linkAtCursor(state);
  const { from, to } = state.selection;
  let mark = null;
  let mixed = false;
  let hasLink = false;
  state.doc.nodesBetween(from, to, node => {
    if (!node.isInline) return;
    const current = state.schema.marks.link.isInSet(node.marks);
    hasLink ||= !!current;
    if (!current || (mark && !mark.eq(current))) mixed = true;
    mark ??= current;
  });
  return { from, to, mark: mixed ? null : mark, hasLink };
}

function applicable(state, from, to) {
  const type = state.schema.marks.link;
  if (from === to) return state.selection.$from.parent.type.allowsMarkType(type)
    && !(state.storedMarks ?? state.selection.$from.marks()).some(mark => mark.type.excludes(type));
  let allowed = false;
  state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (node.isText && parent.type.allowsMarkType(type) && !node.marks.some(mark => mark.type !== type && mark.type.excludes(type))) allowed = true;
  });
  return allowed;
}

export function removeLink(state, dispatch, view) {
  const target = selectedLink(state);
  if (!target || !(target.mark || target.hasLink)) return false;
  if (dispatch) {
    dispatch(closeHistory(state.tr).removeMark(target.from, target.to, state.schema.marks.link)
      .removeStoredMark(state.schema.marks.link).scrollIntoView().setMeta("linkEdit", true));
    if (view) dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
  }
  return true;
}

export function editLink(state, dispatch, view) {
  if (!view || view.composing || !(state.selection instanceof TextSelection)) return false;
  const context = selectedLink(state);
  const { from, to } = context ?? state.selection;
  if (!applicable(state, from, to)) return false;
  const settings = editors.get(view);
  settings?.dialog?.close(false);
  settings?.onEdit?.("before");
  const originalDoc = state.doc;
  const text = state.doc.textBetween(from, to, "\n", "\ufffc");
  const textEditable = state.doc.resolve(from).sameParent(state.doc.resolve(to)) && !text.includes("\ufffc");
  const isCurrent = () => !view.isDestroyed && view.state.doc === originalDoc;
  const apply = (value, remove = false) => {
    if (!isCurrent()) return false;
    const current = view.state;
    let tr = closeHistory(current.tr).setSelection(TextSelection.create(current.doc, from, to));
    if (remove) tr.removeMark(from, to, current.schema.marks.link);
    else {
      if (validateLinkHref(value.href)) return false;
      const label = textEditable ? value.text || value.href : text;
      const mark = current.schema.marks.link.create({ href: value.href, title: context?.mark?.attrs.title ?? null });
      if (from === to || label !== text) {
        const $start = current.doc.resolve(from);
        const marks = (from === to ? current.storedMarks ?? $start.marks() : $start.nodeAfter?.marks ?? $start.marks())
          .filter(item => item.type !== current.schema.marks.link && !item.type.excludes(current.schema.marks.link));
        tr.replaceSelectionWith(current.schema.text(label, [...marks, mark]), false);
      } else tr.addMark(from, to, mark);
    }
    tr.removeStoredMark(current.schema.marks.link).setMeta("linkEdit", true);
    if (settings) settings.dialog = null;
    dispatch(tr.scrollIntoView());
    // Also separate subsequent typing in a standalone ProseMirror history.
    dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    settings?.onEdit?.("after");
    return true;
  };
  const dialog = openLinkDialog({
    ownerDocument: view.dom.ownerDocument,
    text, href: context?.mark?.attrs.href ?? "", hasLink: !!(context?.mark || context?.hasLink), textEditable,
    onSave: value => apply(value), onRemove: () => apply(null, true),
    onClose: () => {
      if (settings) settings.dialog = null;
      if (!view.isDestroyed) view.focus();
    },
  });
  if (settings) settings.dialog = dialog;
  return true;
}

export function linkEditorPlugin({ onEdit } = {}) {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return false;
        if (!event.shiftKey) return editLink(view.state, tr => view.dispatch(tr), view);
        onEdit?.("before");
        const changed = removeLink(view.state, tr => view.dispatch(tr), view);
        if (changed) onEdit?.("after");
        return changed;
      },
      handleDoubleClick(view, pos, event) {
        const anchor = event.target.closest?.("a[href]");
        if (!anchor || !view.dom.contains(anchor)) return false;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
        return editLink(view.state, tr => view.dispatch(tr), view);
      },
    },
    view(view) {
      const navigation = installDocumentLinkNavigation(view.dom.ownerDocument.defaultView);
      const settings = { onEdit, dialog: null };
      editors.set(view, settings);
      const update = (view, previous) => {
        if (previous && view.state.doc !== previous.doc) {
          navigation.hide();
          settings.dialog?.close(false);
          settings.dialog = null;
        }
        const target = selectedLink(view.state);
        const linked = !!(target?.mark || target?.hasLink);
        for (const button of view.dom.ownerDocument.querySelectorAll('[data-link-command="link"]')) {
          button.setAttribute("aria-pressed", String(linked));
          button.classList.toggle("active", linked);
        }
      };
      update(view);
      return {
        update,
        destroy() {
          navigation.hide();
          settings.dialog?.close(false);
          editors.delete(view);
          for (const button of view.dom.ownerDocument.querySelectorAll('[data-link-command="link"]')) {
            button.setAttribute("aria-pressed", "false");
            button.classList.remove("active");
          }
        },
      };
    },
  });
}
