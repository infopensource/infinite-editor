import assert from 'node:assert/strict';
import test from 'node:test';
import { workBudget, yieldToInput } from './wysiwyg/work_scheduler.js';
import { queueMathRender, cancelMathRender, mathRenderingSettled } from './wysiwyg/math_render_queue.js';

test('cooperative work yields to the event loop and rejects a superseded job', async () => {
  const controller = new AbortController();
  const checkpoint = workBudget(controller.signal, 1000, 1);
  let serviced = false;
  setTimeout(() => { serviced = true; controller.abort(); }, 0);
  await assert.rejects(checkpoint(), { name: 'AbortError' });
  assert.equal(serviced, true);
  await assert.rejects(yieldToInput(controller.signal), { name: 'AbortError' });
});

test('math rendering coalesces pending values and drops destroyed nodes', async () => {
  const rendered = [];
  globalThis.window = { InfiniteMathRenderer: { renderInto: (dom, value) => rendered.push([dom, value]) } };
  const live = { isConnected: true }, cancelled = { isConnected: true }, removed = { isConnected: false };
  queueMathRender(live, 'old', false);
  queueMathRender(live, 'new', false);
  queueMathRender(cancelled, 'cancelled', false);
  cancelMathRender(cancelled);
  queueMathRender(removed, 'removed', false);
  await mathRenderingSettled();
  assert.deepEqual(rendered, [[live, 'new']]);
  queueMathRender(live, 'later', false);
  await mathRenderingSettled();
  assert.equal(rendered.at(-1)[1], 'later');
  delete globalThis.window;
});

test('cancelling a revision does not wait for unrelated shared work', async () => {
  const { cancellable } = await import('./wysiwyg/work_scheduler.js');
  const controller = new AbortController();
  const waiting = cancellable(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
});
