import { MinimalWysiwygEditor } from './editor.js';
import { TextSelection } from 'prosemirror-state';

const editor = new MinimalWysiwygEditor(document.getElementById('host'),
  'Ignore and prevent auxiliary mouse clicks on toolbar buttons\n\nMark toolbar buttons as non-submit buttons\n\n' +
  'Wrapped **bold** and *italic* text 中文选区验证 '.repeat(8));
const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const check = (value, message) => { if (!value) throw new Error(message); };
(async () => { try {
  await document.fonts.ready;
  await new Promise(resolve => setTimeout(resolve, 500));
  const before = editor.state.doc;
  const results = [];
  const viewport = document.querySelector('.editor-surface');
  const originalBounds = viewport.getBoundingClientRect();
  for (const zoom of [0.5, 0.8, 1, 1.5, 2]) {
  viewport.style.setProperty('--editor-zoom', zoom);
  window.dispatchEvent(new Event('infinite-editor-zoom'));
  for (const reverse of [false, true]) {
    const from = 12, to = editor.state.doc.content.size - 10;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,
      reverse ? to : from, reverse ? from : to)));
    editor.focus();
    await pause();
    const bounds = viewport.getBoundingClientRect();
    check(Math.abs(bounds.width - originalBounds.width) < 1 && Math.abs(bounds.height - originalBounds.height) < 1,
      'Scaled viewport no longer fills workspace');
    const rects = [...document.querySelectorAll('.infinite-selection-layer > div')]
      .map(element => element.getBoundingClientRect()).sort((a, b) => a.top - b.top || a.left - b.left);
    check(rects.length >= 4, 'Expected cross-paragraph and wrapped selection lines');
    const height = parseFloat(getComputedStyle(editor.view.dom).lineHeight) * zoom;
    for (const rect of rects) check(Math.abs(rect.height - height) < 1, 'Unequal selection line height');
    for (let i = 1; i < rects.length; i++) {
      const previous = rects[i - 1], current = rects[i];
      check(current.top >= previous.bottom - 0.1 || current.left >= previous.right - 0.1,
        'Selection rectangles overlap');
    }
    check(editor.state.doc.eq(before), 'Selection changed document');
    check(document.getSelection().toString().length > 0, 'Native selection was lost');
    results.push({ zoom, reverse, rectangles: rects.length, height });
  }
  }
  viewport.style.setProperty('--editor-zoom', 1);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
  await pause();
  check(!document.querySelector('.infinite-selection-layer > div'), 'Collapsed selection remains painted');
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 12, 85)));
  await pause();
  document.getElementById('result').textContent = JSON.stringify({ ok: true, results });
} catch (error) {
  document.getElementById('result').textContent = JSON.stringify({ ok: false, error: error.stack });
}
})();
