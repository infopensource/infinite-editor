import '../editor.js';
import { WysiwygBridgeSession } from './bridge/session.js';
import { remarkReferenceBackend } from './markdown/backend.js';
import { MarkdownProjection } from './markdown/projection.js';
import { MeasurementWorkspace } from './measurement_snapshot.js';
import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';

let session, revision = 0, samples = [], timings = {}, inputStarted = null;
const record = (name, elapsed) => (timings[name] ??= []).push(elapsed);
function instrument(prototype, method, name = method) {
  const original = prototype[method];
  prototype[method] = function(...args) {
    const start = performance.now();
    try { return original.apply(this, args); }
    finally { record(name, performance.now() - start); }
  };
}
instrument(EditorView.prototype, 'updateState', 'viewUpdate');
instrument(WysiwygBridgeSession.prototype, 'captureHistoryStart');
instrument(WysiwygBridgeSession.prototype, 'flushChange');
instrument(MarkdownProjection.prototype, 'snapshot');
instrument(MarkdownProjection.prototype, 'sourceMapper');
const snapshot = MeasurementWorkspace.prototype.snapshot;
MeasurementWorkspace.prototype.snapshot = async function(...args) {
  const start = performance.now();
  const result = await snapshot.apply(this, args);
  record('measurementSnapshot', performance.now() - start);
  return result;
};
const longTasks = [];
const longTasksSupported = typeof PerformanceObserver !== 'undefined'
  && PerformanceObserver.supportedEntryTypes.includes('longtask');
if (longTasksSupported) {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  }).observe({ type: 'longtask', buffered: true });
}
document.addEventListener('keydown', event => {
  if (event.key !== 'x') return;
  inputStarted = event.timeStamp;
  record('eventQueue', Math.max(0, performance.now() - event.timeStamp));
}, true);
document.addEventListener('input', event => {
  if (!session?.editor.view.dom.contains(event.target) || inputStarted === null) return;
  const start = inputStarted;
  inputStarted = null;
  requestAnimationFrame(() => setTimeout(() => samples.push(performance.now() - start), 0));
}, true);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0,
    max: sorted.at(-1) ?? 0, total: values.reduce((a, b) => a + b, 0) };
};
window.inputProfiler = {
  async mount(characters, mode, sharedHistory = true) {
    session?.destroy();
    const paragraph = '这是一段用于检查大文档输入延迟的普通正文。每次只修改光标附近的几个字符，其他章节和段落都应该保持稳定。'.repeat(2);
    const source = Array.from({ length: Math.ceil(characters / (paragraph.length + 2)) }, (_, i) =>
      (i % 100 === 0 ? `# 第 ${i / 100 + 1} 章\n\n` : '') + paragraph).join('\n\n');
    const ast = remarkReferenceBackend.parse(source);
    document.querySelector('.infinite-pm-surface').className = `infinite-pm-surface ${mode}`;
    // The same page container survives successive sessions; do not accept the
    // previous session's idle marker before this session's first pagination.
    delete document.querySelector('.infinite-pm-page').dataset.paginationState;
    session = new WysiwygBridgeSession({ host: document.getElementById('host'), ast, markdown: source,
      documentRevision: ++revision, documentSession: sharedHistory ? window.InfiniteMarkdownEditor : null });
    await this.settle();
    return { characters: source.length, bytes: new TextEncoder().encode(source).length,
      blocks: session.editor.state.doc.childCount, domElements: document.querySelectorAll('*').length };
  },
  async settle() {
    const deadline = performance.now() + 60000;
    while (performance.now() < deadline) {
      const page = document.querySelector('.infinite-pm-page');
      if (page.dataset.paginationState === 'error') throw new Error('Pagination failed');
      if (page.dataset.paginationState === 'idle') {
        await pause(150);
        if (page.dataset.paginationState === 'idle') return;
      }
      await pause(40);
    }
    throw new Error('Pagination did not settle');
  },
  async select(atEnd) {
    const editor = session.editor;
    const position = atEnd ? editor.state.doc.content.size - 1 : 5;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)).scrollIntoView());
    editor.focus();
    await pause(200);
    timings = {}; samples = []; longTasks.length = 0;
    const originalDispatch = editor.view.dispatch.bind(editor.view);
    if (!editor.view.profiled) {
      editor.view.dispatch = transaction => {
        const start = performance.now();
        try { return originalDispatch(transaction); }
        finally { record(transaction.docChanged ? 'inputTransaction' : 'otherTransaction', performance.now() - start); }
      };
      editor.view.profiled = true;
    }
  },
  async report() {
    await pause(250);
    await this.settle();
    return { inputToPaint: summary(samples), longTasksSupported, longTasks: summary(longTasks),
      timings: Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, summary(values)])) };
  },
};
