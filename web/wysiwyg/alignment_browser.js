import { MinimalWysiwygEditor } from './editor.js';
import { toolbarCommands } from './commands/toolbar.js';
import { TextSelection } from 'prosemirror-state';

try {
  const editor = new MinimalWysiwygEditor(document.getElementById('host'), '中文段落 English words '.repeat(24));
  const commands = toolbarCommands(editor.state.schema);
  const results = [];
  for (const align of ['left', 'center', 'right', 'justify']) {
    commands[`align_${align}`](editor.state, tr => editor.view.dispatch(tr));
    const paragraph = editor.view.dom.querySelector('p');
    const style = getComputedStyle(paragraph);
    if (style.textAlign !== align || style.textAlignLast !== 'auto') throw new Error(`Incorrect style: ${align}`);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
    const bounds = paragraph.getBoundingClientRect();
    const first = rects[0];
    if (align === 'center' && Math.abs((first.left + first.right) / 2 - (bounds.left + bounds.right) / 2) > 2) throw new Error('Center alignment geometry');
    if (align === 'right' && Math.abs(first.right - bounds.right) > 2) throw new Error('Right alignment geometry');
    if (align === 'justify' && Math.abs(first.width - bounds.width) > 3) throw new Error('Justification geometry');
    results.push({ align, lines: rects.length });
  }
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  if (editor.state.doc.childCount !== 2 || editor.state.doc.lastChild.attrs.textAlign !== 'justify') throw new Error('Enter lost paragraph alignment');
  document.getElementById('result').textContent = JSON.stringify({ ok: true, results });
} catch (error) {
  document.getElementById('result').textContent = JSON.stringify({ ok: false, error: error.stack });
}
