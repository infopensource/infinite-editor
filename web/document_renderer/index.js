import { paginate } from "./pagination.js";
import { normalizeResourcePath } from "../resource_path.js";

function hydrateResourceImages(root, resources = {}) {
  for (const image of root?.querySelectorAll("img[src]") ?? []) {
    const original = image.dataset.infiniteResourceSource || image.getAttribute("src");
    const key = normalizeResourcePath(original);
    const resolved = key ? resources[key] : null;
    if (resolved) {
      image.dataset.infiniteResourceSource = original;
      image.setAttribute("src", resolved);
    }
  }
}

function sameResources(left = {}, right = {}) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => left[key] === right[key]);
}

(function installDocumentRenderer() {
  const instances = new Map();
  const previewStates = new WeakMap();

  function updatePreview(root, html, resources = {}, version = null) {
    if (!root) return { ok: false, error: "缺少 Markdown 预览根节点" };
    const previous = previewStates.get(root);
    const stale = previous?.version && version && (
      version.documentRevision < previous.version.documentRevision
      || (
        version.documentRevision === previous.version.documentRevision
        && version.editRevision < previous.version.editRevision
      )
    );
    if (stale) return { ok: true, changed: false, stale: true };
    if (previous?.html === html && sameResources(previous.resources, resources)) {
      previewStates.set(root, { html, resources, version });
      return { ok: true, changed: false };
    }

    const staging = document.createElement("div");
    staging.innerHTML = html;
    hydrateResourceImages(staging, resources);
    const math = window.InfiniteMathRenderer?.render(staging);
    const scroller = root.closest(".markdown-preview-pane");
    const scrollTop = scroller?.scrollTop ?? 0;
    const scrollLeft = scroller?.scrollLeft ?? 0;

    // Build the complete preview away from the live tree, then swap it in one
    // DOM operation so raw math placeholders are never painted to the screen.
    root.replaceChildren(...staging.childNodes);
    if (scroller) {
      scroller.scrollTop = scrollTop;
      scroller.scrollLeft = scrollLeft;
    }
    previewStates.set(root, { html, resources, version });
    return { ok: true, changed: true, renderedMath: math?.rendered ?? 0 };
  }

  function schedule(instance) {
    instance.generation += 1;
    const generation = instance.generation;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation !== instance.generation || !instance.root.isConnected) return;
      paginate(instance.root, instance.seamless);
    }));
  }

  function hydrateAndWatchResources(instance) {
    const source = instance.root.querySelector(".document-pagination-source");
    hydrateResourceImages(source, instance.resources);
    const reflow = () => schedule(instance);
    for (const image of source?.querySelectorAll("img") ?? []) {
      if (!image.complete) {
        image.addEventListener("load", reflow, { once: true });
        image.addEventListener("error", reflow, { once: true });
      }
    }
    if (document.fonts?.ready) document.fonts.ready.then(reflow);
  }

  function mount(rootId, seamless, resources = {}) {
    const root = document.getElementById(rootId);
    if (!root) return { ok: false, error: `找不到文档渲染器：${rootId}` };

    let instance = instances.get(rootId);
    if (!instance || instance.root !== root) {
      instance?.observer.disconnect();
      instance = {
        root,
        seamless,
        resources,
        generation: 0,
        observer: null,
      };
      instance.observer = new MutationObserver(() => {
        hydrateAndWatchResources(instance);
        schedule(instance);
      });
      const source = root.querySelector(".document-pagination-source");
      if (source) instance.observer.observe(source, { childList: true, subtree: true });
      instances.set(rootId, instance);
    }

    instance.seamless = seamless;
    instance.resources = resources;
    hydrateAndWatchResources(instance);
    schedule(instance);
    return { ok: true };
  }

  function destroy(rootId) {
    const instance = instances.get(rootId);
    instance?.observer.disconnect();
    if (instance) instance.generation += 1;
    instances.delete(rootId);
  }

  window.InfiniteDocumentRenderer = {
    mount,
    paginate,
    destroy,
    hydrateResources: hydrateResourceImages,
    updatePreview,
  };
  window.dispatchEvent(new CustomEvent("infinite-document-renderer-ready"));
}());
