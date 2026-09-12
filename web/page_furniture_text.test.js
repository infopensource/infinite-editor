import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { toggleMark } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { pageTextSchema, pageFieldsToDoc, pageDocToFields, pageMarkActive } from './page_furniture_text.js';

test('selected text splits into independent runs, combines marks and supports local undo', () => {
  let state = EditorState.create({
    doc: pageFieldsToDoc([{ kind: 'text', value: '普通加粗结尾' }]),
    plugins: [history()],
  });
  const dispatch = tr => { state = state.apply(tr); };
  dispatch(state.tr.setSelection(TextSelection.create(state.doc, 3, 5)));
  toggleMark(pageTextSchema.marks.bold)(state, dispatch);
  assert.deepEqual(pageDocToFields(state.doc), [
    { kind: 'text', value: '普通' }, { kind: 'text', value: '加粗', marks: ['bold'] },
    { kind: 'text', value: '结尾' },
  ]);
  toggleMark(pageTextSchema.marks.italic)(state, dispatch);
  assert.equal(pageMarkActive(state, 'bold'), true);
  assert.equal(pageMarkActive(state, 'italic'), true);
  assert.deepEqual(pageDocToFields(state.doc)[1].marks, ['bold', 'italic']);
  undo(state, dispatch);
  assert.deepEqual(pageDocToFields(state.doc)[1].marks, ['bold']);
  redo(state, dispatch);
  assert.deepEqual(pageDocToFields(state.doc)[1].marks, ['bold', 'italic']);
  toggleMark(pageTextSchema.marks.bold)(state, dispatch);
  assert.deepEqual(pageDocToFields(state.doc)[1].marks, ['italic']);
});

test('caret formatting applies to newly inserted text and fields retain their own marks', () => {
  let state = EditorState.create({ doc: pageFieldsToDoc([
    { kind: 'text', value: '第' }, { kind: 'page', marks: ['bold'] },
    { kind: 'text', value: '/' }, { kind: 'pages', marks: ['italic', 'underline'] },
  ]) });
  const dispatch = tr => { state = state.apply(tr); };
  dispatch(state.tr.setSelection(NodeSelection.create(state.doc, 2)));
  toggleMark(pageTextSchema.marks.strikethrough)(state, dispatch);
  assert.deepEqual(pageDocToFields(state.doc)[1], { kind: 'page', marks: ['bold', 'strikethrough'] });
  assert.deepEqual(pageDocToFields(state.doc)[3], { kind: 'pages', marks: ['italic', 'underline'] });
  dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  toggleMark(pageTextSchema.marks.bold)(state, dispatch);
  dispatch(state.tr.insertText('新'));
  assert.deepEqual(pageDocToFields(state.doc).slice(0, 2), [
    { kind: 'text', value: '新', marks: ['bold'] }, { kind: 'text', value: '第' },
  ]);
  assert.deepEqual(pageDocToFields(pageFieldsToDoc(pageDocToFields(state.doc))), pageDocToFields(state.doc));
});

test('old fields stay readable and legacy region formatting expands to per-field marks', () => {
  const parts = [{ kind: 'text', value: '标题' }, { kind: 'page' }, { kind: 'pages' }];
  assert.deepEqual(pageDocToFields(pageFieldsToDoc(parts)), parts);
  assert.deepEqual(pageDocToFields(pageFieldsToDoc(parts, { bold: true })),
    parts.map(part => ({ ...part, marks: ['bold'] })));
});
