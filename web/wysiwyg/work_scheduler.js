// A microtask does not let the browser process input or paint. Yield to a
// separate task, with cancellation checked on both sides of the boundary.
export function checkCancelled(signal) {
  if (signal?.aborted) throw new DOMException('Superseded editor work', 'AbortError');
}

export async function yieldToInput(signal) {
  checkCancelled(signal);
  if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
  else await new Promise(resolve => setTimeout(resolve, 0));
  checkCancelled(signal);
}

export function workBudget(signal, milliseconds = 6, maxOperations = 128, onSlice = () => {}) {
  let started = performance.now();
  let deadline = started + milliseconds;
  let operations = 0;
  const checkpoint = async () => {
    checkCancelled(signal);
    if (++operations < maxOperations && performance.now() < deadline) return;
    onSlice(performance.now() - started);
    await yieldToInput(signal);
    started = performance.now();
    deadline = started + milliseconds;
    operations = 0;
  };
  checkpoint.finish = () => onSlice(performance.now() - started);
  return checkpoint;
}

// Waiting on shared work must not keep an obsolete document revision alive.
export function cancellable(promise, signal) {
  checkCancelled(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException('Superseded editor work', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); },
    );
  });
}
