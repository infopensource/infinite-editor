import { importPageImage, fitPageImage } from './page_furniture_image.js';
import { defaultPageFurniture, furnitureRoot, readPageFurniture, publishPageFurniture,
  parsePageFields, formatPageFields, renderPageFurniture, validatePageFurniture, pageGeometry, MM } from './page_furniture.js';

export function openPageFurnitureDialog(api) {
  const existing = document.getElementById('page-furniture-dialog');
  if (existing) { existing.focus(); return; }
  const root = furnitureRoot();
  const revision = api.getSnapshot()?.documentRevision;
  if (!root || revision == null) return;
  const saved = structuredClone(api.getPageFurniture() || readPageFurniture());
  const draft = structuredClone(saved);
  for (const kind of ['header', 'footer']) {
    draft[kind].style = { ...defaultPageFurniture()[kind].style, ...draft[kind].style };
  }
  const layout = JSON.parse(root.dataset.pageLayout);
  let [width, height] = layout.paper.mode === 'a5' ? [148, 210]
    : layout.paper.mode === 'custom' ? [layout.paper.width_mm, layout.paper.height_mm] : [210, 297];
  if (layout.paper.orientation === 'landscape') [width, height] = [height, width];
  const metrics = { width: width * MM, height: height * MM, top: layout.margins.top_mm * MM,
    bottom: layout.margins.bottom_mm * MM, left: layout.margins.left_mm * MM, right: layout.margins.right_mm * MM };
  const total = Math.max(1, Number(document.querySelector('.infinite-pm-page')?.dataset.pageCount) || 1);
  const template = document.querySelector('#page-furniture-dialog-template > dialog');
  if (!template) return;
  const previousFocus = document.activeElement;
  const dialog = template.cloneNode(true);
  dialog.id = 'page-furniture-dialog';
  dialog.setAttribute('aria-labelledby', 'page-furniture-title');
  dialog.querySelector('h2').id = 'page-furniture-title';
  const find = name => dialog.querySelector(`.page-furniture-${name}`);
  find('close').addEventListener('click', () => dialog.close());
  find('cancel').addEventListener('click', () => dialog.close());
  const form = find('form');
  const previewLabel = find('preview-label');
  const previewFrame = find('preview-frame');
  const preview = find('preview');
  const placeholder = find('placeholder');
  const error = find('error');
  const apply = find('apply');
  let active = 'header';
  let committed = false;
  let composing = false;
  let pendingPreview = 0;
  let pendingImages = 0;
  let imageError = null;
  const refresh = () => {
    const issue = imageError || validatePageFurniture(draft, metrics, total);
    error.textContent = issue || (pendingImages ? '正在读取图片…' : null) || (layout.paper.mode === 'seamless' ? '无缝模式保留设置，固定纸张下显示。' : '仅应用后保存，取消可恢复原设置。');
    error.classList.toggle('has-error', Boolean(issue));
    apply.disabled = Boolean(issue) || pendingImages > 0;
    const title = active === 'header' ? '页眉' : '页脚';
    previewLabel.textContent = `${title}预览 · 留白和栏间距按实际比例显示`;
    const sample = { ...metrics, height: active === 'header' ? metrics.top : metrics.bottom };
    const shown = structuredClone(draft);
    shown[active === 'header' ? 'footer' : 'header'].enabled = false;
    shown[active].hide_first_page = false;
    const previewIssue = renderPageFurniture(preview, shown, [pageGeometry(sample, 0, 0)], sample, total);
    const scale = Math.min(1, Math.max(1, previewFrame.clientWidth - 24) / sample.width,
      Math.max(1, previewFrame.clientHeight - 16) / Math.max(1, sample.height));
    Object.assign(preview.style, { width: `${sample.width}px`, height: `${sample.height}px`,
      transform: `scale(${scale})`, left: `${(previewFrame.clientWidth - sample.width * scale) / 2}px`,
      top: `${(previewFrame.clientHeight - sample.height * scale) / 2}px` });
    placeholder.hidden = draft[active].enabled && !previewIssue;
    placeholder.textContent = previewIssue ? '调整留白或文字后预览' : `启用${title}后显示预览`;
    if (!issue) publishPageFurniture(draft, true);
  };
  const scheduleRefresh = () => {
    if (!pendingPreview) pendingPreview = requestAnimationFrame(() => { pendingPreview = 0; refresh(); });
  };
  const tabNodes = new Map();
  const panelNodes = new Map();
  const select = kind => {
    active = kind;
    for (const [key, tab] of tabNodes) {
      tab.setAttribute('aria-selected', String(key === kind));
      tab.tabIndex = key === kind ? 0 : -1;
      panelNodes.get(key).hidden = key !== kind;
    }
    refresh();
  };
  for (const kind of ['header', 'footer']) {
    const region = draft[kind];
    const tab = dialog.querySelector(`.page-furniture-tab[data-region="${kind}"]`);
    const panel = dialog.querySelector(`.page-furniture-panel[data-region="${kind}"]`);
    tab.id = `page-${kind}-tab`;
    tab.setAttribute('aria-controls', `page-${kind}-panel`);
    tab.addEventListener('click', () => select(kind));
    tab.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 'header' : event.key === 'End' ? 'footer' : kind === 'header' ? 'footer' : 'header';
        select(next); tabNodes.get(next).focus();
      }
    });
    tabNodes.set(kind, tab);
    panel.id = `page-${kind}-panel`;
    panel.setAttribute('aria-labelledby', tab.id);
    panelNodes.set(kind, panel);
    const bindInput = (parent, field, value, change) => {
      const control = parent.querySelector(`[data-field="${field}"]`);
      if (control.type === 'checkbox') control.checked = value;
      else control.value = value;
      control.addEventListener('input', () => {
        change(control.type === 'checkbox' ? control.checked : control.value);
        if (!composing) scheduleRefresh();
      });
      return control;
    };
    for (const key of ['enabled', 'hide_first_page']) {
      bindInput(panel, key, region[key], value => { region[key] = value; });
    }
    bindInput(panel, 'font_family', region.style.font_family, value => { region.style.font_family = value || 'system-ui'; });
    for (const key of ['color', 'separator']) {
      bindInput(panel, key, region.style[key], value => { region.style[key] = value; });
    }
    for (const key of ['font_size_pt', 'margin_top_mm', 'margin_bottom_mm',
      'margin_left_mm', 'margin_right_mm', 'column_gap_mm', 'padding_top_mm',
      'padding_bottom_mm', 'padding_left_mm', 'padding_right_mm']) {
      bindInput(panel, key, region.style[key], value => { region.style[key] = value === '' ? NaN : Number(value); });
    }
    for (const slot of ['left', 'center', 'right']) {
      const slotEditor = panel.querySelector(`[data-slot="${slot}"]`);
      bindInput(slotEditor, 'text', formatPageFields(region[slot]), value => {
        region[slot] = [...parsePageFields(value), ...region[slot].filter(part => part.kind === 'image')];
      });
      const picker = slotEditor.querySelector('[type="file"]');
      const choose = slotEditor.querySelector('.page-furniture-image-button');
      choose.addEventListener('click', () => picker.click());
      const thumbnail = slotEditor.querySelector('.page-furniture-image-thumbnail');
      const dimensions = slotEditor.querySelector('.page-furniture-image-dimensions');
      const widthInput = bindInput(dimensions, 'width_mm', '', value => resizeImage('width_mm', value));
      const heightInput = bindInput(dimensions, 'height_mm', '', value => resizeImage('height_mm', value));
      const sizing = slotEditor.querySelector('.page-furniture-image-sizing');
      for (const button of sizing.querySelectorAll('button')) {
        const action = button.dataset.action;
        button.addEventListener('click', () => {
          const image = region[slot].find(part => part.kind === 'image');
          if (!image) return;
          if (action === '适应栏位') Object.assign(image, fitPageImage(image, region, slot, metrics, total, kind));
          else {
            const factor = action === '放大' ? 1.25 : 0.8;
            if ([image.width_mm * factor, image.height_mm * factor].every(value => value >= 0.1 && value <= 100)) {
              image.width_mm *= factor; image.height_mm *= factor;
            }
          }
          updateImageControls(); refresh();
        });
      }
      const remove = slotEditor.querySelector('.page-furniture-image-remove');
      let aspect = 1;
      const updateImageControls = () => {
        const image = region[slot].find(part => part.kind === 'image');
        thumbnail.hidden = dimensions.hidden = remove.hidden = sizing.hidden = !image;
        choose.textContent = image ? '替换图片' : '插入图片';
        if (image) {
          thumbnail.src = image.src; thumbnail.alt = image.alt;
          widthInput.value = Number(image.width_mm.toFixed(2)); heightInput.value = Number(image.height_mm.toFixed(2));
          aspect = image.width_mm / image.height_mm;
        }
      };
      const resizeImage = (dimension, value) => {
        const image = region[slot].find(part => part.kind === 'image');
        if (!image) return;
        image[dimension] = value === '' ? NaN : Number(value);
        if (dimension === 'width_mm') {
          image.height_mm = image.width_mm / aspect;
          heightInput.value = Number(image.height_mm.toFixed(2));
        } else {
          image.width_mm = image.height_mm * aspect;
          widthInput.value = Number(image.width_mm.toFixed(2));
        }
      };
      picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        if (!file) return;
        pendingImages++; imageError = null; refresh();
        choose.disabled = true;
        try {
          const imported = await importPageImage(file);
          const image = fitPageImage(imported, region, slot, metrics, total, kind);
          if (!dialog.isConnected || api.getSnapshot()?.documentRevision !== revision) return;
          region[slot] = [...region[slot].filter(part => part.kind !== 'image'), image];
          updateImageControls();
        } catch (failure) { imageError = failure.message; }
        finally {
          pendingImages--; picker.value = ''; choose.disabled = false;
          if (dialog.isConnected) refresh();
        }
      });
      remove.addEventListener('click', () => {
        region[slot] = region[slot].filter(part => part.kind !== 'image');
        imageError = null; updateImageControls(); refresh();
      });
      updateImageControls();
    }
  }
  dialog.addEventListener('compositionstart', () => { composing = true; });
  dialog.addEventListener('compositionend', () => { composing = false; scheduleRefresh(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || composing)) event.preventDefault();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (composing) return;
    refresh();
    if (apply.disabled || api.getSnapshot()?.documentRevision !== revision) return;
    const result = api.setPageFurniture(draft);
    if (!result.ok) { error.textContent = result.error; return; }
    committed = true;
    dialog.close();
  });
  const observer = new MutationObserver(() => {
    if (api.getSnapshot()?.documentRevision !== revision) dialog.close();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-page-layout'] });
  const resize = new ResizeObserver(scheduleRefresh);
  resize.observe(previewFrame);
  dialog.addEventListener('close', () => {
    cancelAnimationFrame(pendingPreview);
    observer.disconnect(); resize.disconnect();
    if (!committed) publishPageFurniture(api.getPageFurniture() || saved);
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }, { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
  select('header');
  tabNodes.get('header').focus();
  document.fonts?.ready.then(() => { if (dialog.isConnected) refresh(); });
}
