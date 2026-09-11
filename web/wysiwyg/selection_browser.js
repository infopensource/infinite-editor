import { MinimalWysiwygEditor } from './editor.js';
import { undo, redo } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';

document.getElementById('host').classList.add('document-page-content');
const editor = new MinimalWysiwygEditor(document.getElementById('host'),
  '# 很长的标题与行内 格式\n\n## 很长的标题与行内 格式\n\n' +
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
  for (const wholeDocument of [false, true]) {
  for (const reverse of [false, true]) {
    const from = wholeDocument ? 1 : 12;
    const to = editor.state.doc.content.size - (wholeDocument ? 1 : 10);
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
    const nativeRange = document.getSelection().getRangeAt(0);
    const textRects = [];
    const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!nativeRange.intersectsNode(node)) continue;
      const range = document.createRange();
      range.setStart(node, node === nativeRange.startContainer ? nativeRange.startOffset : 0);
      range.setEnd(node, node === nativeRange.endContainer ? nativeRange.endOffset : node.length);
      textRects.push(...range.getClientRects());
    }
    for (const textRect of textRects) {
      if (!textRect.width || !textRect.height || textRect.bottom < 0 || textRect.top > innerHeight) continue;
      check(rects.some(rect => Math.abs((rect.top + rect.bottom - textRect.top - textRect.bottom) / 2) < 1
        && rect.left <= textRect.left + 1 && rect.right >= textRect.right - 1),
      `Selection does not align with text at zoom ${zoom}: text top ${textRect.top}, highlights ${rects.map(rect => rect.top)}`);
    }
    for (let i = 1; i < rects.length; i++) {
      const previous = rects[i - 1], current = rects[i];
      check(current.top >= previous.bottom - 0.1 || current.left >= previous.right - 0.1,
        'Selection rectangles overlap');
    }
    check(editor.state.doc.eq(before), 'Selection changed document');
    check(document.getSelection().toString().length > 0, 'Native selection was lost');
    results.push({ zoom, reverse, wholeDocument, rectangles: rects.length, height });
  }
  }
  }
  viewport.style.setProperty('--editor-zoom', 1);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
  await pause();
  check(!document.querySelector('.infinite-selection-layer > div'), 'Collapsed selection remains painted');
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 12, 85)));
  await pause();
  // Large multi-paragraph selections must not measure every offscreen line.
  const paragraphs = Array.from({ length: 300 }, (_, i) => editor.state.schema.nodes.paragraph.create(null,
    editor.state.schema.text(`长文本段落 ${i} ` + '中文 English words '.repeat(20))));
  editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, paragraphs));
  await pause();
  let selectionRangeReads = 0;
  const originalRects = Range.prototype.getClientRects;
  Range.prototype.getClientRects = function () {
    selectionRangeReads++;
    return originalRects.call(this);
  };
  try {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,
      1, editor.state.doc.content.size - 1)));
    await pause();
    check(selectionRangeReads < 120, `Offscreen selection measured ${selectionRangeReads} ranges`);
    check(document.querySelector('.infinite-selection-layer > div'), 'Large selection missing');
  } finally {
    Range.prototype.getClientRects = originalRects;
  }
  // A terminal table must offer a real paragraph when clicking below it,
  // including after pagination and when the click lands on paper padding.
  const tableSource = '| 编号 | 内容 |\n| --- | --- |\n' +
    Array.from({ length: 120 }, (_, i) => `| ${i + 1} | 跨页测试内容 ${i + 1} |`).join('\n');
  for (const zoom of [0.5, 1, 2]) {
    viewport.style.setProperty('--editor-zoom', zoom);
    editor.setMarkdown(tableSource);
    await new Promise(resolve => setTimeout(resolve, 500));
    const table = editor.state.doc.lastChild;
    check(table.type.name === 'table', 'Fixture must end in a table');
    const tableDOM = editor.view.nodeDOM(0);
    tableDOM.scrollIntoView({ block: 'end' });
    await pause();
    const clickBelow = target => {
      const rect = editor.view.nodeDOM(0).getBoundingClientRect();
      const content = editor.view.dom.getBoundingClientRect();
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true,
        button: 0, clientX: (content.left + content.right) / 2, clientY: rect.bottom + 12 });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const original = editor.state.doc;
    const cell = tableDOM.querySelector('td');
    const cellRect = cell.getBoundingClientRect();
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true,
      button: 0, clientX: cellRect.left + 4, clientY: cellRect.top + 4 }));
    check(editor.state.doc.eq(original), 'Clicking a cell inserted a paragraph');
    for (const modifiers of [{ button: 2 }, { button: 0, shiftKey: true }]) {
      const rect = tableDOM.getBoundingClientRect();
      editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true,
        clientX: rect.left + 10, clientY: rect.bottom + 12, ...modifiers }));
      check(editor.state.doc.eq(original), 'Modified click inserted a paragraph');
    }
    check(clickBelow(editor.view.dom), 'Blank editor click was not handled');
    check(editor.state.doc.childCount === 2 && editor.state.selection.$from.depth === 1,
      'Cursor remains in the terminal table');
    check(editor.state.selection.$from.parent.type.name === 'paragraph', 'Missing paragraph after table');
    editor.view.dispatch(editor.state.tr.insertText('表格后的新内容'));
    check(editor.state.doc.firstChild.eq(table), 'Typing changed table cells');
    check(editor.getMarkdown().endsWith('表格后的新内容'), 'Trailing content missing from Markdown');
    while (undo(editor.state, tr => editor.view.dispatch(tr))) {}
    check(editor.state.doc.childCount === 1, 'Undo did not restore terminal table');
    while (redo(editor.state, tr => editor.view.dispatch(tr))) {}
    check(editor.state.doc.lastChild.textContent === '表格后的新内容', 'Redo lost trailing paragraph');
    editor.setMarkdown(tableSource);
    await pause();
    check(clickBelow(editor.view.dom.closest('.infinite-pm-page')), 'Paper padding click was not handled');
    const after = editor.state.doc;
    const paragraphDOM = editor.view.nodeDOM(table.nodeSize);
    const rect = paragraphDOM.getBoundingClientRect();
    editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true,
      button: 0, clientX: rect.left + 10, clientY: rect.bottom + 20 }));
    check(editor.state.doc.eq(after), 'Repeated blank click added another paragraph');
  }
  document.getElementById('result').textContent = JSON.stringify({ ok: true, results, selectionRangeReads });
} catch (error) {
  document.getElementById('result').textContent = JSON.stringify({ ok: false, error: error.stack });
}
})();
