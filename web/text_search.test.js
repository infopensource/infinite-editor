import test from 'node:test';
import assert from 'node:assert/strict';
import { findTextMatches, searchIndex } from './text_search.js';
test('literal search supports Chinese, emoji offsets and regex characters', () => {
  assert.deepEqual(findTextMatches('😀中文 中文', '中文'), [{ from: 2, to: 4 }, { from: 5, to: 7 }]);
  assert.deepEqual(findTextMatches('a.b aXb', 'a.b', 10), [{ from: 10, to: 13 }]);
  assert.deepEqual(findTextMatches('Aa', 'a'), [{ from: 0, to: 1 }, { from: 1, to: 2 }]);
  assert.deepEqual(findTextMatches('text', ''), []);
});
test('navigation wraps in both directions, including empty results', () => {
  assert.equal(searchIndex(-1, 3), 2);
  assert.equal(searchIndex(3, 3), 0);
  assert.equal(searchIndex(0, 0), -1);
});
