import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { EditorState } from 'prosemirror-state';
import { parseMarkdown, serializeMarkdown } from './wysiwyg/markdown.js';
import { MarkdownProjection } from './wysiwyg/markdown/projection.js';
import { MarkdownPositionMapper } from './wysiwyg/markdown/position_mapper.js';
import { remarkReferenceBackend } from './wysiwyg/markdown/backend.js';

for (const path of ['web/wysiwyg/fixtures/infinite_ast_v1.md', 'web/wysiwyg/fixtures/regression.md', 'examples/long-paragraph-test/document.md']) {
  test(`incremental serialization matches the canonical serializer: ${path}`, () => {
    const doc = parseMarkdown(readFileSync(path, 'utf8'));
    const projection = new MarkdownProjection();
    assert.equal(projection.snapshot(doc).markdown, serializeMarkdown(doc));
  });
}

test('editing one block serializes and indexes only that block', () => {
  const doc = parseMarkdown(Array.from({ length: 400 }, (_, index) => `段落 ${index} **加粗** 正文`).join('\n\n'));
  const projection = new MarkdownProjection();
  const first = projection.snapshot(doc);
  doc.forEach((node, offset) => first.mapper.proseMirrorToSource(offset + 2));
  const before = { ...projection.stats };
  const changed = EditorState.create({ doc }).tr.insertText('修改', 3).doc;
  const second = projection.snapshot(changed);
  changed.forEach((node, offset) => second.mapper.proseMirrorToSource(offset + 2));
  assert.equal(projection.stats.serializedBlocks - before.serializedBlocks, 1);
  assert.equal(projection.stats.parsedBlocks - before.parsedBlocks, 1);
  assert.equal(second.markdown, serializeMarkdown(changed));
  assert.equal(projection.snapshot(doc), first);
});

test('block-relative position indexes remain correct after earlier blocks grow', () => {
  const doc = parseMarkdown('第一段\n\n中文 **粗体**\n\n| A | B |\n| --- | --- |\n| 值 | 内容 |');
  const changed = EditorState.create({ doc }).tr.insertText('新增文字', 1).doc;
  const projection = new MarkdownProjection();
  for (const current of [doc, changed]) {
    const { markdown, mapper } = projection.snapshot(current);
    const canonical = new MarkdownPositionMapper(remarkReferenceBackend.parse(markdown), current, markdown);
    for (const text of ['第一段', '中文', '粗体', '内容']) {
      const position = markdown.indexOf(text) + 1;
      assert.equal(mapper.sourceToProseMirror(position), canonical.sourceToProseMirror(position));
      const pmPosition = canonical.sourceToProseMirror(position);
      assert.equal(mapper.proseMirrorToSource(pmPosition), canonical.proseMirrorToSource(pmPosition));
    }
  }
});

test('incremental indexes preserve delimiter and inter-block cursor semantics', () => {
  const doc = parseMarkdown('**粗体**\n\n# 标题\n\n`代码`\n\n- 列表\n\n---\n\n末尾');
  const { markdown, mapper } = new MarkdownProjection().snapshot(doc);
  const canonical = new MarkdownPositionMapper(remarkReferenceBackend.parse(markdown), doc, markdown);
  for (let position = 0; position <= markdown.length; position++) {
    assert.equal(mapper.sourceToProseMirror(position), canonical.sourceToProseMirror(position), `source ${position}`);
  }
  for (let position = 0; position <= doc.content.size; position++) {
    assert.equal(mapper.proseMirrorToSource(position), canonical.proseMirrorToSource(position), `rich ${position}`);
  }
});
