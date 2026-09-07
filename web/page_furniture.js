// Shared by the live editor, settings preview and physical PDF pages.
// Templates contain fields, never HTML; header and footer own separate styles.
export const MM = 96 / 25.4;
export const PAGE_GAP = 20;
export function defaultPageFurniture() {
  const region = () => ({ enabled: false, hide_first_page: false, left: [], center: [], right: [],
    style: { font_family: 'system-ui', font_size_pt: 9, color: '#64748b', separator: false, margin_top_mm: 3, margin_bottom_mm: 3, margin_left_mm: 0, margin_right_mm: 0, column_gap_mm: 2, padding_top_mm: 0, padding_bottom_mm: 0, padding_left_mm: 0, padding_right_mm: 0 } });
  return { header: region(), footer: region() };
}
export function regionSpacing(style) {
  return { top: style.margin_top_mm ?? 3, bottom: style.margin_bottom_mm ?? 3,
    left: style.margin_left_mm ?? 0, right: style.margin_right_mm ?? 0, gap: style.column_gap_mm ?? 2 };
}
export function regionPadding(style) {
  return { top: style.padding_top_mm ?? 0, bottom: style.padding_bottom_mm ?? 0,
    left: style.padding_left_mm ?? 0, right: style.padding_right_mm ?? 0 };
}
export function furnitureRoot() {
  return document.querySelector('[data-page-furniture]');
}
export function readPageFurniture(root = furnitureRoot()) {
  try { return JSON.parse(root?.dataset.pageFurniturePreview || root?.dataset.pageFurniture || 'null') || defaultPageFurniture(); }
  catch { return defaultPageFurniture(); }
}
export function publishPageFurniture(value, preview = false) {
  const root = furnitureRoot();
  if (root) {
    if (preview) root.dataset.pageFurniturePreview = JSON.stringify(value);
    else {
      delete root.dataset.pageFurniturePreview;
      root.dataset.pageFurniture = JSON.stringify(value);
    }
  }
  window.dispatchEvent(new CustomEvent('infinite-page-furniture-change'));
}
export function parsePageFields(text) {
  return text.split(/(\{pages?\})/g).filter(Boolean).map(value => value === '{page}'
    ? { kind: 'page' } : value === '{pages}' ? { kind: 'pages' } : { kind: 'text', value });
}
export function formatPageFields(parts = []) {
  return parts.filter(part => part.kind !== 'image').map(part => part.kind === 'text' ? part.value : `{${part.kind}}`).join('');
}
export function resolvePageFields(parts = [], page, pages) {
  return parts.map(part => part.kind === 'page' ? page : part.kind === 'pages' ? pages : part.value ?? '').join('');
}
export function pageMetrics(element) {
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  const mm = name => parseFloat(style.getPropertyValue(name)) * MM;
  return { width: mm('--page-width'), height: mm('--page-height'),
    top: mm('--page-padding-top'), bottom: mm('--page-padding-bottom'),
    left: mm('--page-padding-left'), right: mm('--page-padding-right') };
}
export function pageGeometry(metrics, index, top = index * (metrics.height + PAGE_GAP), height = metrics.height) {
  return { index, top, height, bodyTop: top + metrics.top,
    bodyBottom: top + height - metrics.bottom };
}
export function createPageRegion(kind, region, geometry, metrics, total) {
  if (!region?.enabled || (geometry.index === 0 && region.hide_first_page)) return null;
  const element = document.createElement('div');
  element.className = `infinite-page-${kind}`;
  element.dataset.pageNumber = String(geometry.index + 1);
  element.setAttribute('aria-label', kind === 'header' ? '页眉' : '页脚');
  const margin = kind === 'header' ? metrics.top : metrics.bottom;
  const top = kind === 'header' ? geometry.top : geometry.bodyBottom;
  const style = region.style;
  const spacing = regionSpacing(style);
  const padding = regionPadding(style);
  Object.assign(element.style, {
    position: 'absolute', boxSizing: 'border-box', display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', columnGap: `${spacing.gap}mm`,
    alignItems: kind === 'header' ? 'end' : 'start',
    padding: `${padding.top}mm ${padding.right}mm ${padding.bottom}mm ${padding.left}mm`, left: `${metrics.left + spacing.left * MM}px`, right: `${metrics.right + spacing.right * MM}px`,
    top: `${top + spacing.top * MM}px`, height: `${margin - (spacing.top + spacing.bottom) * MM}px`,
    fontFamily: style.font_family, fontSize: `${style.font_size_pt}pt`,
    lineHeight: '1.3', fontWeight: 'normal', fontStyle: 'normal', color: style.color,
    whiteSpace: 'pre', textWrap: 'nowrap', pointerEvents: 'none', userSelect: 'none',
    borderBottom: kind === 'header' && style.separator ? '0.5pt solid currentColor' : 'none',
    borderTop: kind === 'footer' && style.separator ? '0.5pt solid currentColor' : 'none',
  });
  for (const slot of ['left', 'center', 'right']) {
    const cell = document.createElement('span');
    cell.style.textAlign = slot;
    cell.style.minWidth = '0';
    cell.style.userSelect = 'none';
    Object.assign(cell.style, { display: 'flex', alignItems: 'center',
      justifyContent: { left: 'flex-start', center: 'center', right: 'flex-end' }[slot],
      height: 'max-content', whiteSpace: 'pre' });
    // Keep adjacent text fields in one span so font shaping matches measurement.
    let text = '';
    const flush = () => {
      if (text) {
        const span = document.createElement('span'); span.textContent = text;
        span.style.flexShrink = '0'; span.style.userSelect = 'none';
        cell.appendChild(span); text = '';
      }
    };
    for (const part of region[slot]) {
      if (part.kind !== 'image') { text += resolvePageFields([part], geometry.index + 1, total); continue; }
      flush();
      const image = document.createElement('img');
      image.src = part.src; image.alt = part.alt || '';
      Object.assign(image.style, { width: `${part.width_mm}mm`, height: `${part.height_mm}mm`,
        maxWidth: 'none', maxHeight: 'none', objectFit: 'contain', display: 'block',
        flex: '0 0 auto', margin: '0', padding: '0', border: '0' });
      cell.appendChild(image);
    }
    flush();
    element.appendChild(cell);
  }
  return element;
}
// Reject overflow instead of covering body text or silently truncating templates.
// Measure against the largest current page number so total-page fields cannot
// change the fixed region height or cause a pagination feedback loop.
export function validatePageFurniture(value, metrics, total = 1) {
  let context;

  for (const [kind, label, margin] of [['header', '页眉', metrics.top], ['footer', '页脚', metrics.bottom]]) {
    const region = value[kind];
    const style = region.style;
    const spacing = regionSpacing(style);
    const padding = regionPadding(style);
    if (Object.values({ ...spacing, pt: padding.top, pb: padding.bottom, pl: padding.left, pr: padding.right }).some(value => !Number.isFinite(value) || value < 0 || value > 100)) return `${label}留白和栏间距必须在 0–100 mm 之间`;
    const width = (metrics.width - metrics.left - metrics.right - (spacing.left + spacing.right + padding.left + padding.right + 2 * spacing.gap) * MM) / 3;
    if (!Number.isFinite(style.font_size_pt) || style.font_size_pt < 6 || style.font_size_pt > 36) return `${label}字号必须在 6–36 pt 之间`;
    if (!/^#[0-9a-f]{6}$/i.test(style.color)) return `${label}颜色必须为 #RRGGBB`;
    if (globalThis.CSS?.supports && !CSS.supports('font-family', style.font_family)) return `${label}字体名称无效`;
    if (!region.enabled) continue;
    if (!Number.isFinite(width) || width <= 0 || style.font_size_pt * 96 / 72 * 1.3 + (style.separator ? 96 / 144 : 0) + (spacing.top + spacing.bottom + padding.top + padding.bottom) * MM > margin) return `${label}放不下，请增大对应页边距或减小字号`;
    context ??= document.createElement('canvas').getContext('2d');
    context.font = `${style.font_size_pt * 96 / 72}px ${style.font_family}`;
    // A proportional font's widest digit is not necessarily 9.
    let digit = '0';
    for (const candidate of '123456789') if (context.measureText(candidate).width > context.measureText(digit).width) digit = candidate;
    const maximumPage = digit.repeat(String(total).length);
    for (const slot of ['left', 'center', 'right']) {
      let measuredWidth = 0;
      let measuredHeight = 0;
      let text = '';
      let invalidText = false;
      const flush = () => { invalidText ||= /[\r\n\t]/.test(text); measuredWidth += context.measureText(text).width; text = ''; };
      for (const part of region[slot]) {
        if (part.kind !== 'image') {
          text += resolvePageFields([part], maximumPage, total);
          measuredHeight = Math.max(measuredHeight, style.font_size_pt * 96 / 72 * 1.3);
          continue;
        }
        flush();
        if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(part.src) || part.src.length > 12 * 1024 * 1024) return `${label}图片数据无效`;
        if (![part.width_mm, part.height_mm].every(v => Number.isFinite(v) && v >= 0.1 && v <= 100)) return `${label}图片尺寸必须在 0.1–100 mm 之间`;
        measuredWidth += part.width_mm * MM;
        measuredHeight = Math.max(measuredHeight, part.height_mm * MM);
      }
      flush();
      if (invalidText) return `${label}仅支持单行内容`;
      const availableHeight = margin - (spacing.top + spacing.bottom + padding.top + padding.bottom) * MM - (style.separator ? 96 / 144 : 0);
      if (measuredWidth > width || measuredHeight > availableHeight) return `${label}${{ left: '左侧', center: '中间', right: '右侧' }[slot]}放不下，请缩短文字、缩小图片或减少内边距`;
    }
  }
  return null;
}
export function renderPageFurniture(layer, settings, geometries, metrics, total) {
  const error = validatePageFurniture(settings, metrics, total);
  layer.dataset.furnitureError = error || '';
  // The settings panel prevents invalid commits. A later paper/font change can
  // make an existing template invalid; expose that explicitly to the caller.
  const nodes = [];
  if (!error) for (const geometry of geometries) for (const kind of ['header', 'footer']) {
    const element = createPageRegion(kind, settings[kind], geometry, metrics, total);
    if (element) nodes.push(element);
  }
  layer.replaceChildren(...nodes);
  return error;
}
