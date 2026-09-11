import { installDocumentZoom } from './document_zoom.js';

installDocumentZoom(window);
const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const check = (value, message) => { if (!value) throw new Error(message); };
(async () => {
  try {
    const shell = document.createElement('div');
    shell.className = 'word-shell';
    shell.style.cssText = 'position:fixed;inset:0;display:block';
    shell.innerHTML = `<div class="document-workspace" style="height:100%">
      <aside style="width:180px">Outline</aside>
      <main class="editor-surface" style="--page-width:600px;--page-height:1200px">
        <div class="page-ruler-sticky"><div class="page-ruler"></div></div>
        <div class="infinite-pm-surface"><article class="document-page infinite-pm-page"><div style="height:2400px">Document</div></article></div>
      </main></div>`;
    document.body.append(shell);
    const viewport = shell.querySelector('main');
    const workspace = shell.firstElementChild;
    const page = shell.querySelector('article');
    const ruler = shell.querySelector('.page-ruler');
    const results = [];
    for (const zoom of [1, 2, 1, 0.5, 2, 0.8, 1]) {
      shell.style.setProperty('--editor-zoom', zoom);
      window.dispatchEvent(new Event('infinite-editor-zoom'));
      await pause();
      workspace.scrollLeft = 200;
      check(workspace.scrollLeft === 0, 'Outer workspace became a second horizontal scroller');
      if (zoom === 2) {
        viewport.scrollLeft = 0;
        await pause();
        const leftGap = page.getBoundingClientRect().left - viewport.getBoundingClientRect().left;
        viewport.scrollLeft = viewport.scrollWidth;
        viewport.scrollTop = 600;
        await pause();
        const rightGap = viewport.getBoundingClientRect().left + viewport.clientWidth * zoom
          - page.getBoundingClientRect().right;
        check(Math.abs(leftGap - 32 * zoom) < 1 && Math.abs(rightGap - leftGap) < 1,
          `Unequal edge spacing at ${zoom}: left=${leftGap}, right=${rightGap}`);
      }
      const bounds = viewport.getBoundingClientRect();
      const paper = page.getBoundingClientRect();
      const scale = paper.width / 600;
      const state = { zoom, scrollLeft: viewport.scrollLeft, outerScroll: workspace.scrollLeft,
        viewportLeft: bounds.left, pageLeft: paper.left, pageRight: paper.right, viewportRight: bounds.right };
      results.push(state);
      check(Math.abs(bounds.left - 181) < 1 && Math.abs(bounds.right - (innerWidth - 1)) < 1,
        `Viewport moved: ${JSON.stringify(state)}`);
      check(Math.abs(paper.left - ruler.getBoundingClientRect().left) < 1, 'Ruler/page misalignment');
      if (zoom <= 1) {
        check(viewport.scrollLeft === 0, `Stale horizontal scroll: ${JSON.stringify(state)}`);
        check(Math.abs((paper.left + paper.right - 2 * bounds.left - viewport.clientWidth * zoom) / 2) < 2 * scale,
          `Page failed to recenter: ${JSON.stringify(state)}`);
      }
    }
    document.getElementById('result').textContent = JSON.stringify({ ok: true, results });
  } catch (error) {
    document.getElementById('result').textContent = JSON.stringify({ ok: false, error: error.message + "\n" + error.stack });
  }
})();
