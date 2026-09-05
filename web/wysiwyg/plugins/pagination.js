import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export const paginationKey = new PluginKey("infinite-pagination");

const PAGE_GAP_PX = 20;

function normalizedBoundary(boundary) {
  return typeof boundary === "number"
    ? { position: boundary, height: null, kind: "automatic" }
    : {
      position: boundary.position,
      height: boundary.height ?? null,
      kind: boundary.kind ?? "automatic",
    };
}

function sameBoundary(left, right) {
  return left.position === right.position
    && left.kind === right.kind
    && (
      left.height === right.height
      || (Number.isFinite(left.height)
        && Number.isFinite(right.height)
        && Math.abs(left.height - right.height) < 0.5)
    );
}

function pageGap(boundary) {
  const gap = document.createElement("div");
  gap.className = "infinite-pm-page-gap";
  gap.contentEditable = "false";
  gap.setAttribute("aria-hidden", "true");
  gap.dataset.position = String(boundary.position);
  gap.dataset.paginationKind = boundary.kind;
  if (Number.isFinite(boundary.height)) gap.style.height = `${boundary.height}px`;
  return gap;
}

function decorationSet(documentNode, boundaries) {
  return DecorationSet.create(documentNode, boundaries.map((boundary) => (
    Decoration.widget(boundary.position, () => pageGap(boundary), {
      key: `page-gap-${boundary.kind}-${boundary.position}-${boundary.height ?? "auto"}`,
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
        position: block.position,
        height: Math.max(0, contentHeight - usedHeight) + pageChromeHeight,
        kind: "automatic",
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

function measuredLayout(view) {
  const surface = view.dom.closest(".infinite-pm-surface");
  const page = view.dom.closest(".infinite-pm-page");
  if (!surface?.classList.contains("paged") || !page) {
    return { boundaries: [], tailHeight: 0 };
  }
  const style = getComputedStyle(page);
  const pageHeight = millimetersToPixels(style.getPropertyValue("--page-height"));
  const paddingTop = millimetersToPixels(style.getPropertyValue("--page-padding-top"));
  const paddingBottom = millimetersToPixels(style.getPropertyValue("--page-padding-bottom"));
  const contentHeight = pageHeight - paddingTop - paddingBottom;
  if (contentHeight <= 0) return { boundaries: [], tailHeight: 0 };

  const viewTop = view.dom.getBoundingClientRect().top;
  const existingGaps = [...view.dom.querySelectorAll(".infinite-pm-page-gap")]
    .map((gap) => gap.getBoundingClientRect())
    .filter((bounds) => bounds.height > 0);
  const blocks = [];
  view.state.doc.forEach((node, offset) => {
    if (node.type.name === "link_definition") return;
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement) || dom.classList.contains("infinite-pm-page-gap")) return;
    const bounds = dom.getBoundingClientRect();
    const insertedHeight = existingGaps.reduce(
      (height, gap) => height + (gap.top < bounds.top ? gap.height : 0),
      0,
    );
    blocks.push({
      position: offset,
      endPosition: offset + node.nodeSize,
      top: bounds.top - viewTop - insertedHeight,
      bottom: bounds.bottom - viewTop - insertedHeight,
      forcePageBreakAfter: node.type.name === "page_break",
    });
  });
  return calculatePaginationLayout(
    blocks,
    contentHeight,
    paddingBottom + PAGE_GAP_PX + paddingTop,
  );
}

function setFinalPageTail(view, tailHeight) {
  const value = tailHeight > 0 ? `${tailHeight}px` : "";
  if (view.dom.style.paddingBottom !== value) view.dom.style.paddingBottom = value;
}

export function paginationPlugin() {
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
      let frame = 0;
      const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const layout = measuredLayout(view);
          setFinalPageTail(view, layout.tailHeight);
          setPaginationBoundaries(view, layout.boundaries);
        });
      };
      const observer = typeof ResizeObserver === "undefined"
        ? { observe() {}, disconnect() {} }
        : new ResizeObserver(schedule);
      observer.observe(view.dom);
      const page = view.dom.closest(".infinite-pm-page");
      if (page) observer.observe(page);
      window.addEventListener("resize", schedule, { passive: true });
      schedule();
      return {
        update: schedule,
        destroy() {
          if (frame) cancelAnimationFrame(frame);
          setFinalPageTail(view, 0);
          observer.disconnect();
          window.removeEventListener("resize", schedule);
        },
      };
    },
  });
}
