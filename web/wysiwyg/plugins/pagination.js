import { MeasurementWorkspace } from "../measurement_snapshot.js";
import { workBudget, checkCancelled, yieldToInput, cancellable } from "../work_scheduler.js";
import { mathRenderingSettled } from "../math_render_queue.js";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export const paginationKey = new PluginKey("infinite-pagination");

const PAGE_GAP_PX = 20;
const metricsByView = new WeakMap();
export const getPaginationMetrics = view => metricsByView.get(view);

export function pageStatusAtPosition(boundaries, position) {
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (boundaries[middle].position <= position) low = middle + 1;
    else high = middle;
  }
  return { current: low + 1, total: boundaries.length + 1 };
}

function normalizedBoundary(boundary) {
  return typeof boundary === "number"
    ? { position: boundary, height: null, kind: "automatic" }
    : {
      position: boundary.position,
      height: boundary.height ?? null,
      kind: boundary.kind ?? "automatic",
      placement: boundary.placement ?? "block",
      columns: boundary.columns ?? null,
    };
}

function sameBoundary(left, right) {
  return left.position === right.position
    && left.kind === right.kind
    && left.placement === right.placement
    && left.columns === right.columns
    && (
      left.height === right.height
      || (Number.isFinite(left.height)
        && Number.isFinite(right.height)
        && Math.abs(left.height - right.height) < 0.5)
    );
}

function pageGap(boundary) {
  const gap = document.createElement(boundary.placement === "row" ? "tr" : "span");
  gap.className = "infinite-pm-page-gap";
  gap.contentEditable = "false";
  gap.setAttribute("aria-hidden", "true");
  gap.dataset.position = String(boundary.position);
  gap.dataset.paginationKind = boundary.kind;
  if (Number.isFinite(boundary.height)) gap.style.height = `${boundary.height}px`;
  if (boundary.placement === "row") {
    gap.classList.add("infinite-pm-table-gap");
    const cell = document.createElement("td");
    cell.colSpan = boundary.columns || 1;
    const spacer = document.createElement("span");
    spacer.style.display = "block";
    spacer.style.height = gap.style.height;
    cell.appendChild(spacer);
    gap.appendChild(cell);
  }
  return gap;
}

function decorationSet(documentNode, boundaries) {
  return DecorationSet.create(documentNode, boundaries.map((boundary) => (
    Decoration.widget(boundary.position, () => pageGap(boundary), {
      key: `page-gap-${boundary.kind}-${boundary.position}-${boundary.height ?? "auto"}-${boundary.placement}-${boundary.columns}`,
      side: -1,
    })
  )));
}

export function setPaginationBoundaries(view, boundaries) {
  const normalized = boundaries.map(normalizedBoundary);
  const current = paginationKey.getState(view.state)?.positions ?? [];
  if (
    current.length === normalized.length
    && current.every((value, index) => sameBoundary(value, normalized[index]))
  ) {
    return false;
  }
  view.dispatch(view.state.tr
    .setMeta(paginationKey, normalized)
    .setMeta("addToHistory", false));
  return true;
}

export function calculatePaginationLayout(blocks, contentHeight, pageChromeHeight) {
  if (contentHeight <= 0) return { boundaries: [], tailHeight: 0 };
  if (blocks.length === 0) return { boundaries: [], tailHeight: contentHeight };
  const boundaries = [];
  let pageTop = blocks[0].top;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (
      index > 0
      && !block.forcePageBreakAfter
      && block.bottom - pageTop > contentHeight
    ) {
      const usedHeight = Math.max(0, block.top - pageTop);
      boundaries.push({
        position: block.resolvePosition ? block.resolvePosition() : block.position,
        height: Math.max(0, contentHeight - usedHeight) + pageChromeHeight,
        kind: "automatic",
        ...(block.placement ? { placement: block.placement, columns: block.columns } : {}),
      });
      pageTop = block.top;
    }
    if (block.forcePageBreakAfter) {
      const nextTop = blocks[index + 1]?.top ?? block.bottom;
      const usedHeight = Math.max(0, nextTop - pageTop);
      boundaries.push({
        position: block.endPosition,
        height: Math.max(0, contentHeight - usedHeight) + pageChromeHeight,
        kind: "explicit",
      });
      pageTop = nextTop;
    }
  }
  const finalPageUsedHeight = Math.max(0, blocks.at(-1).bottom - pageTop);
  return {
    boundaries,
    tailHeight: Math.max(0, contentHeight - finalPageUsedHeight),
  };
}

export function calculatePaginationBoundaries(blocks, contentHeight, pageChromeHeight) {
  return calculatePaginationLayout(blocks, contentHeight, pageChromeHeight).boundaries;
}

function millimetersToPixels(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed * 96 / 25.4 : 0;
}

async function textblockLines(view, dom, node, offset, viewTop, checkpoint) {
  const blockTop = dom.getBoundingClientRect().top;
  const fragments = [];
  const lineHeight = Number.parseFloat(getComputedStyle(dom).lineHeight) || 0;
  const range = document.createRange();
  const add = (position, rect, search = null) => {
    const leading = Math.max(0, lineHeight - rect.height) / 2;
    fragments.push({ position, top: rect.top - leading - viewTop, bottom: rect.bottom + leading - viewTop, search });
  };
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(candidate) {
      if (candidate.nodeType === Node.ELEMENT_NODE) {
        return candidate.matches('.infinite-pm-page-gap, .infinite-math, [contenteditable="false"]')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text;
  while ((text = walker.nextNode())) {
    if (!text.length) continue;
    const position = view.posAtDOM(text, 0);
    range.selectNodeContents(text);
    const rects = [...range.getClientRects()].filter(rect => rect.height > 0);
    let previousTop = -Infinity;
    for (const rect of rects) {
      if (Math.abs(rect.top - previousTop) < 1) continue;
      // Keep a line descriptor. Character offsets are needed only at actual
      // page boundaries, not at every line in the entire document.
      const search = previousTop === -Infinity ? null : {
        from: position - offset, length: text.length, top: rect.top - blockTop,
      };
      add(position, rect, search);
      previousTop = rect.top;
    }
    await checkpoint();
  }
  node.forEach((child, childOffset) => {
    if (child.isText) return;
    const position = offset + 1 + childOffset;
    const atom = view.nodeDOM(position);
    if (!atom) return;
    range.selectNode(atom);
    const rect = [...range.getClientRects()].find(rect => rect.height > 0);
    if (rect) add(position, rect);
  });
  fragments.sort((left, right) => left.position - right.position);
  const lines = [];
  for (const fragment of fragments) {
    const last = lines.at(-1);
    if (last && fragment.top < last.bottom - 1 && fragment.bottom > last.top + 1) {
      last.top = Math.min(last.top, fragment.top);
      last.bottom = Math.max(last.bottom, fragment.bottom);
    } else lines.push(fragment);
  }
  return lines;
}

function resolveLinePosition(view, offset, search, top) {
  if (search.resolved !== undefined) return offset + search.resolved;
  const range = document.createRange();
  let low = offset + search.from;
  let high = low + search.length - 1;
  let best = low;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = view.domAtPos(middle, 1);
    const end = view.domAtPos(middle + 1, -1);
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const rect = range.getClientRects()[0];
    if (rect && rect.top >= top + search.top - 1) {
      best = middle;
      high = middle - 1;
    } else low = middle + 1;
  }
  const character = view.state.doc.textBetween(best, best + 1);
  const resolved = /[\uDC00-\uDFFF]/u.test(character) ? best - 1 : best;
  search.resolved = resolved - offset;
  return resolved;
}

async function measuredLayout(liveView, measurementCache, signal, workspace, metrics) {
  const surface = liveView.dom.closest(".infinite-pm-surface");
  const page = liveView.dom.closest(".infinite-pm-page");
  if (!surface?.classList.contains("paged") || !page) {
    return { boundaries: [], tailHeight: 0 };
  }
  const style = getComputedStyle(page);
  const pageHeight = millimetersToPixels(style.getPropertyValue("--page-height"));
  const paddingTop = millimetersToPixels(style.getPropertyValue("--page-padding-top"));
  const paddingBottom = millimetersToPixels(style.getPropertyValue("--page-padding-bottom"));
  const contentHeight = pageHeight - paddingTop - paddingBottom;
  if (contentHeight <= 0) return { boundaries: [], tailHeight: 0 };

  const view = await workspace.snapshot(signal);
  const checkpoint = workBudget(signal, 6, 128, elapsed => { metrics.maxMeasureSliceMs = Math.max(metrics.maxMeasureSliceMs, elapsed); });
  const blocks = [];
  try {
    const viewTop = view.dom.getBoundingClientRect().top;
    const visit = async (node, offset) => {
      await checkpoint();
      if (node.type.name === "link_definition") return;
      const dom = view.nodeDOM(offset);
      if (!(dom instanceof HTMLElement)) return;
      const bounds = dom.getBoundingClientRect();
      const block = {
        position: offset,
        endPosition: offset + node.nodeSize,
        top: bounds.top - viewTop,
        bottom: bounds.bottom - viewTop,
        forcePageBreakAfter: node.type.name === "page_break",
      };
      if (node.type.name === "table_row") {
        blocks.push({ ...block, placement: "row", columns: node.childCount });
      } else if (node.isTextblock && node.content.size > 0) {
        const textStyle = getComputedStyle(dom);
        const key = [bounds.width, textStyle.font, textStyle.lineHeight,
          textStyle.letterSpacing, textStyle.whiteSpace, textStyle.wordBreak].join("|");
        const cached = measurementCache.get(node);
        let lines;
        if (cached?.key === key) {
          lines = cached.lines.map(line => ({
            position: offset + line.position,
            top: block.top + line.top,
            bottom: block.top + line.bottom,
            search: line.search,
          }));
        } else {
          lines = await textblockLines(view, dom, node, offset, viewTop, checkpoint);
          measurementCache.set(node, { key, lines: lines.map(line => ({
            position: line.position - offset,
            top: line.top - block.top,
            bottom: line.bottom - block.top,
            search: line.search,
          })) });
        }
        if (lines.length) {
          for (const line of lines) {
            if (line.search) line.resolvePosition = () => resolveLinePosition(view, offset, line.search, bounds.top);
          }
          lines[0].resolvePosition = null;
          lines[0].position = offset;
          lines[0].top = block.top;
          lines.at(-1).bottom = Math.max(lines.at(-1).bottom, block.bottom);
          blocks.push(...lines);
        } else blocks.push(block);
      } else if (!node.isLeaf && node.type.name !== "page_break") {
        let childOffset = 0;
        for (let index = 0; index < node.childCount; index++) {
          const child = node.child(index);
          await visit(child, offset + 1 + childOffset);
          childOffset += child.nodeSize;
        }
      } else blocks.push(block);
    };
    let offset = 0;
    for (let index = 0; index < view.state.doc.childCount; index++) {
      const node = view.state.doc.child(index);
      await visit(node, offset);
      offset += node.nodeSize;
    }
    checkCancelled(signal);
    return calculatePaginationLayout(blocks, contentHeight, paddingBottom + PAGE_GAP_PX + paddingTop);
  } finally {
    checkpoint.finish();
    view.destroy();
  }
}

function followingLineTop(view, position, cache) {
  const caret = view.coordsAtPos(position, 1);
  const resolved = view.state.doc.resolve(position);
  const root = resolved.parent.inlineContent
    ? view.nodeDOM(resolved.before()) : view.nodeDOM(position);
  if (!(root instanceof HTMLElement)) return caret.top;
  let rects = cache.get(root);
  if (!rects) {
    rects = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let text;
    while ((text = walker.nextNode())) {
      if (text.parentElement.closest(".katex-mathml, .infinite-pm-page-gap")) continue;
      range.selectNodeContents(text);
      rects.push(...range.getClientRects());
    }
    for (const image of root.querySelectorAll("img")) rects.push(image.getBoundingClientRect());
    cache.set(root, rects);
  }
  let top = caret.top;
  for (const rect of rects) {
    if (rect.width > 0 && rect.bottom > caret.top && rect.top < caret.bottom) top = Math.min(top, rect.top);
  }
  return top;
}

// Spacers participate in the local paragraph/list/table layout. Page chrome
// belongs to the physical page, never to an indented or clipped ancestor.
function paintPageGaps(view, layer) {
  const page = layer.parentElement;
  const bounds = page.getBoundingClientRect();
  const style = getComputedStyle(page);
  // offsetWidth rounds fractional millimeter widths to an integer. Using it
  // as a scale introduces an error that accumulates over every physical page.
  const extraWidth = style.boxSizing === "border-box" ? 0
    : [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
      .reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0);
  const scale = bounds.width / (Number.parseFloat(style.width) + extraWidth) || 1;
  const viewport = window.innerHeight || 1000;
  const glyphCache = new Map();
  const fragments = [...view.dom.querySelectorAll(".infinite-pm-page-gap")].map((gap) => {
    const rect = gap.getBoundingClientRect();
    if (rect.bottom < -viewport || rect.top > viewport * 2) return null;
    const paint = document.createElement("div");
    paint.className = "infinite-pm-page-chrome";
    paint.style.top = `${(rect.top - bounds.top) / scale - page.clientTop}px`;
    let bottom = rect.bottom;
    const position = Number(gap.dataset.position);
    if (gap.tagName !== "TR") {
      // A following inline atom can shift the next baseline above the block
      // spacer's bottom. Use the actual caret edge so chrome never masks text.
      const nextTop = followingLineTop(view, position, glyphCache);
      if (nextTop > rect.top) bottom = Math.min(bottom, nextTop);
    }
    paint.style.height = `${Math.max(0, (bottom - rect.top) / scale - (gap.tagName === "TR" ? 1 : 0))}px`;
    return paint;
  });
  layer.replaceChildren(...fragments.filter(Boolean));
}

function setFinalPageTail(view, tailHeight) {
  const value = tailHeight > 0 ? `${tailHeight}px` : "";
  if (view.dom.style.paddingBottom !== value) view.dom.style.paddingBottom = value;
}

function layoutSignature(view, page) {
  if (!page) return "seamless";
  const style = getComputedStyle(page);
  const textStyle = getComputedStyle(view.dom);
  return [
    page.closest(".infinite-pm-surface")?.className,
    style.width, view.dom.clientWidth,
    ...["--page-height", "--page-padding-top", "--page-padding-bottom",
      "--page-padding-left", "--page-padding-right"].map(name => style.getPropertyValue(name)),
    textStyle.fontFamily, textStyle.fontSize, textStyle.lineHeight,
  ].join("|");
}

export function paginationPlugin(options = {}) {
  return new Plugin({
    key: paginationKey,
    state: {
      init: (_, state) => ({ positions: [], decorations: DecorationSet.empty, document: state.doc }),
      apply(transaction, previous) {
        const boundaries = transaction.getMeta(paginationKey);
        if (Array.isArray(boundaries)) {
          return {
            positions: boundaries,
            decorations: decorationSet(transaction.doc, boundaries),
            document: transaction.doc,
          };
        }
        if (transaction.docChanged) {
          return {
            positions: previous.positions.map((boundary) => ({
              ...boundary,
              position: transaction.mapping.map(boundary.position),
            })),
            decorations: previous.decorations.map(transaction.mapping, transaction.doc),
            document: transaction.doc,
          };
        }
        return previous;
      },
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state)?.decorations ?? null;
      },
    },
    view(view) {
      const metrics = { started: 0, committed: 0, cancelled: 0, maxMeasureSliceMs: 0, maxCommitMs: 0, maxPaintMs: 0 };
      metricsByView.set(view, metrics);
      let statusTimer = 0;
      let paintFrame = 0;
      let frame = 0;
      let compositionTimer = 0;
      let activeJob = null;
      let destroyed = false;
      const workspace = new MeasurementWorkspace(view);
      let measurementCache = new WeakMap();
      let lastDocument = null;
      let lastSignature = null;
      let lastPageStatus = null;
      const reportPageStatus = () => {
        if (!options.onPageChange) return;
        const boundaries = paginationKey.getState(view.state)?.positions ?? [];
        const next = pageStatusAtPosition(boundaries, view.state.selection.head);
        if (lastPageStatus?.current === next.current && lastPageStatus.total === next.total) return;
        lastPageStatus = next;
        options.onPageChange(next);
      };
      const page = view.dom.closest(".infinite-pm-page");
      const layer = document.createElement("div");
      layer.className = "infinite-pm-pagination-layer";
      layer.setAttribute("aria-hidden", "true");
      page?.appendChild(layer);
      const status = document.createElement("div");
      status.className = "editor-layout-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.textContent = "正在调整页面…";
      status.hidden = true;
      page?.parentElement.appendChild(status);
      const paint = () => {
        if (destroyed || !page) return;
        const start = performance.now();
        paintPageGaps(view, layer);
        metrics.maxPaintMs = Math.max(metrics.maxPaintMs, performance.now() - start);
      };
      const schedulePaint = () => {
        if (destroyed || paintFrame) return;
        paintFrame = requestAnimationFrame(() => { paintFrame = 0; paint(); });
      };
      const schedule = () => {
        if (destroyed || frame) return;
        frame = requestAnimationFrame(async () => {
          frame = 0;
          if (destroyed || view.composing) return;
          const signature = layoutSignature(view, page);
          if (lastDocument === view.state.doc && lastSignature === signature) return;
          if (activeJob) return;
          if (signature !== lastSignature) measurementCache = new WeakMap();
          const controller = new AbortController();
          activeJob = controller;
          metrics.started++;
          status.textContent = "正在调整页面…";
          statusTimer = setTimeout(() => { if (!destroyed) status.hidden = false; }, 150);
          const documentNode = view.state.doc;
          if (page) page.dataset.paginationState = "working";
          try {
            await cancellable(mathRenderingSettled(), controller.signal);
            checkCancelled(controller.signal);
            const layout = await measuredLayout(view, measurementCache, controller.signal, workspace, metrics);
            checkCancelled(controller.signal);
            if (destroyed || view.state.doc !== documentNode || layoutSignature(view, page) !== signature) return;
            lastDocument = documentNode;
            lastSignature = signature;
            const commitStart = performance.now();
            setFinalPageTail(view, layout.tailHeight);
            setPaginationBoundaries(view, layout.boundaries);
            reportPageStatus();
            metrics.maxCommitMs = Math.max(metrics.maxCommitMs, performance.now() - commitStart);
            metrics.committed++;
            await yieldToInput(controller.signal);
            if (page) {
              paint();
              page.dataset.paginationState = "idle";
            }
          } catch (error) {
            if (error.name === "AbortError") metrics.cancelled++;
            if (error.name !== "AbortError") {
              lastDocument = documentNode;
              lastSignature = signature;
              if (page) page.dataset.paginationState = "error";
              status.textContent = "页面排版失败，请调整页面设置后重试";
              status.hidden = false;
              console.error("Pagination failed", error);
            }
          } finally {
            clearTimeout(statusTimer);
            if (page?.dataset.paginationState !== "error") status.hidden = true;
            activeJob = null;
            if (!destroyed && (lastDocument !== view.state.doc || lastSignature !== layoutSignature(view, page))) schedule();
          }
        });
      };
      const invalidate = () => { lastSignature = null; activeJob?.abort(); schedule(); };
      const compositionEnd = () => {
        clearTimeout(compositionTimer);
        compositionTimer = setTimeout(schedule, 50);
      };
      const observer = typeof ResizeObserver === "undefined"
        ? { observe() {}, disconnect() {} }
        : new ResizeObserver(schedule);
      observer.observe(view.dom);
      if (page) observer.observe(page);
      const attributes = typeof MutationObserver === "undefined"
        ? { observe() {}, disconnect() {} }
        : new MutationObserver(schedule);
      if (page) attributes.observe(page, { attributes: true, attributeFilter: ["class", "style"] });
      const surface = page?.closest(".infinite-pm-surface");
      if (surface) attributes.observe(surface, { attributes: true, attributeFilter: ["class", "style"] });
      window.addEventListener("resize", schedule, { passive: true });
      window.addEventListener("scroll", schedulePaint, { passive: true, capture: true });
      window.addEventListener("infinite-math-renderer-ready", invalidate);
      document.fonts?.addEventListener("loadingdone", invalidate);
      view.dom.addEventListener("load", invalidate, true);
      view.dom.addEventListener("compositionend", compositionEnd);
      schedule();
      return {
        update(nextView, previousState) {
          // Selection moves and our own decoration transactions do not change
          // content. Neither should launch another full-document layout pass.
          if (nextView.state.doc !== previousState.doc) { activeJob?.abort(); schedule(); }
          reportPageStatus();
        },
        destroy() {
          destroyed = true;
          activeJob?.abort();
          if (frame) cancelAnimationFrame(frame);
          if (paintFrame) cancelAnimationFrame(paintFrame);
          clearTimeout(compositionTimer);
          clearTimeout(statusTimer);
          status.remove();
          setFinalPageTail(view, 0);
          observer.disconnect();
          attributes.disconnect();
          layer.remove();
          workspace.destroy();
          window.removeEventListener("resize", schedule);
          window.removeEventListener("scroll", schedulePaint, true);
          window.removeEventListener("infinite-math-renderer-ready", invalidate);
          document.fonts?.removeEventListener("loadingdone", invalidate);
          view.dom.removeEventListener("load", invalidate, true);
          view.dom.removeEventListener("compositionend", compositionEnd);
        },
      };
    },
  });
}
