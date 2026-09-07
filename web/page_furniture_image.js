import { regionSpacing, regionPadding, resolvePageFields, MM } from './page_furniture.js';
// Embedded template images travel with the layout and its undo snapshots.
export async function importPageImage(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片');
  }
  if (file.size > 8 * 1024 * 1024) throw new Error('图片不能超过 8 MiB');
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = src;
  try { await image.decode(); } catch { throw new Error('图片无法解码，请选择有效的图片'); }
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效');
  const scale = Math.min(1 / MM, 100 / image.naturalWidth, 100 / image.naturalHeight);
  return { kind: 'image', src, alt: file.name, width_mm: Math.max(0.1, image.naturalWidth * scale),
    height_mm: Math.max(0.1, image.naturalHeight * scale) };
}

// Fit the full available slot, including text and inner padding, not a tiny
// hard-coded thumbnail size. Used on import and by the explicit fit button.
export function fitPageImage(image, region, slot, metrics, total, kind) {
  const margin = regionSpacing(region.style);
  const padding = regionPadding(region.style);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = `${region.style.font_size_pt * 96 / 72}px ${region.style.font_family}`;
  const text = resolvePageFields(region[slot].filter(part => part.kind !== 'image'), total, total);
  const width = (metrics.width - metrics.left - metrics.right
    - (margin.left + margin.right + padding.left + padding.right + 2 * margin.gap) * MM) / 3
    - context.measureText(text).width;
  const height = (kind === 'header' ? metrics.top : metrics.bottom)
    - (margin.top + margin.bottom + padding.top + padding.bottom) * MM
    - (region.style.separator ? 96 / 144 : 0);
  const factor = Math.min((width / MM - 0.1) / image.width_mm,
    (height / MM - 0.1) / image.height_mm, 100 / image.width_mm, 100 / image.height_mm);
  if (!Number.isFinite(factor) || factor <= 0) return image;
  return { ...image, width_mm: Math.max(0.1, image.width_mm * factor), height_mm: Math.max(0.1, image.height_mm * factor) };
}
