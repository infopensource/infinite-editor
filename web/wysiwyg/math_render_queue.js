import { workBudget } from './work_scheduler.js';

const pending = new Map();
let running = null;

function startDrain() {
  if (running || !pending.size) return;
  running = new Promise(resolve => setTimeout(resolve, 0)).then(async () => {
    const checkpoint = workBudget();
    while (pending.size) {
      const [element, job] = pending.entries().next().value;
      pending.delete(element);
      if (element.isConnected && window.InfiniteMathRenderer?.renderInto) {
        window.InfiniteMathRenderer.renderInto(element, job.value, job.displayMode);
      }
      await checkpoint();
    }
  }).finally(() => {
    running = null;
    // A microtask may enqueue another formula after the loop has completed.
    startDrain();
  });
}

export function queueMathRender(dom, value, displayMode) {
  pending.set(dom, { value, displayMode });
  startDrain();
}

export function cancelMathRender(dom) {
  pending.delete(dom);
}

export async function mathRenderingSettled() {
  while (running) await running;
}
