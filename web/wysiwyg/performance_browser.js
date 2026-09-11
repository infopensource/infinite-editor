import '../editor.js';
import { TextSelection } from 'prosemirror-state';
import { WysiwygBridgeSession } from './bridge/session.js';
import { remarkReferenceBackend } from './markdown/backend.js';
import { paginationKey, getPaginationMetrics } from './plugins/pagination.js';
import { mathRenderingSettled } from './math_render_queue.js';
import markdown from '../../examples/long-paragraph-test/document.md';
import sampleImage from '../../examples/long-paragraph-test/document.assets/sample-image.png';

let rangeReads = 0;
let phase = 'bootstrap';
const phases = [];
const tasks = [];
const originalRects = Range.prototype.getClientRects;
Range.prototype.getClientRects = function () { rangeReads++; return originalRects.call(this); };
const observer = new PerformanceObserver(list => {
  for (const task of list.getEntries()) tasks.push({ phase: phases.findLast(p => p.start <= task.startTime + 1)?.name ?? 'bootstrap', ms: task.duration });
});
observer.observe({ type: 'longtask', buffered: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const mark = name => { phase = name; phases.push({ name, start: performance.now() }); };
let session;
let pageStatus = { current: 1, total: 1 };
async function settle() {
  await mathRenderingSettled();
  await document.fonts.ready;
  await Promise.all([...session.editor.view.dom.querySelectorAll('img')].map(image => image.decode().catch(() => {})));
  const deadline = performance.now() + 12000;
  let stable = 0, previous = -1;
  while (performance.now() < deadline) {
    await delay(40);
    const metrics = getPaginationMetrics(session.editor.view);
    const idle = document.querySelector('.infinite-pm-page').dataset.paginationState === 'idle';
    stable = idle && previous === metrics.started ? stable + 1 : 0;
    previous = metrics.started;
    if (stable >= 3) return;
  }
  throw new Error(`Pagination did not settle: ${JSON.stringify(getPaginationMetrics(session.editor.view))}`);
}
function mount(source, ast) {
  const start = performance.now();
  session = new WysiwygBridgeSession({ host: document.getElementById('host'), ast, markdown: source,
    documentRevision: 1, editRevision: window.InfiniteMarkdownEditor.getSnapshot()?.editRevision ?? 0,
    onPageChange: status => { pageStatus = status; },
    resources: { 'document.assets/sample-image.png': sampleImage } });
  return performance.now() - start;
}
(async () => {
  await delay(0);
  mark('reference-parser'); // Production supplies Rust AST; this is the browser test adapter.
  const ast = remarkReferenceBackend.parse(markdown);
  await delay(0);
  mark('mount');
  const mountMs = mount(markdown, ast);
  await delay(0);
  mark('initial-layout');
  await settle();
  if (pageStatus.total <= 10) throw new Error(`Status bar page total was not updated: ${JSON.stringify(pageStatus)}`);
  const mountMetrics = session.editor.mountMetrics;
  const initialReads = rangeReads;
  await delay(200);
  const idleReads = rangeReads - initialReads;
  const beforeSelection = rangeReads;
  for (let position = 1; position < 15; position++) session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, position)));
  await delay(100);
  const selectionReads = rangeReads - beforeSelection;
  // Prime normalization independently from typing and retain the original source mapper.
  session.editor.getMarkdown();
  const statsBefore = { ...session.editor.projection.stats };
  await delay(0);
  mark('cancellation');
  // Invalidate geometry, then edit inside the next frame after the job starts.
  // The job yields before measuring; this edit must supersede that snapshot.
  window.dispatchEvent(new Event('infinite-math-renderer-ready'));
  await new Promise(resolve => requestAnimationFrame(() => {
    session.editor.view.dispatch(session.editor.state.tr.insertText('字'));
    resolve();
  }));
  await settle();
  mark('typing');
  const beforeEdit = rangeReads;
  let maxInputMs = 0, maxTimerLagMs = 0;
  for (let i = 0; i < 40; i++) {
    const start = performance.now();
    session.editor.view.dispatch(session.editor.state.tr.insertText('字'));
    maxInputMs = Math.max(maxInputMs, performance.now() - start);
    const scheduled = performance.now();
    await delay(8);
    maxTimerLagMs = Math.max(maxTimerLagMs, performance.now() - scheduled - 8);
  }
  session.flushChange();
  await settle();
  let longPosition = 1, longSize = 0;
  session.editor.state.doc.descendants((node, position) => {
    if (node.isTextblock && node.content.size > longSize) {
      longPosition = position + 1 + Math.floor(node.content.size / 2);
      longSize = node.content.size;
    }
  });
  session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, longPosition)));
  mark('long-paragraph-typing');
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    session.editor.view.dispatch(session.editor.state.tr.insertText('字'));
    maxInputMs = Math.max(maxInputMs, performance.now() - start);
    const scheduled = performance.now();
    await delay(8);
    maxTimerLagMs = Math.max(maxTimerLagMs, performance.now() - scheduled - 8);
  }
  session.flushChange();
  await settle();
  const editReads = rangeReads - beforeEdit;
  const metrics = { ...getPaginationMetrics(session.editor.view) };
  const stats = Object.fromEntries(Object.entries(session.editor.projection.stats).map(([key,value]) => [key,value-statsBefore[key]]));
  const switchStarted = performance.now();
  let saved = session.prepareModeSwitch().markdown;
  const modeSwitchMs = performance.now() - switchStarted;
  const sourceMatches = window.InfiniteMarkdownEditor.getValue() === saved;
  const pages = paginationKey.getState(session.editor.state).positions.length + 1;
  if (pageStatus.total !== pages) throw new Error(`Page status ${pageStatus.total} != pagination ${pages}`);
  session.editor.view.dispatch(session.editor.state.tr.setSelection(
    TextSelection.create(session.editor.state.doc, session.editor.state.doc.content.size),
  ));
  if (pageStatus.current !== pages) throw new Error(`Last-page selection reported ${JSON.stringify(pageStatus)}`);
  session.destroy();
  await delay(0);
  mark('source-mode');
  const sourceHost = document.createElement('div');
  sourceHost.id = 'source-test';
  const sourceBridge = document.createElement('textarea');
  sourceBridge.id = 'source-bridge';
  sourceHost.style.height = '500px';
  document.body.append(sourceHost, sourceBridge);
  const sourceStarted = performance.now();
  const sourceMounted = window.InfiniteMarkdownEditor.mount(sourceHost.id, sourceBridge.id, saved, 1);
  if (!sourceMounted.ok) throw new Error(sourceMounted.error);
  const sourceMountMs = performance.now() - sourceStarted;
  window.InfiniteMarkdownEditor.applyChange(saved.length, saved.length, '\n\n源码模式追加正文', 'source', 'input', true);
  saved = window.InfiniteMarkdownEditor.getValue();
  await delay(100);
  window.InfiniteMarkdownEditor.detach(sourceHost.id);
  sourceHost.remove(); sourceBridge.remove();
  await delay(0);
  mark('reference-parser');
  const reopenedAst = remarkReferenceBackend.parse(saved);
  await delay(0);
  mark('reopen');
  const beforeReopen = rangeReads;
  const reopenMs = mount(saved, reopenedAst);
  await settle();
  const roundtripMatches = session.editor.getMarkdown() === saved;
  const reopenReads = rangeReads - beforeReopen;
  const afterReopen = rangeReads;
  await delay(200);
  const reopenIdleReads = rangeReads - afterReopen;
  const longestByPhase = {};
  for (const task of tasks) longestByPhase[task.phase] = Math.max(longestByPhase[task.phase] ?? 0, task.ms);
  document.getElementById('result').textContent = JSON.stringify({
    ok: idleReads === 0 && selectionReads === 0 && reopenIdleReads === 0 && sourceMatches && roundtripMatches
      // A burst of keystrokes must share layout work, not launch a pass per key.
      && metrics.started < 15 && editReads < 6000
      && initialReads < 30000 && metrics.cancelled > 0 && stats.serializedBlocks <= 61 && stats.parsedBlocks <= 61
      && maxInputMs < 50 && maxTimerLagMs < 100,
    bytes: new TextEncoder().encode(markdown).length, mountMs, mountMetrics, modeSwitchMs, sourceMountMs, sourceMountMetrics: sourceMounted.mountMetrics, reopenMs, initialReads, reopenReads,
    longestByPhase, maxInputMs, maxTimerLagMs, longParagraphCharacters: longSize, metrics, stats, idleReads, selectionReads, editReads, reopenIdleReads,
    sourceMatches, roundtripMatches, pages,
  });
  observer.disconnect();
  session.destroy();
})().catch(error => { document.getElementById('result').textContent = JSON.stringify({ ok: false, phase, error: error.stack }); session?.destroy(); });
