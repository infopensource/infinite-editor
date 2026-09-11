import { Plugin, TextSelection } from 'prosemirror-state';

// Paint text ranges ourselves: WebKit extends native cross-block highlights
// differently from the final line. The DOM selection still owns editing/copy.
export function selectionPlugin() {
  return new Plugin({
    view(view) {
      const host = view.dom.parentElement;
      const layer = document.createElement('div');
      layer.className = 'infinite-selection-layer';
      layer.setAttribute('aria-hidden', 'true');
      host.appendChild(layer);
      let frame = 0;
      let atomDocument, atomFrom, atomTo, hasAtom = false;
      function paint() {
        frame = 0;
        layer.replaceChildren();
        view.dom.classList.remove('infinite-painted-selection');
        const selection = view.state.selection;
        if (!(selection instanceof TextSelection) || selection.empty) return;
        // Atomic node views (math/images) own their selection appearance.
        if (atomDocument !== view.state.doc || atomFrom !== selection.from || atomTo !== selection.to) {
          atomDocument = view.state.doc;
          atomFrom = selection.from;
          atomTo = selection.to;
          hasAtom = false;
          view.state.doc.nodesBetween(selection.from, selection.to, node => {
            if (hasAtom) return false;
            if (node.isAtom && !node.isText && node.type.name !== 'hard_break') hasAtom = true;
          });
        }
        if (hasAtom) return;
        const origin = layer.getBoundingClientRect();
        const scale = origin.width / layer.offsetWidth || 1;
        const lines = [];
        const heights = new Map();
        const fragment = document.createDocumentFragment();
        view.state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
          // Skip whole offscreen subtrees before creating ranges or reading
          // inline styles. Keep viewport-spanning paragraphs eligible.
          if (node.isBlock) {
            const dom = view.nodeDOM(pos);
            if (dom instanceof Element) {
              const bounds = dom.getBoundingClientRect();
              if (bounds.bottom < 0 || bounds.top > innerHeight) return false;
            }
          }
          if (!node.isText) return;
          const start = view.domAtPos(Math.max(selection.from, pos));
          const end = view.domAtPos(Math.min(selection.to, pos + node.nodeSize));
          const range = document.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          // domAtPos can return an element at a paragraph/mark boundary.
          // Measure text-only ranges: element rectangles can include line boxes
          // with different vertical metrics from the actual selected glyphs.
          const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
          const textNodes = [];
          if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
            textNodes.push(range.commonAncestorContainer);
          } else {
            while (walker.nextNode()) {
              if (range.intersectsNode(walker.currentNode)) textNodes.push(walker.currentNode);
            }
          }
          for (const textNode of textNodes) {
            const textRange = document.createRange();
            textRange.setStart(textNode, textNode === start.node ? start.offset : 0);
            textRange.setEnd(textNode, textNode === end.node ? end.offset : textNode.length);
            if (textRange.collapsed) continue;
            const element = textNode.parentElement;
            let height = heights.get(element);
            if (height === undefined) {
              const style = getComputedStyle(element);
              height = (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2) * scale;
              heights.set(element, height);
            }
            for (const rect of textRange.getClientRects()) {
              if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
              const center = (rect.top + rect.bottom) / 2;
              let line = lines.find(line => Math.abs(line.center - center) < Math.min(height, line.height) / 3);
              if (!line) lines.push(line = { center, height, spans: [] });
              line.height = Math.max(line.height, height);
              line.spans.push({ left: rect.left, right: rect.right });
            }
          }
        });
        lines.sort((a, b) => a.center - b.center);
        lines.forEach((line, index) => {
          const top = Math.max(line.center - line.height / 2,
            index ? (lines[index - 1].center + line.center) / 2 : -Infinity);
          const bottom = Math.min(line.center + line.height / 2,
            index + 1 < lines.length ? (lines[index + 1].center + line.center) / 2 : Infinity);
          const spans = [];
          for (const span of line.spans.sort((a, b) => a.left - b.left)) {
            const last = spans.at(-1);
            if (last && span.left <= last.right + 1) last.right = Math.max(last.right, span.right);
            else spans.push({ ...span });
          }
          for (const span of spans) {
            const block = document.createElement('div');
            block.style.cssText = `left:${(span.left - origin.left) / scale}px;top:${(top - origin.top) / scale}px;width:${(span.right - span.left) / scale}px;height:${(bottom - top) / scale}px`;
            fragment.appendChild(block);
          }
        });
        layer.appendChild(fragment);
        if (lines.length) view.dom.classList.add('infinite-painted-selection');
      }
      function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
      window.addEventListener('scroll', schedule, true);
      window.addEventListener('resize', schedule);
      window.addEventListener('infinite-editor-zoom', schedule);
      document.fonts?.addEventListener('loadingdone', schedule);
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
      observer?.observe(view.dom);
      schedule();
      return {
        update: schedule,
        destroy() {
          cancelAnimationFrame(frame);
          observer?.disconnect();
          window.removeEventListener('scroll', schedule, true);
          window.removeEventListener('resize', schedule);
          window.removeEventListener('infinite-editor-zoom', schedule);
          document.fonts?.removeEventListener('loadingdone', schedule);
          view.dom.classList.remove('infinite-painted-selection');
          layer.remove();
        },
      };
    },
  });
}
