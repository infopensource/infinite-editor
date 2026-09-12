import { Schema, Slice } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { toggleMark, selectAll } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { InputRule, inputRules, undoInputRule } from 'prosemirror-inputrules';
import { PAGE_TEXT_MARKS, pageFieldMarks, parsePageFields } from './page_furniture.js';

export const pageTextSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph' },
    paragraph: { content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    text: { group: 'inline' },
    field: {
      inline: true, group: 'inline', atom: true,
      attrs: { kind: {} },
      leafText: node => `{${node.attrs.kind}}`,
      parseDOM: [{ tag: 'span[data-page-field]', getAttrs: dom =>
        ['page', 'pages'].includes(dom.dataset.pageField) ? { kind: dom.dataset.pageField } : false }],
      toDOM: node => ['span', { class: 'page-furniture-field', 'data-page-field': node.attrs.kind, contenteditable: 'false' }, `{${node.attrs.kind}}`],
    },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=bold' }] },
    italic: { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }] },
    underline: { toDOM: () => ['u', 0], parseDOM: [{ tag: 'u' }] },
    strikethrough: { toDOM: () => ['s', 0], parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }] },
  },
});

export function pageFieldsToDoc(parts, style = {}) {
  const nodes = parts.filter(part => part.kind !== 'image').flatMap(part => {
    const marks = pageFieldMarks(part, style).map(mark => pageTextSchema.marks[mark].create());
    return part.kind === 'text'
      ? (part.value ? [pageTextSchema.text(part.value, marks)] : [])
      : [pageTextSchema.nodes.field.create({ kind: part.kind }, null, marks)];
  });
  return pageTextSchema.node('doc', null, [pageTextSchema.node('paragraph', null, nodes)]);
}
export function pageDocToFields(doc) {
  const parts = [];
  doc.firstChild.forEach(node => {
    const marks = node.marks.map(mark => mark.type.name);
    const fields = node.isText ? parsePageFields(node.text) : [{ kind: node.attrs.kind }];
    for (const part of fields) parts.push(marks.length ? { ...part, marks } : part);
  });
  return parts;
}
export function pageMarkActive(state, name) {
  const type = pageTextSchema.marks[name];
  const { from, to, empty, $from } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks || $from.marks()));
  let found = false, all = true;
  state.doc.nodesBetween(from, to, node => {
    if (node.isInline) { found = true; all &&= Boolean(type.isInSet(node.marks)); }
  });
  return found && all;
}

export function mountPageTextEditor(slot, parts, style, onChange) {
  const host = slot.querySelector('[data-field="text"]');
  const label = host.getAttribute('aria-label');
  host.removeAttribute('aria-label');
  const buttons = [...slot.querySelectorAll('[data-mark]')];
  const updateButtons = state => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(pageMarkActive(state, button.dataset.mark)));
  };
  const commands = Object.fromEntries(PAGE_TEXT_MARKS.map(name => [name, toggleMark(pageTextSchema.marks[name], null, { removeWhenPresent: false })]));
  const fieldRule = new InputRule(/\{(page|pages)\}$/, (state, match, start, end) =>
    state.tr.replaceWith(start, end, pageTextSchema.nodes.field.create({ kind: match[1] }, null,
      state.storedMarks || state.selection.$from.marks())));
  const state = EditorState.create({
    schema: pageTextSchema, doc: pageFieldsToDoc(parts, style),
    plugins: [
      inputRules({ rules: [fieldRule] }), history(),
      keymap({ 'Mod-b': commands.bold, 'Mod-i': commands.italic, 'Mod-u': commands.underline,
        'Mod-Shift-x': commands.strikethrough, 'Mod-z': undo, 'Mod-Shift-z': redo,
        'Mod-y': redo, 'Mod-a': selectAll, Backspace: undoInputRule }),
    ],
  });
  const view = new EditorView(host, {
    state,
    attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'false', class: 'page-furniture-text-editor' },
    dispatchTransaction(transaction) {
      const next = view.state.apply(transaction);
      view.updateState(next);
      updateButtons(next);
      if (transaction.docChanged) onChange(pageDocToFields(next.doc));
    },
    handleKeyDown(_view, event) {
      if (event.key !== 'Enter' || event.isComposing || view.composing) return false;
      event.preventDefault();
      return true;
    },
    handleDOMEvents: {
      beforeinput(_view, event) {
        if (!['insertParagraph', 'insertLineBreak'].includes(event.inputType)) return false;
        event.preventDefault();
        return true;
      },
      drop(_view, event) { event.preventDefault(); return true; },
    },
    handlePaste(_view, event, slice) {
      // These slots accept single-line text; images use the explicit image picker.
      const text = event.clipboardData?.getData('text/plain').replace(/[\r\n\t]+/g, ' ');
      if (text == null) return false;
      const marks = view.state.storedMarks || view.state.selection.$from.marks();
      const copied = [];
      if (event.clipboardData.getData('text/html').includes('data-pm-slice')) {
        const collect = node => {
          if (node.isText) copied.push(...parsePageFields(node.text.replace(/[\r\n\t]+/g, ' '))
            .map(part => ({ ...part, marks: node.marks.map(mark => mark.type.name) })));
          else if (node.type === pageTextSchema.nodes.field) copied.push({ kind: node.attrs.kind,
            marks: node.marks.map(mark => mark.type.name) });
          else node.forEach(collect);
        };
        slice.content.forEach((node, _offset, index) => {
          if (index && node.isBlock) copied.push({ kind: 'text', value: ' ' });
          collect(node);
        });
      }
      const fragment = pageFieldsToDoc(copied.length ? copied : parsePageFields(text).map(part =>
        ({ ...part, marks: marks.map(mark => mark.type.name) }))).firstChild.content;
      view.dispatch(view.state.tr.replaceSelection(new Slice(fragment, 0, 0)).scrollIntoView());
      return true;
    },
  });
  for (const button of buttons) {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      if (view.composing) return;
      commands[button.dataset.mark](view.state, view.dispatch);
      view.focus();
    });
  }
  updateButtons(state);
  return view;
}
