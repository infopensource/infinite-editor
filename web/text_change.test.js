import assert from 'node:assert/strict';
import test from 'node:test';
import { minimalTextChange } from './text_change.js';

test('rich snapshots produce a local source transaction', () => {
  const suffix = ' unchanged'.repeat(20000);
  assert.deepEqual(minimalTextChange('before' + suffix, 'after' + suffix), { from: 0, to: 6, insert: 'after' });
  assert.equal(minimalTextChange(suffix, suffix), null);
});

test('minimal changes preserve Unicode and reproduce the exact new source', () => {
  for (const [before, after] of [['a😀b', 'a😃b'], ['a😀b', 'ab'], ['', '中文'], ['abc', ''], ['前 **格式** 后', '前 *格式* 后']]) {
    const change = minimalTextChange(before, after);
    assert.equal(before.slice(0, change.from) + change.insert + before.slice(change.to), after);
    assert.ok(!/[\uDC00-\uDFFF]/u.test(before[change.from] ?? ''));
  }
});
