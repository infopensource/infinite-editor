import '../editor.js';
import { WysiwygBridgeSession } from './bridge/session.js';
import { remarkReferenceBackend } from './markdown/backend.js';
import { paginationKey, getPaginationMetrics } from './plugins/pagination.js';
import { defaultPageFurniture, pageMetrics, validatePageFurniture } from '../page_furniture.js';
import { paginate } from '../document_renderer/pagination.js';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = document.querySelector('.infinite-pm-surface');
root.dataset.pageFurniture = JSON.stringify(defaultPageFurniture());
root.dataset.pageLayout = JSON.stringify({ paper: { mode: 'custom', width_mm: 210, height_mm: 120 },
  margins: { top_mm: 15, bottom_mm: 15, left_mm: 22, right_mm: 22 } });
const bridge = document.createElement('textarea');
bridge.id = 'bridge'; bridge.hidden = true; document.body.appendChild(bridge);
const markdown = '# 正文\n\n' + ('内容 中文 English '.repeat(30) + '\n\n').repeat(10)
  + '\n\n<!-- infinite-editor:page-break -->\n';
const session = new WysiwygBridgeSession({ host: document.getElementById('host'), bridge,
  markdown, ast: remarkReferenceBackend.parse(markdown), documentRevision: 1 });
const editor = session.editor;
const page = document.querySelector('.infinite-pm-page');
const api = window.InfiniteMarkdownEditor;
async function settled() {
  for (let i = 0; i < 150; i++) {
    await pause(40);
    if (page.dataset.paginationState === 'idle') { await pause(100); return; }
  }
  throw new Error('Pagination did not settle');
}
function verifyRegions(total, zoom = 1) {
  const metrics = pageMetrics(page);
  const bounds = page.getBoundingClientRect();
  const headers = [...page.querySelectorAll('.infinite-page-header')];
  const footers = [...page.querySelectorAll('.infinite-page-footer')];
  assert(headers.length > 0 && footers.length > 0, 'No visible page regions');
  for (const footer of footers) {
    const number = Number(footer.dataset.pageNumber);
    assert(footer.textContent === `第 ${number} 页 / 共 ${total} 页`, 'Incorrect dynamic footer');
    const rect = footer.getBoundingClientRect();
    const gaps = [...editor.view.dom.querySelectorAll('.infinite-pm-page-gap:not([data-secondary])')];
    if (number <= gaps.length) {
      const paperBottom = gaps[number - 1].getBoundingClientRect().bottom - (metrics.top + 20) * zoom;
      assert(Math.abs(rect.bottom + 2 * 96 / 25.4 * zoom - paperBottom) < 2, `Footer does not align with physical page ${number}`);
    }
    const bottom = number <= gaps.length ? gaps[number - 1].getBoundingClientRect().bottom - (metrics.top + 20) * zoom
      : bounds.top + (page.clientTop + page.clientHeight) * zoom;
    const expected = bottom - (metrics.bottom - 4 * 96 / 25.4) * zoom;
    assert(Math.abs(rect.top - expected) < 1.5, `Footer position drift: ${rect.top} vs ${expected}`);
    assert(rect.right <= bounds.right && rect.left >= bounds.left, 'Region exceeded paper width');
    assert(getComputedStyle(footer).color === 'rgb(0, 0, 255)', 'Footer inherited header color');
  }
  for (const header of headers) {
    assert(getComputedStyle(header).color === 'rgb(255, 0, 0)', 'Header color missing');
    assert(getComputedStyle(header).fontSize === '12px', 'Header inherited footer size');
  }
}
(async () => {
  try {
    await settled();
    const imageCanvas = document.createElement('canvas');
    imageCanvas.width = 60; imageCanvas.height = 30;
    const imageContext = imageCanvas.getContext('2d');
    imageContext.fillStyle = '#205d8e'; imageContext.fillRect(0, 0, 60, 30);
    imageContext.fillStyle = '#fff'; imageContext.fillRect(8, 8, 44, 14);
    const imageSource = imageCanvas.toDataURL('image/png');
    const imageField = { kind: 'image', src: imageSource, alt: '标识', width_mm: 6, height_mm: 3 };
    const total = paginationKey.getState(editor.state).positions.length + 1;
    assert(total > 2, 'Expected several pages');
    const originalDoc = editor.state.doc;
    const started = getPaginationMetrics(editor.view).started;
    const settings = defaultPageFurniture();
    settings.header.enabled = true;
    settings.header.left = [{ kind: 'text', value: '独立页眉' }];
    settings.header.style.color = '#ff0000';
    settings.header.style.separator = true;
    Object.assign(settings.header.style, { margin_top_mm: 2, margin_bottom_mm: 4, margin_left_mm: 5, margin_right_mm: 6, column_gap_mm: 3 });
    settings.footer.enabled = true;
    settings.footer.center = [{ kind: 'text', value: '第 ' }, { kind: 'page' }, { kind: 'text', value: ' 页 / 共 ' }, { kind: 'pages' }, { kind: 'text', value: ' 页' }];
    settings.footer.style.color = '#0000ff';
    settings.footer.style.font_size_pt = 10;
    Object.assign(settings.footer.style, { margin_top_mm: 4, margin_bottom_mm: 2, margin_left_mm: 1, margin_right_mm: 2, column_gap_mm: 1 });
    api.setPageFurniture(settings);
    await pause(100);
    verifyRegions(total);
    assert(page.querySelector('[data-page-number="1"].infinite-page-header'), 'First header missing');
    for (const zoom of [0.5, 0.8, 1.5, 2, 1]) {
      root.style.transform = `scale(${zoom})`; root.style.transformOrigin = 'top left';
      window.dispatchEvent(new Event('infinite-editor-zoom')); await pause(100);
      verifyRegions(total, zoom);
    }
    window.scrollTo(0, page.scrollHeight);
    await pause(150);
    assert(page.querySelector(`.infinite-page-footer[data-page-number="${total}"]`), 'Last footer missing');
    settings.header.hide_first_page = true;
    api.setPageFurniture(settings);
    window.scrollTo(0, 0); await pause(100);
    assert(!page.querySelector('.infinite-page-header[data-page-number="1"]'), 'Hidden first header still visible');
    assert(page.querySelector('.infinite-page-footer[data-page-number="1"]'), 'Header hiding leaked to footer');
    session.command('undo'); await pause(100);
    assert(page.querySelector('.infinite-page-header[data-page-number="1"]'), 'Undo did not restore header');
    assert(editor.state.doc === originalDoc, 'Metadata changed body document');
    assert(getPaginationMetrics(editor.view).started === started, 'Metadata/zoom/history repaginated body');
    root.classList.replace('paged', 'seamless'); await settled();
    assert(!page.querySelector('.infinite-page-footer'), 'Seamless mode displays footer');
    root.classList.replace('seamless', 'paged'); await settled();
    assert(page.querySelector('.infinite-page-footer'), 'Paged mode did not restore footer');
    const tooLong = structuredClone(settings);
    tooLong.header.left = [{ kind: 'text', value: '很长'.repeat(100) }];
    assert(validatePageFurniture(tooLong, pageMetrics(page), total), 'Overlong template accepted');
    // The export path uses independent physical page containers and the exact
    // same template renderer. No CSS browser header/footer or body text copies.
    const print = document.createElement('section');
    print.className = 'document-renderer'; print.style.cssText = page.style.cssText;
    const printSettings = structuredClone(settings);
    for (const kind of ['header', 'footer']) {
      Object.assign(printSettings[kind].style, { padding_top_mm: 0.5, padding_bottom_mm: 1, padding_left_mm: 1, padding_right_mm: 2 });
      for (const slot of ['left', 'center', 'right']) printSettings[kind][slot].push(structuredClone(imageField));
    }
    print.dataset.pageFurniture = JSON.stringify(printSettings);
    print.innerHTML = '<div class="document-pagination-source"><p>One</p><div class="infinite-page-break"></div><p>Two</p></div><div data-document-pages></div>';
    document.body.appendChild(print);
    const result = paginate(print, false);
    assert(result.pages === 2, 'Print pages missing');
    assert(print.querySelectorAll('.infinite-page-header').length === 1, 'Print first-page rule differs');
    const printed = [...print.querySelectorAll('.infinite-page-footer')];
    assert(printed[1].textContent === '第 2 页 / 共 2 页', 'Print page fields incorrect');
    assert(getComputedStyle(printed[1]).color === 'rgb(0, 0, 255)', 'Print footer style differs');
    assert(Math.abs(parseFloat(printed[1].style.left) - 23 * 96 / 25.4) < 0.1, 'Print footer indent differs');
    assert(printed[1].style.columnGap === '1mm', 'Print footer column gap differs');
    const printImages = [...print.querySelectorAll('.document-page-furniture img')];
    assert(printImages.length === 9, 'Print did not include all header/footer images');
    await Promise.all(printImages.map(image => image.decode()));
    assert(printImages.every(image => image.naturalWidth === 60), 'Print images did not decode');
    assert(printed[1].style.paddingLeft === '1mm', 'Print inner padding missing');
    window.furniturePrintHtml = print.outerHTML;
    print.remove();
    // Reflow after actual content changes updates totals, including an empty
    // document and table cells that continue across physical pages.
    session.setDocument({ markdown: '', ast: remarkReferenceBackend.parse(''), documentRevision: 2, editRevision: 0 });
    await settled();
    assert(page.querySelector('.infinite-page-footer').textContent === '第 1 页 / 共 1 页', 'Empty document footer missing');
    const table = '| 长单元格 | 同行 |\n| --- | --- |\n| ' + '表格续排 English '.repeat(400) + ' | ' + '右侧内容 '.repeat(200) + ' |';
    session.setDocument({ markdown: table, ast: remarkReferenceBackend.parse(table), documentRevision: 3, editRevision: 0 });
    await settled();
    const tablePages = paginationKey.getState(editor.state).positions.length + 1;
    assert(tablePages > 2, 'Expected table to continue across pages');
    for (const ratio of [0, 0.5, 1, 0]) {
      window.scrollTo(0, page.scrollHeight * ratio); await pause(100);
      verifyRegions(tablePages);
    }
    // Settings cancellation and IME retain the live template and body selection.
    const selection = editor.state.selection;
    api.openPageFurniture();
    const dialog = document.getElementById('page-furniture-dialog');
    assert(dialog?.open, 'Settings dialog did not open');
    assert(dialog.querySelectorAll('[role="tabpanel"]:not([hidden])').length === 1, 'Duplicate settings panels visible');
    const footerTab = dialog.querySelector('#page-footer-tab');
    footerTab.click();
    assert(footerTab.getAttribute('aria-selected') === 'true', 'Footer tab did not activate');
    const spacing = dialog.querySelector('[aria-label="页脚左缩进"]');
    assert(spacing.value === '1', 'Footer inherited header margins');
    spacing.value = '4'; spacing.dispatchEvent(new Event('input', { bubbles: true }));
    await pause(100);
    const actualFooter = page.querySelector('.infinite-page-footer');
    assert(Math.abs(parseFloat(actualFooter.style.left) - 26 * 96 / 25.4) < 0.1, 'Footer indent did not preview');
    dialog.querySelector('#page-header-tab').click();
    assert(dialog.querySelector('[aria-label="页眉左缩进"]').value === '5', 'Tab switch changed header margins');
    const headerGap = dialog.querySelector('[aria-label="页眉栏间距"]');
    assert(headerGap.value === '3', 'Header column gap not restored');
    const input = dialog.querySelector('[aria-label="页眉左侧"]');
    input.value = '输入预览'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await pause(100);
    assert(page.querySelector('.infinite-page-header').textContent.includes('输入预览'), 'Live preview missing');
    dialog.close(); await pause(100);
    assert(editor.state.selection.eq(selection), 'Dialog changed body selection');
    assert(page.querySelector('.infinite-page-header').textContent.includes('独立页眉'), 'Cancel did not restore template');
    api.openPageFurniture();
    const editing = document.getElementById('page-furniture-dialog');
    const field = editing.querySelector('[aria-label="页眉左侧"]');
    const submit = editing.querySelector('[type="submit"]');
    const headerTop = editing.querySelector('[aria-label="页眉上留白"]');
    headerTop.value = '1'; headerTop.dispatchEvent(new Event('input', { bubbles: true }));
    field.value = '超长'.repeat(100); field.dispatchEvent(new Event('input', { bubbles: true }));
    await pause(100);
    assert(submit.disabled, 'Settings allowed an overflowing template');
    editing.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    field.value = '新的页眉'; field.dispatchEvent(new Event('input', { bubbles: true }));
    editing.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    assert(editing.open && api.getPageFurniture().header.left[0].value === '独立页眉', 'IME committed partial input');
    editing.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await pause(100);
    submit.click(); await pause(100);
    assert(!document.getElementById('page-furniture-dialog'), 'Apply did not close settings');
    assert(api.getPageFurniture().header.left[0].value === '新的页眉', 'Apply did not commit settings');
    assert(api.getPageFurniture().header.style.margin_top_mm === 1, 'Spacing was not committed');
    assert(api.getPageFurniture().footer.style.margin_top_mm === 4, 'Header spacing changed footer');
    session.command('undo'); await pause(100);
    assert(api.getPageFurniture().header.left[0].value === '独立页眉', 'Settings application did not form one undo event');
    assert(api.getPageFurniture().header.style.margin_top_mm === 2, 'Spacing was not undone');
    api.openPageFurniture();
    const imageDialog = document.getElementById('page-furniture-dialog');
    const baselineLine = page.querySelector('.infinite-page-header').getBoundingClientRect().bottom;
    imageDialog.querySelector('.page-furniture-padding').open = true;
    const innerBottom = imageDialog.querySelector('[aria-label="页眉下内边距"]');
    innerBottom.value = '1.5'; innerBottom.dispatchEvent(new Event('input', { bubbles: true }));
    const innerLeft = imageDialog.querySelector('[aria-label="页眉左内边距"]');
    innerLeft.value = '2'; innerLeft.dispatchEvent(new Event('input', { bubbles: true }));
    await pause(100);
    const paddedHeader = page.querySelector('.infinite-page-header');
    assert(Math.abs(paddedHeader.getBoundingClientRect().bottom - baselineLine) < 0.1, 'Inner padding moved the divider');
    assert(paddedHeader.style.paddingBottom === '1.5mm', 'Bottom inner padding not applied');
    const contentBottom = paddedHeader.firstElementChild.getBoundingClientRect().bottom;
    const lineInset = parseFloat(getComputedStyle(paddedHeader).borderBottomWidth);
    assert(Math.abs(baselineLine - lineInset - contentBottom - 1.5 * 96 / 25.4) < 1, 'Actual content-to-divider spacing differs');
    for (const [kind, title] of [['header', '页眉'], ['footer', '页脚']]) {
      imageDialog.querySelector(`#page-${kind}-tab`).click();
      for (const slot of ['左侧', '中间', '右侧']) {
        const transfer = new DataTransfer();
        const bytes = Uint8Array.from(atob(imageSource.split(',')[1]), char => char.charCodeAt(0));
        transfer.items.add(new File([bytes], '标识.png', { type: 'image/png' }));
        const picker = imageDialog.querySelector(`[aria-label="${title}${slot}图片文件"]`);
        picker.files = transfer.files;
        picker.dispatchEvent(new Event('change', { bubbles: true }));
        for (let attempt = 0; attempt < 50 && picker.closest('.page-furniture-slot').querySelector('button').disabled; attempt++) await pause(20);
        assert(!picker.closest('.page-furniture-slot').querySelector('img').hidden, 'Image picker did not insert an image');
      }
    }
    imageDialog.querySelector('#page-header-tab').click();
    const imageWidth = imageDialog.querySelector('[aria-label="页眉左侧图片宽 (mm)"]');
    imageWidth.value = '6'; imageWidth.dispatchEvent(new Event('input', { bubbles: true }));
    await pause(100);
    assert(Number(imageDialog.querySelector('[aria-label="页眉左侧图片高 (mm)"]').value) === 3, 'Image resizing lost aspect ratio');
    imageDialog.querySelector('[aria-label="页眉左侧图片放大"]').click();
    assert(Number(imageWidth.value) === 7.5, 'Enlarge button did not resize image');
    imageDialog.querySelector('[aria-label="页眉左侧图片缩小"]').click();
    assert(Number(imageWidth.value) === 6, 'Shrink button did not resize image');
    imageDialog.querySelector('[aria-label="页眉左侧图片适应栏位"]').click();
    assert(Number(imageWidth.value) > 6, 'Fit still uses tiny import size');

    assert(!imageDialog.querySelector('[type="submit"]').disabled, 'Valid mixed content rejected');
    imageDialog.querySelector('[type="submit"]').click(); await pause(100);
    const withImages = api.getPageFurniture();
    assert(withImages.header.left.some(part => part.kind === 'image'), 'Image was not saved');
    assert(withImages.header.left.some(part => part.kind === 'text'), 'Inserting an image removed text');
    assert(withImages.header.style.padding_bottom_mm === 1.5 && withImages.footer.style.padding_bottom_mm === 0, 'Inner padding was not independent');
    session.command('undo'); await pause(100);
    assert(!api.getPageFurniture().header.left.some(part => part.kind === 'image'), 'Image undo failed');
    session.command('redo'); await pause(100);
    assert(api.getPageFurniture().header.left.some(part => part.kind === 'image'), 'Image redo failed');
    api.openPageFurniture();
    const reopened = document.getElementById('page-furniture-dialog');
    assert(reopened.querySelectorAll('.page-furniture-image-thumbnail:not([hidden])').length === 6, 'Reopening lost images');
    reopened.querySelector('[aria-label="页眉左侧移除图片"]').click(); await pause(100);
    assert(!page.querySelector('.infinite-page-header > span:first-child img'), 'Remove image did not preview');
    reopened.close(); await pause(100);
    assert(page.querySelector('.infinite-page-header > span:first-child img'), 'Cancel did not restore image');
    api.openPageFurniture();
    document.getElementById('page-furniture-dialog').querySelector('.page-furniture-padding').open = true;
    document.getElementById('result').textContent = JSON.stringify({ ok: true, pages: total, styles: 'independent', history: 'shared', printPages: 2 });
  } catch (error) {
    document.getElementById('result').textContent = JSON.stringify({ ok: false, error: error.stack });
  }
})();
