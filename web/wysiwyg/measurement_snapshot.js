import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createNodeViews } from './node_views.js';
import { checkCancelled, yieldToInput } from './work_scheduler.js';

// One read-only layout workspace per editor. It shares immutable model nodes
// and uses ProseMirror's DOM reconciliation, instead of cloning the whole live
// document on every keystroke. It never owns history, selection or page gaps.
export class MeasurementWorkspace {
  constructor(sourceView) {
    this.sourceView = sourceView;
    this.editor = null;
  }

  async snapshot(signal) {
    await yieldToInput(signal);
    const source = this.sourceView;
    const doc = source.state.doc;
    const width = getComputedStyle(source.dom).width;
    if (!this.editor) {
      const root = document.createElement('div');
      Object.assign(root.style, { position: "absolute", left: "-100000px", top: "0", width, visibility: "hidden", contain: "layout paint style" });
      source.dom.parentElement.appendChild(root);
      const cloneAtom = (node, _view, getPos) => ({
        dom: source.nodeDOM(getPos()).cloneNode(true),
        ignoreMutation: () => true,
        update: next => next.eq(node),
      });
      this.editor = new EditorView({ mount: root }, {
        state: EditorState.create({ doc }),
        editable: () => false,
        attributes: { 'aria-hidden': 'true', tabindex: '-1' },
        nodeViews: {
          ...createNodeViews(() => ({})),
          image: cloneAtom, math_inline: cloneAtom, math_block: cloneAtom,
        },
      });
      root.inert = true;
    } else if (this.editor.state.doc !== doc) {
      this.editor.updateState(EditorState.create({ doc }));
    }
    const root = this.editor.dom;
    Object.assign(root.style, {
      position: 'absolute', left: '-100000px', top: '0',
      width,
      minHeight: '0', height: 'auto', paddingBottom: '0',
      visibility: 'hidden', pointerEvents: 'none', contain: 'layout paint style',
    });
    // Image resources can change without changing the immutable document.
    doc.descendants((node, position) => {
      if (node.type.name === 'image') {
        const original = source.nodeDOM(position);
        const copy = this.editor.nodeDOM(position);
        if (original?.src && copy.src !== original.src) copy.src = original.src;
      }
    });
    checkCancelled(signal);
    const editor = this.editor;
    return {
      dom: editor.dom, state: { doc },
      nodeDOM: position => editor.nodeDOM(position),
      posAtDOM: (node, offset) => editor.posAtDOM(node, offset),
      domAtPos: (position, side) => editor.domAtPos(position, side),
      destroy() {}, // workspace lifetime belongs to the live editor, not a job
    };
  }

  destroy() {
    const root = this.editor?.dom;
    this.editor?.destroy();
    root?.remove();
    this.editor = null;
  }
}
