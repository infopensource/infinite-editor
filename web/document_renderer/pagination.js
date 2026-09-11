import { normalizeBlockWhitespace } from "./whitespace.js";
import { pageMetrics, pageGeometry, readPageFurniture, renderPageFurniture } from "../page_furniture.js";
function createPage(pages, seamless) {
  const page = document.createElement("article");
  page.className = seamless ? "document-page seamless-page" : "document-page paged-page";
  const content = document.createElement("div");
  content.className = "document-page-content markdown-rendered-html";
  page.appendChild(content);
  pages.appendChild(page);
  return { page, content };
}

function isOverflowing(content) {
  return content.clientHeight > 0 && content.scrollHeight > content.clientHeight + 1;
}

function textPosition(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  while (node) {
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
    node = walker.nextNode();
  }
  return null;
}

function cloneTextRange(element, start, end) {
  const clone = element.cloneNode(true);
  const startPosition = textPosition(clone, start);
  const endPosition = textPosition(clone, end);
  if (!startPosition || !endPosition) return null;
  // Trim a deep clone so formatting ancestors survive even when both
  // endpoints belong to the same text node (Range.cloneContents drops them).
  const range = document.createRange();
  range.setStart(endPosition.node, endPosition.offset);
  range.setEnd(clone, clone.childNodes.length);
  range.deleteContents();
  range.setStart(clone, 0);
  range.setEnd(startPosition.node, startPosition.offset);
  range.deleteContents();
  return clone;
}

function splitTableToFit(table, content) {
  const rows = [...table.rows].filter((row) => row.parentElement.tagName !== "THEAD");
  if (rows.length < 2) return null;
  const fragment = (start, end) => {
    const clone = table.cloneNode(true);
    const clonedRows = [...clone.rows].filter((row) => row.parentElement.tagName !== "THEAD");
    clonedRows.forEach((row, index) => {
      if (index < start || index >= end) row.remove();
    });
    if (end < rows.length) clone.querySelectorAll("tfoot").forEach((foot) => foot.remove());
    if (start > 0) clone.querySelectorAll("caption").forEach((caption) => caption.remove());
    return clone;
  };
  let low = 1;
  let high = rows.length - 1;
  let best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = fragment(0, middle);
    content.appendChild(candidate);
    if (isOverflowing(content)) high = middle - 1;
    else { best = middle; low = middle + 1; }
    candidate.remove();
  }
  return best ? { head: fragment(0, best), tail: fragment(best, rows.length) } : null;
}

function splitToFit(node, content) {
  if (node.matches("table")) return splitTableToFit(node, content);
  const length = node.textContent?.length ?? 0;
  if (
    length < 2
    || !node.matches("p, pre, blockquote, ul, ol")
    || node.querySelector("img, video, iframe, svg, table, .infinite-math")
  ) return null;

  // Split only at grapheme boundaries, including emoji and combining marks.
  const offsets = [...new Intl.Segmenter(undefined, { granularity: "grapheme" })
    .segment(node.textContent)].map((segment) => segment.index).filter((offset) => offset > 0);
  let low = 0;
  let high = offsets.length - 1;
  let best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = cloneTextRange(node, 0, offsets[middle]);
    if (!candidate) return null;
    content.appendChild(candidate);
    if (isOverflowing(content)) high = middle - 1;
    else {
      best = offsets[middle];
      low = middle + 1;
    }
    candidate.remove();
  }
  if (best === 0 || best >= length) return null;
  return {
    head: cloneTextRange(node, 0, best),
    tail: cloneTextRange(node, best, length),
  };
}

function sourceNodes(source) {
  const nodes = [];
  let explicitPageBreak = false;
  for (const sourceNode of source.children) {
    if (sourceNode.classList.contains("infinite-page-break")) {
      explicitPageBreak = true;
      continue;
    }
    const node = sourceNode.cloneNode(true);
    normalizeBlockWhitespace(node);
    if (explicitPageBreak) {
      node.dataset.explicitPageBreak = "true";
      explicitPageBreak = false;
    }
    nodes.push(node);
  }
  return nodes;
}

export function paginate(root, seamless) {
  const source = root?.querySelector(".document-pagination-source");
  const pages = root?.querySelector("[data-document-pages]");
  if (!source || !pages) return { ok: false, error: "缺少分页源节点或页面容器" };

  window.InfiniteMathRenderer?.render(source);
  const nodes = sourceNodes(source);
  pages.replaceChildren();
  pages.className = seamless ? "document-flow seamless" : "document-flow paged";

  if (seamless) {
    const current = createPage(pages, true);
    for (const node of nodes) current.content.appendChild(node);
    root.dataset.pageCount = "1";
    root.dataset.oversizedBlocks = "0";
    return { ok: true, pages: 1, oversized: 0 };
  }

  let current = createPage(pages, false);
  let oversized = 0;
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node.dataset.explicitPageBreak === "true") {
      if (current.content.childElementCount) current = createPage(pages, false);
      delete node.dataset.explicitPageBreak;
    }
    current.content.appendChild(node);
    if (!isOverflowing(current.content)) continue;

    node.remove();
    if (current.content.childElementCount > 0) {
      const previous = current.content.lastElementChild;
      if (previous?.matches("h1, h2, h3, h4, h5, h6") && previous.previousElementSibling) {
        previous.remove();
        current = createPage(pages, false);
        queue.unshift(node);
        queue.unshift(previous);
        continue;
      }
      const split = splitToFit(node, current.content);
      if (split?.head && split?.tail) {
        current.content.appendChild(split.head);
        current = createPage(pages, false);
        queue.unshift(split.tail);
        continue;
      }
      current = createPage(pages, false);
      queue.unshift(node);
      continue;
    }

    const split = splitToFit(node, current.content);
    if (split?.head && split?.tail) {
      current.content.appendChild(split.head);
      current = createPage(pages, false);
      queue.unshift(split.tail);
      continue;
    }
    current.content.appendChild(node);
    current.page.classList.add("contains-oversized-block");
    oversized += 1;
  }

  [...pages.children].forEach((page, index) => {
    page.dataset.pageNumber = String(index + 1);
    page.style.position = "relative";
    const layer = document.createElement("div");
    layer.className = "document-page-furniture";
    Object.assign(layer.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    page.appendChild(layer);
    const metrics = pageMetrics(page);
    const error = renderPageFurniture(layer, readPageFurniture(root), [pageGeometry(metrics, index, 0)], metrics, pages.childElementCount);
    if (error) throw new Error(error);
  });
  root.dataset.pageCount = String(pages.childElementCount);
  root.dataset.oversizedBlocks = String(oversized);
  return { ok: true, pages: pages.childElementCount, oversized };
}
