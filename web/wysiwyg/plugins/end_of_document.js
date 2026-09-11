import { Plugin, TextSelection } from 'prosemirror-state';

// Paper padding is outside the editable DOM. Capture its clicks as well as
// clicks in the editor's minimum-height area before native table hit testing.
export function endOfDocumentPlugin() {
  return new Plugin({
    view(view) {
      const paper = view.dom.closest('.infinite-pm-page') ?? view.dom;
      const onMouseDown = event => {
        if (event.defaultPrevented || event.button !== 0 || event.shiftKey
          || event.ctrlKey || event.metaKey || event.altKey || view.composing || !view.editable) return;
        // Only blank paper/editor containers, never cells, furniture or controls.
        if (event.target !== paper && event.target !== view.dom
          && event.target !== view.dom.parentElement) return;
        const { doc, schema } = view.state;
        const last = doc.lastChild;
        if (!last) return;
        const lastDOM = view.nodeDOM(doc.content.size - last.nodeSize);
        if (!(lastDOM instanceof HTMLElement)) return;
        const bounds = lastDOM.getBoundingClientRect();
        const content = view.dom.getBoundingClientRect();
        if (event.clientY <= bounds.bottom || event.clientX < content.left
          || event.clientX > content.right) return;
        let tr = view.state.tr;
        if (!last.isTextblock) {
          const paragraph = schema.nodes.paragraph.createAndFill();
          if (!paragraph || !doc.canReplaceWith(doc.childCount, doc.childCount, paragraph.type)) return;
          const end = doc.content.size;
          tr = tr.insert(end, paragraph);
          tr.setSelection(TextSelection.create(tr.doc, end + 1));
        } else {
          tr.setSelection(TextSelection.create(doc, doc.content.size - 1));
        }
        event.preventDefault();
        view.dispatch(tr.scrollIntoView());
        view.focus();
      };
      paper.addEventListener('mousedown', onMouseDown, true);
      return { destroy() { paper.removeEventListener('mousedown', onMouseDown, true); } };
    },
  });
}
