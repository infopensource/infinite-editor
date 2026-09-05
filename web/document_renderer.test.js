import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  `<!doctype html>
   <section id="renderer">
     <div class="document-pagination-source">
       <p>第一段</p><p>第二段</p><p>第三段</p>
     </div>
     <div data-document-pages></div>
   </section>`,
  { pretendToBeVisual: true },
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

let pageCapacity = 100;
Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return this.classList.contains("document-page-content") ? pageCapacity : 0;
  },
});
Object.defineProperty(dom.window.HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get() {
    if (!this.classList.contains("document-page-content")) return 0;
    return Math.max(
      this.childElementCount * 60,
      Math.ceil((this.textContent?.length ?? 0) / 8) * 60,
    );
  },
});

await import("../assets/math.bundle.js");
await import("../assets/document_renderer.js");
const api = window.InfiniteDocumentRenderer;

function resetRenderer() {
  api.destroy("renderer");
  pageCapacity = 100;
  document.body.innerHTML = `
    <section id="renderer">
      <div class="document-pagination-source">
        <p>第一段</p><p>第二段</p><p>第三段</p>
      </div>
      <div data-document-pages></div>
    </section>`;
}

function flushRenderer() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

test.beforeEach(resetRenderer);
test.after(() => {
  api.destroy("renderer");
  dom.window.close();
});

test("exposes only the read-only document renderer API", () => {
  assert.deepEqual(
    Object.keys(api).sort(),
    ["destroy", "hydrateResources", "mount", "paginate", "updatePreview"],
  );
});

test("updates a Markdown preview in one swap after rendering math and keeps its scroll", () => {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<section class="markdown-preview-pane"><div id="preview"></div></section>',
  );
  const root = document.getElementById("preview");
  const scroller = root.parentElement;
  scroller.scrollTop = 140;

  const result = api.updatePreview(
    root,
    '<p>新版 <code class="language-math math-inline">x^2</code></p>',
  );

  assert.deepEqual(result, { ok: true, changed: true, renderedMath: 1 });
  assert.equal(document.getElementById("preview"), root);
  assert.equal(root.textContent.includes("新版"), true);
  assert.equal(root.querySelectorAll(".infinite-math .katex").length, 1);
  assert.equal(scroller.scrollTop, 140);

  const latest = api.updatePreview(root, "<p>较新内容</p>", {}, {
    documentRevision: 2,
    editRevision: 3,
  });
  assert.equal(latest.changed, true);
  assert.equal(api.updatePreview(root, "<p>更旧内容</p>", {}, {
    documentRevision: 2,
    editRevision: 2,
  }).stale, true);
  assert.equal(root.textContent, "较新内容");
});

test("paginates using measured content height", () => {
  const root = document.getElementById("renderer");
  const result = api.paginate(root, false);
  assert.equal(result.ok, true);
  assert.equal(result.pages, 3);
  assert.deepEqual(
    [...root.querySelectorAll(".document-page-content")].map((page) => page.textContent),
    ["第一段", "第二段", "第三段"],
  );
});

test("renders formulas before pagination", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML = `
    <p>能量 <code class="language-math math-inline">E=mc^2</code></p>
    <pre><code class="language-math math-display">\\ce{2H2 + O2 -&gt; 2H2O}</code></pre>`;
  assert.equal(api.paginate(root, true).ok, true);
  assert.equal(root.querySelectorAll(".document-pagination-source .infinite-math").length, 2);
  assert.equal(root.querySelectorAll(".document-page-content .katex").length, 2);
});

test("splits a long paragraph across physical pages", () => {
  const root = document.getElementById("renderer");
  const text = "这是一段用于检查跨页切分的长文本。".repeat(8);
  root.querySelector(".document-pagination-source").innerHTML = `<p>${text}</p>`;
  const result = api.paginate(root, false);
  assert.ok(result.pages > 1);
  assert.equal(root.querySelector("[data-document-pages]").textContent, text);
});

test("honors explicit page breaks", () => {
  pageCapacity = 200;
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML = `
    <p>第一页</p><div class="infinite-page-break"></div><p>第二页</p>`;
  const result = api.paginate(root, false);
  assert.equal(result.pages, 2);
  assert.deepEqual(
    [...root.querySelectorAll(".document-page-content")].map((page) => page.textContent.trim()),
    ["第一页", "第二页"],
  );
});

test("seamless mode ignores explicit page breaks", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML = `
    <p>前</p><div class="infinite-page-break"></div><p>后</p>`;
  const result = api.paginate(root, true);
  assert.equal(result.pages, 1);
  assert.equal(root.querySelector(".document-page-content").textContent.trim(), "前后");
});

test("mount hydrates resources and schedules pagination", async () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<p><img src="document.assets/image.png" alt="图"></p>';
  const mounted = api.mount("renderer", true, {
    "document.assets/image.png": "data:image/png;base64,AQID",
  });
  assert.equal(mounted.ok, true);
  await flushRenderer();
  assert.equal(root.querySelector(".document-pagination-source img").src, "data:image/png;base64,AQID");
  assert.equal(root.querySelector(".document-page-content img").src, "data:image/png;base64,AQID");
});
