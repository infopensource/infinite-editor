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
  const previousFocus = document.activeElement;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const dialog = element('dialog', 'page-furniture-dialog');
  dialog.id = 'page-furniture-dialog';
  dialog.setAttribute('aria-labelledby', 'page-furniture-title');
  const heading = element('h2', '', '页眉页脚');
  heading.id = 'page-furniture-title';
  const close = element('button', 'page-furniture-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭页眉页脚设置');
  close.addEventListener('click', () => dialog.close());
  const header = element('header', 'page-furniture-heading');
  header.append(heading, close);
  const form = element('form', 'page-furniture-form');
  form.noValidate = true;
  const scroll = element('div', 'page-furniture-scroll');
  const tabs = element('div', 'page-furniture-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '编辑区域');
  const panels = element('div', 'page-furniture-panels');
  const previewSection = element('section', 'page-furniture-preview-section');
  const previewLabel = element('div', 'page-furniture-preview-label');
  const previewFrame = element('div', 'page-furniture-preview-frame');
  const preview = element('div', 'page-furniture-preview');
  const placeholder = element('span', 'page-furniture-placeholder');
  previewFrame.append(preview, placeholder);
  previewSection.append(previewLabel, previewFrame);
  const error = element('p', 'page-furniture-error');
  error.setAttribute('role', 'status');
  const apply = element('button', 'page-furniture-apply', '应用');
  apply.type = 'submit';
  const cancel = element('button', '', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const actions = element('footer', 'page-furniture-actions');
  const buttons = element('div', 'page-furniture-buttons');
  buttons.append(cancel, apply);
  actions.append(error, buttons);
  scroll.append(panels, previewSection);
  form.append(tabs, scroll, actions);
  dialog.append(header, form);
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
  for (const [kind, title] of [['header', '页眉'], ['footer', '页脚']]) {
    const region = draft[kind];
    const tab = element('button', 'page-furniture-tab', title);
    tab.type = 'button';
    tab.id = `page-${kind}-tab`;
    tab.setAttribute('role', 'tab');
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
    tabs.appendChild(tab);
    const panel = element('section', 'page-furniture-panel');
    panel.id = `page-${kind}-panel`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panelNodes.set(kind, panel);
    panels.appendChild(panel);
    const ribbon = element('div', 'page-furniture-ribbon');
    const group = (title, className = '') => {
      const section = element('section', `page-furniture-group ${className}`);
      section.appendChild(element('h3', '', title));
      ribbon.appendChild(section);
      return section;
    };
    const input = (parent, name, type, value, change, options = {}) => {
      const label = element('label', type === 'checkbox' ? 'page-furniture-check' : 'page-furniture-control');
      const control = element('input');
      control.type = type;
      control.setAttribute('aria-label', title + name);
      if (type === 'checkbox') control.checked = value;
      else control.value = value;
      if (type === 'number') {
        control.min = options.min ?? '6'; control.max = options.max ?? '36'; control.step = '0.5';
        control.required = true;
      }
      control.addEventListener('input', () => {
        change(type === 'checkbox' ? control.checked : control.value);
        if (!composing) scheduleRefresh();
      });
      if (type === 'checkbox') label.append(control, element('span', '', name));
      else label.append(element('span', '', name), control);
      parent.appendChild(label);
      return control;
    };
    const visibility = group('显示', 'page-furniture-visibility');
    input(visibility, '启用', 'checkbox', region.enabled, value => { region.enabled = value; });
    input(visibility, '首页隐藏', 'checkbox', region.hide_first_page, value => { region.hide_first_page = value; });
    const typography = group('字体与线条', 'page-furniture-typography');
    input(typography, '字体', 'text', region.style.font_family, value => { region.style.font_family = value || 'system-ui'; });
    input(typography, '字号 (pt)', 'number', region.style.font_size_pt, value => { region.style.font_size_pt = value === '' ? NaN : Number(value); });
    input(typography, '颜色', 'color', region.style.color, value => { region.style.color = value; });
    input(typography, '分隔线', 'checkbox', region.style.separator, value => { region.style.separator = value; });
    const spacing = group('留白与间距 · mm', 'page-furniture-spacing');
    for (const [key, label] of [['margin_top_mm', '上留白'], ['margin_bottom_mm', '下留白'],
      ['margin_left_mm', '左缩进'], ['margin_right_mm', '右缩进'], ['column_gap_mm', '栏间距']]) {
      input(spacing, label, 'number', region.style[key], value => { region.style[key] = value === '' ? NaN : Number(value); }, { min: '0', max: '100' });
    }
    const padding = element('details', 'page-furniture-padding');
    padding.appendChild(element('summary', '', '内容与分隔线的内边距 · mm'));
    const paddingControls = element('div', 'page-furniture-padding-controls');
    for (const [key, label] of [['padding_top_mm', '上内边距'], ['padding_bottom_mm', '下内边距'],
      ['padding_left_mm', '左内边距'], ['padding_right_mm', '右内边距']]) {
      input(paddingControls, label, 'number', region.style[key], value => { region.style[key] = value === '' ? NaN : Number(value); }, { min: '0', max: '100' });
    }
    padding.append(paddingControls, element('p', '', '页眉内容靠下方分隔线，页脚内容靠上方分隔线；内边距不会改变线的位置。'));
    const content = element('section', 'page-furniture-content');
    const contentHeading = element('div', 'page-furniture-content-heading');
    contentHeading.append(element('h3', '', '内容'), element('span', '', '{page} 页码 · {pages} 总页数'));
    content.appendChild(contentHeading);
    const slots = element('div', 'page-furniture-slots');
    for (const [slot, label] of [['left', '左侧'], ['center', '中间'], ['right', '右侧']]) {
      const slotEditor = element('div', 'page-furniture-slot');
      input(slotEditor, label, 'text', formatPageFields(region[slot]), value => {
        region[slot] = [...parsePageFields(value), ...region[slot].filter(part => part.kind === 'image')];
      });
      const imageControls = element('div', 'page-furniture-image-controls');
      const picker = element('input');
      picker.type = 'file'; picker.accept = 'image/png,image/jpeg,image/webp,image/gif'; picker.hidden = true;
      picker.setAttribute('aria-label', `${title}${label}图片文件`);
      const choose = element('button', 'page-furniture-image-button', '插入图片');
      choose.type = 'button'; choose.setAttribute('aria-label', `${title}${label}插入图片`);
      choose.addEventListener('click', () => picker.click());
      const thumbnail = element('img', 'page-furniture-image-thumbnail');
      const dimensions = element('div', 'page-furniture-image-dimensions');
      const widthInput = input(dimensions, `${label}图片宽 (mm)`, 'number', '', value => resizeImage('width_mm', value), { min: '0.1', max: '100' });
      const heightInput = input(dimensions, `${label}图片高 (mm)`, 'number', '', value => resizeImage('height_mm', value), { min: '0.1', max: '100' });
      widthInput.step = heightInput.step = '0.1';
      const sizing = element('div', 'page-furniture-image-sizing');
      for (const [caption, action] of [['−', '缩小'], ['+', '放大'], ['适应栏位', '适应栏位']]) {
        const button = element('button', '', caption);
        button.type = 'button'; button.setAttribute('aria-label', `${title}${label}图片${action}`);
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
        sizing.appendChild(button);
      }
      const remove = element('button', 'page-furniture-image-remove', '移除');
      remove.type = 'button'; remove.setAttribute('aria-label', `${title}${label}移除图片`);
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
      imageControls.append(thumbnail, choose, remove, picker);
      slotEditor.append(imageControls, sizing, dimensions);
      slots.appendChild(slotEditor);
      updateImageControls();
    }
    content.appendChild(slots);
    const hint = element('p', 'page-furniture-spacing-hint', '上下留白位于对应页边距内；左右缩进以正文边缘为基准。');
    panel.append(ribbon, hint, padding, content);
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
