import { MinimalWysiwygEditor } from './editor.js';
import { paginationKey, getPaginationMetrics } from './plugins/pagination.js';
import { MeasurementWorkspace } from './measurement_snapshot.js';

if (new URL(location.href).searchParams.get('case') === 'page-furniture') {
  import('./page_furniture_browser.js');
} else {

const paragraph = '中文分页测试 English **粗体** *斜体* 👩🏽‍💻，连续文字保持原段落。'.repeat(120);
const scenario = new URL(location.href).searchParams.get('case');
const markdown = scenario === 'table-long-header'
  ? '| ' + '超长单元格NoSpaces'.repeat(800) + ' | 短表头 |\n| --- | --- |\n| 末行 | 完整保留 |'
  : scenario === 'table-long-cell'
  ? '| 长文本 | 同行文本 |\n| --- | --- |\n| ' + paragraph + ' | ' + paragraph.repeat(2) + ' |\n| 末行 | 完整保留 |'
  : scenario === 'math-input' ? '' : scenario === 'table'
  ? '| 编号 | 项目 | 说明 |\n| --- | --- | --- |\n'
    + Array.from({ length: 80 }, (_, i) => `| ${i + 1} | 表格测试 | **第 ${i + 1} 行**保留三列宽度和连续行号。 |`).join('\n')
  : scenario === 'mixed'
    ? '```rust\n' + Array.from({ length: 100 }, (_, i) => `let value_${i} = "代码分页";`).join('\n') + '\n```\n\n'
      + '> 引用中的 **格式**\n>\n> ' + paragraph + '\n\n- [ ] ' + paragraph
      + '\n\n' + ('硬换行与 $x^2$、**粗体**  \n'.repeat(100))
    : '# 嵌套分页回归\n\n- 外层列表\n  - 子项目\n    - ' + paragraph
    + '\n\n> 引用\n>\n> ' + paragraph + '\n\n- [ ] ' + paragraph;
const progressObserved = [];
let slowEdit = false;
let slowStatusVisible = false;
if (scenario === 'progress') {
  const snapshot = MeasurementWorkspace.prototype.snapshot;
  MeasurementWorkspace.prototype.snapshot = async function(signal) {
    const page = document.querySelector('.infinite-pm-page');
    const status = document.querySelector('.editor-layout-status[aria-live]');
    progressObserved.push({
      working: page?.dataset.paginationState === 'working'
        && page.getAttribute('aria-busy') === 'true' && status && !status.hidden,
      delayed: status?.classList.contains('editor-layout-status-delayed'),
      opacity: Number.parseFloat(getComputedStyle(status).opacity),
    });
    if (slowEdit) {
      slowEdit = false;
      await new Promise(resolve => setTimeout(resolve, 950));
      slowStatusVisible = !status.hidden && Number.parseFloat(getComputedStyle(status).opacity) > 0.95;
    }
    return snapshot.call(this, signal);
  };
}
let editor = new MinimalWysiwygEditor(document.getElementById('host'), markdown);
const before = editor.state.doc;
const initialWidths = [...editor.view.dom.querySelectorAll('th')].map(cell => cell.getBoundingClientRect().width);
let updates = 0;
const dispatch = editor.view.dispatch.bind(editor.view);
editor.view.dispatch = transaction => { updates++; dispatch(transaction); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const delay = async () => {
  await document.fonts.ready;
  for (let i = 0; i < 150; i++) {
    await pause(40);
    if (page.dataset.paginationState === 'idle') { await pause(80); if (page.dataset.paginationState === 'idle') return; }
  }
  throw new Error('Pagination failed to settle');
};
const page = document.querySelector('.infinite-pm-page');
const surface = document.querySelector('.infinite-pm-surface');
function verify() {
  const scale = Number(surface.dataset.zoom) || 1;
  const paints = [...page.querySelectorAll('.infinite-pm-page-chrome')];
  assert(paginationKey.getState(editor.state).positions.length > 2, 'Expected multiple physical pages');
  assert(paints.length > 0, 'Viewport has no page chrome');
  const pageRect = page.getBoundingClientRect();
  if (scenario.startsWith('table-long-')) {
    const style = getComputedStyle(page);
    const contentHeight = (parseFloat(style.getPropertyValue('--page-height'))
      - parseFloat(style.getPropertyValue('--page-padding-top'))
      - parseFloat(style.getPropertyValue('--page-padding-bottom'))) * 96 / 25.4;
    let start = editor.view.dom.getBoundingClientRect().top;
    for (const gap of [...editor.view.dom.querySelectorAll('.infinite-pm-page-gap:not([data-secondary])')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)) {
      const rect = gap.getBoundingClientRect();
      assert(rect.top - start <= contentHeight * scale + 1, `Table exceeded paper content height: ${rect.top - start} > ${contentHeight}`);
      start = rect.bottom;
    }
  }
  for (const paint of paints) {
    const rect = paint.getBoundingClientRect();
    assert(Math.abs(rect.left - pageRect.left) < 1, 'Page gap left edge follows an indented ancestor');
    assert(Math.abs(rect.width - pageRect.width) < 1, 'Page gap does not cover the physical page');
    assert(rect.height > 20, 'Page gap has no height');
    const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim() || text.parentElement.closest(".katex-mathml")) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const line of range.getClientRects()) {
        if (line.width === 0 || line.height === 0) continue;
        if (scenario.startsWith('table-long-')) {
          assert(line.left >= pageRect.left && line.right <= pageRect.right, 'Cell text exceeded paper width');
        }
        assert(line.bottom <= rect.top + 1 || line.top >= rect.bottom - 1,
          `Page chrome covers text: ${text.textContent.slice(0, 30)} (line ${line.top}–${line.bottom}, gap ${rect.top}–${rect.bottom})`);
      }
    }
  }
  const widths = [...editor.view.dom.querySelectorAll('th')].map(cell => cell.getBoundingClientRect().width);
  widths.forEach((width, i) => assert(Math.abs(width / scale - initialWidths[i]) < 1, 'Pagination changed table column widths'));
  assert(editor.state.doc.eq(before), 'Pagination changed document structure');
  return paginationKey.getState(editor.state).positions.length;
}
(async () => {
  try {
    if (scenario === 'math-input') {
      const tex = String.raw`H_1=\liminf_{n\to\infty}(p_{n+1}-p_n)\le 186`;
      const input = '**回到这个数学问题上**，相邻素数的差满足 $' + tex + '$，后续正文保持普通文字。';
      for (const character of input) {
        const { from, to } = editor.state.selection;
        const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, character));
        if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to));
      }
      const source = editor.getMarkdown();
      for (let index = 0; index < 3; index++) {
        await delay();
        const formulas = editor.view.dom.querySelectorAll('.math-inline');
        assert(formulas.length === 1, 'Expected exactly one formula');
        assert(formulas[0].dataset.mathSource === tex, 'Source-mode switch changed raw TeX');
        assert(formulas[0].querySelector('.katex') && !formulas[0].querySelector('.katex-error'), 'Formula did not render');
        assert(editor.getMarkdown() === source, `Source-mode round trip changed Markdown: ${source} => ${editor.getMarkdown()}`);
        if (index < 2) {
          editor.destroy();
          editor = new MinimalWysiwygEditor(document.getElementById('host'), source);
        }
      }
      document.getElementById('result').textContent = JSON.stringify({ ok: true, roundTrips: 2, formulas: 1 });
      return;
    }
    await delay();
    if (scenario === 'progress') {
      assert(progressObserved.length === 1 && progressObserved[0].working
        && !progressObserved[0].delayed, 'Initial layout began without visible progress');
      const status = document.querySelector('.editor-layout-status[aria-live]');
      assert(status.parentElement === document.body, 'Progress was trapped inside the zoomed editor');
      assert(status.hidden, 'Progress remained after layout');
      assert(!page.hasAttribute('aria-busy'), 'Editor remained busy after layout');
      page.style.setProperty('--page-height', '160mm');
      await delay();
      assert(progressObserved.length === 2 && progressObserved[1].working
        && !progressObserved[1].delayed, 'Reflow began without visible progress');
      editor.view.dispatch(editor.state.tr.insertText('字'));
      await delay();
      assert(progressObserved.length === 3 && progressObserved[2].working
        && progressObserved[2].delayed && progressObserved[2].opacity === 0,
      'Ordinary typing showed a layout notification');
      assert(status.hidden, 'Typing notification remained after layout');
      slowEdit = true;
      editor.view.dispatch(editor.state.tr.insertText('字'));
      await delay();
      assert(progressObserved.length === 4 && progressObserved[3].delayed && slowStatusVisible,
        'Slow typing layout never revealed progress');
      assert(status.hidden, 'Slow typing notification remained after layout');
      document.getElementById('result').textContent = JSON.stringify({ ok: true, initial: true, reflow: true, quietTyping: true, slowProgress: true });
      return;
    }
    const pages = verify();
    const stableUpdates = updates;
    const layouts = getPaginationMetrics(editor.view).started;
    const originalWidth = page.getBoundingClientRect().width;
    for (const zoom of [0.5, 0.8, 1.5, 2, 1]) {
      surface.dataset.zoom = zoom;
      surface.style.transform = `scale(${zoom})`;
      surface.style.transformOrigin = 'top left';
      window.dispatchEvent(new Event('infinite-editor-zoom'));
      await pause(120);
      assert(Math.abs(page.getBoundingClientRect().width - originalWidth * zoom) < 1,
        'Paper magnification does not match zoom');
      assert(verify() === pages, 'Zoom changed page boundaries');
      assert(getPaginationMetrics(editor.view).started === layouts, 'Zoom triggered full pagination');
      assert(updates === stableUpdates, 'Zoom dispatched an editor transaction');
    }
    window.dispatchEvent(new Event('resize'));
    await delay();
    verify();
    assert(updates === stableUpdates, 'Pagination did not converge');
    page.style.setProperty('--page-height', '160mm');
    window.dispatchEvent(new Event('resize'));
    await delay();
    verify();
    surface.classList.replace('paged', 'seamless');
    window.dispatchEvent(new Event('resize'));
    await delay();
    assert(paginationKey.getState(editor.state).positions.length === 0, 'Seamless mode retains page gaps');
    assert(!page.querySelector('.infinite-pm-page-chrome'), 'Seamless mode retains page paint');
    surface.classList.replace('seamless', 'paged');
    page.style.setProperty('--page-height', '120mm');
    window.dispatchEvent(new Event('resize'));
    await delay();
    verify();
    for (const ratio of [0.5, 0.9, 0]) {
      window.scrollTo(0, (page.scrollHeight - innerHeight) * ratio);
      await pause(80);
      verify();
    }
    const gap = page.querySelector('.infinite-pm-page-chrome');
    window.scrollTo(0, Math.max(0, gap.getBoundingClientRect().top + window.scrollY - 220));
    document.getElementById('result').textContent = JSON.stringify({ ok: true, pages: pages + 1, updates });
  } catch (error) {
    document.getElementById('result').textContent = JSON.stringify({ ok: false, error: error.message });
  }
})();

}
