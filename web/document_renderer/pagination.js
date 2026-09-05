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
  const startPosition = textPosition(element, start);
  const endPosition = textPosition(element, end);
  if (!startPosition || !endPosition) return null;
  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset);
  const clone = element.cloneNode(false);
  clone.appendChild(range.cloneContents());
  return clone;
}

function splitToFit(node, content) {
  const length = node.textContent?.length ?? 0;
  if (
    length < 2
    || !node.matches("p, pre, blockquote, ul, ol")
    || node.querySelector("img, video, iframe, svg, table, .infinite-math")
  ) return null;

  let low = 1;
  let high = length - 1;
  let best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = cloneTextRange(node, 0, middle);
    if (!candidate) return null;
    content.appendChild(candidate);
    if (isOverflowing(content)) high = middle - 1;
    else {
      best = middle;
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
    if (node.dataset.explicitPageBreak === "true") current = createPage(pages, false);
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
  });
  root.dataset.pageCount = String(pages.childElementCount);
  root.dataset.oversizedBlocks = String(oversized);
  return { ok: true, pages: pages.childElementCount, oversized };
}
