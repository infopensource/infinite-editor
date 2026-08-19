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
  { pretendToBeVisual: true }
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return this.classList.contains("document-page-content") ? 100 : 0;
  },
});

Object.defineProperty(dom.window.HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get() {
    if (!this.classList.contains("document-page-content")) return 0;
    return this.childElementCount * 60;
  },
});

await import("../assets/document_renderer.js");
const api = window.InfiniteDocumentRenderer;

function resetRenderer() {
  api.destroy("renderer");
  delete window.InfiniteMarkdownEditor;
  document.body.innerHTML = `
    <section id="renderer">
      <div class="document-pagination-source">
        <p>第一段</p><p>第二段</p><p>第三段</p>
      </div>
      <div data-document-pages></div>
    </section>`;
}

function mockMarkdownController(initial, documentRevision, editRevision, received = []) {
  let markdown = initial;
  let revision = editRevision;
  const apply = (edits) => {
    for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
      markdown = markdown.slice(0, edit.from) + edit.insert + markdown.slice(edit.to);
    }
    revision += 1;
    return { ok: true, changed: true, revision };
  };
  return {
    initialize() { return { ok: true }; },
    getValue() { return markdown; },
    getRevision() { return revision; },
    getSnapshot() {
      return { documentRevision, editRevision: revision, markdown, origin: "test" };
    },
    applyEdits(edits) {
      received.push(edits);
      return apply(edits);
    },
    replaceAll(next) {
      if (next === markdown) return { ok: true, changed: false, revision };
      markdown = next;
      revision += 1;
      return { ok: true, changed: true, revision };
    },
    value() { return markdown; },
  };
}

function flushRenderer() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function selectContents(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}

test.beforeEach(resetRenderer);

test.after(() => {
  api.destroy("renderer");
  dom.window.close();
});

test("paginates using measured content height", () => {
  const root = document.getElementById("renderer");
  const result = api.paginate(root, false);

  assert.equal(result.ok, true);
  assert.equal(result.pages, 3);
  assert.equal(root.querySelectorAll(".paged-page").length, 3);
  assert.deepEqual(
    [...root.querySelectorAll(".document-page-content")].map((page) => page.textContent),
    ["第一段", "第二段", "第三段"]
  );
});

test("initializes pending WYSIWYG mounts when the Markdown controller becomes ready", async () => {
  const root = document.getElementById("renderer");
  const markdown = "普通段落";
  root.querySelector(".document-pagination-source").innerHTML =
    `<p data-markdown-from="0" data-markdown-to="${markdown.length}">普通段落</p>`;
  delete window.InfiniteMarkdownEditor;

  const pending = api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 40, 0, 1);
  assert.equal(pending.pending, true);

  const controller = mockMarkdownController(markdown, 40, 0);
  window.InfiniteMarkdownEditor = controller;
  window.dispatchEvent(new CustomEvent("infinite-markdown-editor-ready"));
  await flushRenderer();

  const paragraph = root.querySelector(".document-page-content p");
  const range = document.createRange();
  range.setStart(paragraph.firstChild, 1);
  range.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  assert.equal(api.command("renderer", "unordered_list").ok, true);
  assert.equal(controller.value(), "- 普通段落");
});

test("honors explicit page breaks", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<p>第一页</p><div class="infinite-page-break"></div><p>第二页</p>';

  const result = api.paginate(root, false);

  assert.equal(result.pages, 2);
  assert.deepEqual(
    [...root.querySelectorAll(".document-page-content")].map((page) => page.textContent),
    ["第一页", "第二页"]
  );
});

test("seamless mode ignores page breaks and renders one continuous page", () => {
  const root = document.getElementById("renderer");
  const result = api.paginate(root, true);

  assert.equal(result.pages, 1);
  assert.equal(root.querySelectorAll(".seamless-page").length, 1);
  assert.equal(root.querySelector(".document-page-content").textContent, "第一段第二段第三段");
});

test("resolves relative Markdown images from the document resource bundle", async () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<p><img src="./proposal.assets/cover.png" alt="封面"></p>';

  api.mount("renderer", false, {
    "proposal.assets/cover.png": "data:image/png;base64,AA==",
  });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  assert.equal(
    root.querySelector(".document-pagination-source img").getAttribute("src"),
    "data:image/png;base64,AA=="
  );
});

test("serializes formatted WYSIWYG content back to Markdown", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML = `
    <h1>标题</h1>
    <p>正文 <strong>加粗</strong> 和 <em>斜体</em>，<a href="https://example.com">链接</a></p>
    <ul><li>第一项</li><li><code>第二项</code></li></ul>
  `;
  api.paginate(root, true);

  assert.equal(
    api.serializeMarkdown(root),
    "# 标题\n\n正文 **加粗** 和 *斜体*，[链接](https://example.com)\n\n- 第一项\n- `第二项`"
  );
});

test("serializes multiple quote paragraphs with Markdown quote prefixes", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    `<blockquote>
      <p>第一段</p>
      <div>第二段</div>
    </blockquote>`;
  api.paginate(root, true);

  assert.equal(api.serializeMarkdown(root), "> 第一段\n>\n> 第二段");
});

test("keeps a real empty quote paragraph but ignores formatting whitespace", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    `<blockquote>
      <p>第一行</p>
      <p><br></p>
      <p>第三行</p>
    </blockquote>`;
  api.paginate(root, true);

  assert.equal(api.serializeMarkdown(root), "> 第一行\n>\n> &nbsp;\n>\n> 第三行");
});

test("does not duplicate Markdown markers for nested bold DOM", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    "<p><strong>已经加粗 <b>混合选区</b></strong></p>";
  api.paginate(root, true);

  assert.equal(api.serializeMarkdown(root), "**已经加粗 混合选区**");
});

test("keeps explicit page breaks but does not persist automatic pages", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<p>第一页</p><div class="infinite-page-break"></div><p>第二页</p><p>自动分页段落</p>';
  api.paginate(root, false);

  assert.equal(
    api.serializeMarkdown(root),
    "第一页\n\n<!-- infinite-editor:page-break -->\n\n第二页\n\n自动分页段落"
  );
});

test("preserves a leading page break and its blank first page", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<div class="infinite-page-break"></div><p>第二页</p>';
  const result = api.paginate(root, false);

  assert.equal(result.pages, 2);
  assert.equal(api.serializeMarkdown(root), "<!-- infinite-editor:page-break -->\n\n第二页");
});

test("dispatches direct page edits through the Markdown bridge", async () => {
  const root = document.getElementById("renderer");
  root.insertAdjacentHTML("beforeend", '<textarea id="wysiwyg-bridge"></textarea>');
  root.querySelector(".document-pagination-source").innerHTML = "<p>原文</p>";
  api.mount("renderer", true, {}, true, "wysiwyg-bridge");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const bridge = document.getElementById("wysiwyg-bridge");
  const received = new Promise((resolve) => bridge.addEventListener("input", resolve, { once: true }));
  const paragraph = root.querySelector(".document-page-content p");
  assert.equal(paragraph.dataset.documentBlockId, "block-0");
  paragraph.textContent = "修改后的正文";
  paragraph.dispatchEvent(new Event("input", { bubbles: true }));
  await received;

  assert.deepEqual(JSON.parse(bridge.value), {
    document_revision: 0,
    edit_revision: 1,
    origin: "wysiwyg-input",
    markdown: "修改后的正文",
  });
  assert.equal(root.querySelector(".document-page-content").getAttribute("contenteditable"), "true");
});

test("commits only the edited Markdown source block", async () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="2">原文</p>'
    + '<p data-markdown-from="4" data-markdown-to="10"><strong>保留</strong></p>';
  const received = [];
  window.InfiniteMarkdownEditor = mockMarkdownController("原文\n\n__保留__", 2, 2, received);
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", "原文\n\n__保留__", 2, 2);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const paragraph = root.querySelector(".document-page-content p");
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  paragraph.dispatchEvent(new Event("beforeinput", { bubbles: true }));
  paragraph.textContent = "新文本";
  const updatedRange = document.createRange();
  updatedRange.selectNodeContents(paragraph);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(updatedRange);
  paragraph.dispatchEvent(new Event("input", { bubbles: true }));

  assert.deepEqual(received[0], [{
    id: "block-0",
    from: 0,
    to: 2,
    insert: "新文本",
  }]);
  delete window.InfiniteMarkdownEditor;
});

test("deletes ordinary text through a local Markdown transaction", async () => {
  const root = document.getElementById("renderer");
  const markdown = "文字\n\n保留";
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="2">文字</p>'
    + '<p data-markdown-from="4" data-markdown-to="6">保留</p>';
  const controller = mockMarkdownController(markdown, 14, 1);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 14, 1, 1);
  await flushRenderer();

  const paragraph = root.querySelector(".document-page-content p");
  selectContents(paragraph);
  paragraph.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "deleteContentBackward",
  }));
  paragraph.textContent = "文";
  selectContents(paragraph);
  paragraph.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "deleteContentBackward",
  }));

  assert.equal(controller.value(), "文\n\n保留");
});

test("removes empty structural markers after deleting a cross-block selection", async () => {
  const root = document.getElementById("renderer");
  const markdown = "# 标题\n\n> 引用";
  root.querySelector(".document-pagination-source").innerHTML =
    '<h1 data-markdown-from="0" data-markdown-to="4">标题</h1>'
    + '<blockquote data-markdown-from="6" data-markdown-to="10"><p>引用</p></blockquote>';
  const controller = mockMarkdownController(markdown, 20, 1);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 20, 1, 1);
  await flushRenderer();

  const content = root.querySelector(".document-page-content");
  const heading = content.querySelector("h1");
  const quote = content.querySelector("blockquote");
  selectContents(content);
  heading.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "deleteContentBackward",
  }));
  heading.textContent = "";
  quote.textContent = "";
  heading.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "deleteContentBackward",
  }));

  assert.equal(controller.value(), "");
  assert.equal(content.querySelector("h1, blockquote"), null);
});

test("edits the synthetic trailing paragraph instead of resetting it", async () => {
  const root = document.getElementById("renderer");
  const markdown = "正文\n\n";
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="2">正文</p>'
    + '<p class="wysiwyg-empty-paragraph"><br></p>';
  const controller = mockMarkdownController(markdown, 17, 1);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 17, 1, 1);
  await flushRenderer();

  const trailing = root.querySelector(".document-page-content .wysiwyg-empty-paragraph");
  assert.equal(trailing.dataset.markdownFrom, String(markdown.length));
  assert.equal(trailing.dataset.markdownTo, String(markdown.length));
  selectContents(trailing);
  trailing.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "insertText",
  }));
  trailing.classList.remove("wysiwyg-empty-paragraph");
  trailing.textContent = "新增";
  selectContents(trailing);
  trailing.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
  }));

  assert.equal(controller.value(), "正文\n\n新增");
  assert.equal(trailing.isConnected, true);
});

test("accepts consecutive deletions before a render acknowledgement arrives", async () => {
  const root = document.getElementById("renderer");
  const controller = mockMarkdownController("abc", 18, 1);
  window.InfiniteMarkdownEditor = controller;
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="3">abc</p>';
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", "abc", 18, 1, 1);
  await flushRenderer();

  const paragraph = root.querySelector(".document-page-content p");
  for (const value of ["ab", "a"]) {
    selectContents(paragraph);
    paragraph.dispatchEvent(new dom.window.InputEvent("beforeinput", {
      bubbles: true,
      inputType: "deleteContentBackward",
    }));
    paragraph.textContent = value;
    selectContents(paragraph);
    paragraph.dispatchEvent(new dom.window.InputEvent("input", {
      bubbles: true,
      inputType: "deleteContentBackward",
    }));
  }

  assert.equal(controller.value(), "a");
  assert.equal(paragraph.isConnected, true);
});

test("deletes a top-level block even after the browser removes its DOM node", async () => {
  const root = document.getElementById("renderer");
  const markdown = "第一段\n\n第二段\n\n不得丢失";
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="3">第一段</p>'
    + '<p data-markdown-from="5" data-markdown-to="8">第二段</p>'
    + '<p data-markdown-from="10" data-markdown-to="14">不得丢失</p>';
  const controller = mockMarkdownController(markdown, 15, 1);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 15, 1, 1);
  await flushRenderer();

  const paragraphs = root.querySelectorAll(".document-page-content p");
  selectContents(paragraphs[1]);
  paragraphs[1].dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "deleteContentBackward",
  }));
  paragraphs[1].remove();
  paragraphs[0].dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "deleteContentBackward",
  }));

  assert.equal(controller.value(), "第一段\n\n不得丢失");
});

test("merges paragraphs when Backspace removes their structural boundary", async () => {
  const root = document.getElementById("renderer");
  const markdown = "甲\n\n乙";
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="1">甲</p>'
    + '<p data-markdown-from="3" data-markdown-to="4">乙</p>';
  const controller = mockMarkdownController(markdown, 16, 1);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 16, 1, 1);
  await flushRenderer();

  const [first, second] = root.querySelectorAll(".document-page-content p");
  selectContents(second);
  second.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "deleteContentBackward",
  }));
  first.textContent = "甲乙";
  second.remove();
  selectContents(first);
  first.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "deleteContentBackward",
  }));

  assert.equal(controller.value(), "甲乙");
});

test("bolds a mixed selection without multiplying asterisks", async () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="10"><strong>已粗</strong>未粗</p>';
  const received = [];
  const controller = mockMarkdownController("**已粗**未粗", 3, 3, received);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", "**已粗**未粗", 3, 3);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const paragraph = root.querySelector(".document-page-content p");
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  api.command("renderer", "bold");

  assert.equal(controller.value(), "**已粗未粗**");
  assert.equal(received.length, 1);
  delete window.InfiniteMarkdownEditor;
});

test("formats a list item without deleting the ordered or unordered list", async () => {
  for (const { tag, markdown, expected } of [
    { tag: "ul", markdown: "- 第一项\n- 第二项", expected: "- **第一项**\n- 第二项" },
    { tag: "ol", markdown: "1. 第一项\n2. 第二项", expected: "1. **第一项**\n2. 第二项" },
  ]) {
    const root = document.getElementById("renderer");
    root.querySelector(".document-pagination-source").innerHTML =
      `<${tag} data-markdown-from="0" data-markdown-to="${markdown.length}"><li>第一项</li><li>第二项</li></${tag}>`;
    const controller = mockMarkdownController(markdown, 29, 0);
    window.InfiniteMarkdownEditor = controller;
    api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 29, 0, 1);
    await flushRenderer();

    selectContents(root.querySelector(".document-page-content li"));
    const result = api.command("renderer", "bold");
    assert.equal(result.ok, true);
    assert.equal(controller.value(), expected);

    api.destroy("renderer");
    root.querySelector("[data-document-pages]").replaceChildren();
  }
});

test("bolds a partial selection across list items without deleting the list", async () => {
  const root = document.getElementById("renderer");
  const first = "这是一个基于 Markdown 扩展 的富文本引擎原型。";
  const second = "这是一个基于 Markdown 扩展 的富文本引擎原型。这是";
  const markdown = `- ${first}\n- ${second}`;
  root.querySelector(".document-pagination-source").innerHTML =
    `<ul data-markdown-from="0" data-markdown-to="${markdown.length}">
      <li>${first}</li>
      <li>${second}</li>
    </ul>`;
  const controller = mockMarkdownController(markdown, 32, 0);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 32, 0, 1);
  await flushRenderer();

  const items = root.querySelectorAll(".document-page-content li");
  const range = document.createRange();
  range.setStart(items[0].firstChild, first.indexOf("Markdown"));
  range.setEnd(items[1].firstChild, second.indexOf(" 的富文本"));
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  const result = api.command("renderer", "bold");

  assert.equal(result.ok, true);
  assert.equal(
    controller.value(),
    "- 这是一个基于 **Markdown 扩展 的富文本引擎原型。**\n- **这是一个基于 Markdown 扩展** 的富文本引擎原型。这是",
  );
  assert.equal(root.querySelectorAll(".document-page-content > ul > li").length, 2);
});

test("converts a WYSIWYG bullet list to numbering through Markdown", async () => {
  const root = document.getElementById("renderer");
  const markdown = "- 第一项\n- 第二项";
  root.querySelector(".document-pagination-source").innerHTML =
    `<ul data-markdown-from="0" data-markdown-to="${markdown.length}">
      <li>第一项</li>
      <li>第二项</li>
    </ul>`;
  const controller = mockMarkdownController(markdown, 34, 0);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 34, 0, 1);
  await flushRenderer();

  selectContents(root.querySelector(".document-page-content ul"));
  const result = api.command("renderer", "ordered_list");

  assert.equal(result.ok, true);
  assert.equal(controller.value(), "1. 第一项\n2. 第二项");
});

test("places typing after an inserted horizontal rule", async () => {
  const root = document.getElementById("renderer");
  const initial = "上一行";
  root.querySelector(".document-pagination-source").innerHTML =
    `<p data-markdown-from="0" data-markdown-to="${initial.length}">上一行</p>`;
  const controller = mockMarkdownController(initial, 41, 0);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", initial, 41, 0, 1);
  await flushRenderer();

  const first = root.querySelector(".document-page-content p");
  selectContents(first);
  const inserted = api.command("renderer", "horizontal_rule");
  assert.equal(inserted.ok, true);
  assert.equal(controller.value(), "上一行\n\n---\n\n&nbsp;");

  const trailing = root.querySelector(".document-page-content hr + p");
  trailing.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "insertText",
  }));
  trailing.classList.remove("wysiwyg-empty-paragraph");
  trailing.textContent = "下一行";
  selectContents(trailing);
  trailing.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
  }));

  assert.equal(controller.value(), "上一行\n\n---\n\n下一行");
});

test("persists a new empty WYSIWYG list item when switching to source mode", async () => {
  for (const { tag, initial, expected } of [
    { tag: "ul", initial: "- 第一项", expected: "- 第一项\n- &nbsp;" },
    { tag: "ol", initial: "1. 第一项", expected: "1. 第一项\n2. &nbsp;" },
  ]) {
    const root = document.getElementById("renderer");
    root.querySelector(".document-pagination-source").innerHTML =
      `<${tag} data-markdown-from="0" data-markdown-to="${initial.length}"><li>第一项</li></${tag}>`;
    const controller = mockMarkdownController(initial, 35, 0);
    window.InfiniteMarkdownEditor = controller;
    api.mount("renderer", true, {}, true, "wysiwyg-bridge", initial, 35, 0, 1);
    await flushRenderer();

    const list = root.querySelector(`.document-page-content ${tag}`);
    const first = list.querySelector("li");
    selectContents(first);
    first.dispatchEvent(new dom.window.InputEvent("beforeinput", {
      bubbles: true,
      inputType: "insertParagraph",
    }));
    const empty = document.createElement("li");
    empty.appendChild(document.createElement("br"));
    list.appendChild(empty);
    selectContents(empty);
    empty.dispatchEvent(new dom.window.InputEvent("input", {
      bubbles: true,
      inputType: "insertParagraph",
    }));

    assert.equal(controller.value(), expected);
    api.destroy("renderer");
    root.querySelector("[data-document-pages]").replaceChildren();
  }
});

test("keeps text entered after Enter as a separate list item", async () => {
  const root = document.getElementById("renderer");
  const initial = "- 第一项";
  root.querySelector(".document-pagination-source").innerHTML =
    `<ul data-markdown-from="0" data-markdown-to="${initial.length}"><li>第一项</li></ul>`;
  const controller = mockMarkdownController(initial, 36, 0);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", initial, 36, 0, 1);
  await flushRenderer();

  const list = root.querySelector(".document-page-content ul");
  const first = list.querySelector("li");
  selectContents(first);
  first.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "insertParagraph",
  }));
  const second = first.cloneNode(false);
  second.textContent = "第二项";
  list.appendChild(second);
  selectContents(second);
  second.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "insertParagraph",
  }));

  assert.equal(first.dataset.documentListItemId, second.dataset.documentListItemId);
  assert.equal(controller.value(), "- 第一项\n- 第二项");

  const caret = document.createRange();
  caret.setStart(second.firstChild, 1);
  caret.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(caret);
  assert.equal(api.command("renderer", "ordered_list").ok, true);
  assert.equal(controller.value(), "- 第一项\n1. 第二项");
});

test("WYSIWYG numbering changes only the list item containing the caret", async () => {
  const root = document.getElementById("renderer");
  const markdown = "- 第一项\n- 第二项";
  root.querySelector(".document-pagination-source").innerHTML =
    `<ul data-markdown-from="0" data-markdown-to="${markdown.length}"><li>第一项</li><li>第二项</li></ul>`;
  const controller = mockMarkdownController(markdown, 37, 0);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 37, 0, 1);
  await flushRenderer();

  const firstText = root.querySelector(".document-page-content li").firstChild;
  const range = document.createRange();
  range.setStart(firstText, 1);
  range.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  const result = api.command("renderer", "ordered_list");

  assert.equal(result.ok, true);
  assert.equal(controller.value(), "1. 第一项\n- 第二项");
});

test("numbering does not include a list item touched only by the selection endpoint", async () => {
  const root = document.getElementById("renderer");
  const markdown = "- 第一项\n- 第二项\n- 第三项";
  root.querySelector(".document-pagination-source").innerHTML =
    `<ul data-markdown-from="0" data-markdown-to="${markdown.length}"><li>第一项</li><li>第二项</li><li>第三项</li></ul>`;
  const controller = mockMarkdownController(markdown, 38, 0);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 38, 0, 1);
  await flushRenderer();

  const items = root.querySelectorAll(".document-page-content li");
  const range = document.createRange();
  range.setStart(items[0].firstChild, 0);
  range.setEnd(items[1].firstChild, 0);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  const result = api.command("renderer", "ordered_list");

  assert.equal(result.ok, true);
  assert.equal(controller.value(), "1. 第一项\n- 第二项\n- 第三项");
});

test("numbering uses the last editor selection after the toolbar takes focus", async () => {
  const root = document.getElementById("renderer");
  const markdown = "- 第一项\n- 第二项";
  root.querySelector(".document-pagination-source").innerHTML =
    `<ul data-markdown-from="0" data-markdown-to="${markdown.length}"><li>第一项</li><li>第二项</li></ul>`;
  const controller = mockMarkdownController(markdown, 39, 0);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 39, 0, 1);
  await flushRenderer();

  const secondText = root.querySelectorAll(".document-page-content li")[1].firstChild;
  const editorCaret = document.createRange();
  editorCaret.setStart(secondText, 1);
  editorCaret.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(editorCaret);
  document.dispatchEvent(new dom.window.Event("selectionchange"));

  const button = document.createElement("button");
  button.textContent = "编号";
  document.body.appendChild(button);
  selectContents(button);
  const result = api.command("renderer", "ordered_list");

  assert.equal(result.ok, true);
  assert.equal(controller.value(), "- 第一项\n1. 第二项");
});

test("preserves the rest of the document when formatting across paragraphs", async () => {
  const root = document.getElementById("renderer");
  const markdown = "Markdown 源码与 WYSIW\n\nYG 模式切换\n\nMarkdown 源码高亮（syntect）\n\n不得丢失";
  const firstEnd = "Markdown 源码与 WYSIW".length;
  const secondFrom = firstEnd + 2;
  const secondEnd = secondFrom + "YG 模式切换".length;
  root.querySelector(".document-pagination-source").innerHTML =
    `<p data-markdown-from="0" data-markdown-to="${firstEnd}">Markdown 源码与 WYSIW</p>`
    + `<p data-markdown-from="${secondFrom}" data-markdown-to="${secondEnd}">YG 模式切换</p>`
    + `<p data-markdown-from="${secondEnd + 2}" data-markdown-to="${secondEnd + 25}">Markdown 源码高亮（syntect）</p>`
    + `<p data-markdown-from="${markdown.length - 4}" data-markdown-to="${markdown.length}">不得丢失</p>`;
  const controller = mockMarkdownController(markdown, 30, 0);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 30, 0, 1);
  await flushRenderer();

  const paragraphs = root.querySelectorAll(".document-page-content p");
  const range = document.createRange();
  range.setStart(paragraphs[0].firstChild, 4);
  range.setEnd(paragraphs[1].firstChild, 2);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  assert.equal(api.command("renderer", "italic").changed, true);

  assert.equal(
    controller.value(),
    "Mark*down 源码与 WYSIW*\n\n*YG* 模式切换\n\nMarkdown 源码高亮（syntect）\n\n不得丢失",
  );
});

test("never replaces the whole document when a formatted block has no source range", async () => {
  const root = document.getElementById("renderer");
  const markdown = "第一行\n\n第二行\n\n后文必须保留";
  root.querySelector(".document-pagination-source").innerHTML =
    "<p>第一行</p><p>第二行</p><p>后文必须保留</p>";
  const controller = mockMarkdownController(markdown, 31, 0);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 31, 0, 1);
  await flushRenderer();

  const paragraphs = root.querySelectorAll(".document-page-content p");
  const range = document.createRange();
  range.setStart(paragraphs[0].firstChild, 1);
  range.setEnd(paragraphs[1].firstChild, 2);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  const result = api.command("renderer", "bold");

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(controller.value(), markdown);
});

test("routes undo and redo through the shared Markdown history", async () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML = "<p>正文</p>";
  const calls = [];
  window.InfiniteMarkdownEditor = {
    initialize() { return { ok: true }; },
    getSnapshot() {
      return { documentRevision: 1, editRevision: 1, markdown: "正文", origin: "test" };
    },
    getRevision() { return 1; },
    undo() { calls.push("undo"); return true; },
    redo() { calls.push("redo"); return true; },
  };
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", "正文", 1, 1);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  assert.equal(api.command("renderer", "undo").changed, true);
  assert.equal(api.command("renderer", "redo").changed, true);
  assert.deepEqual(calls, ["undo", "redo"]);
  delete window.InfiniteMarkdownEditor;
});

test("composes bold and strikethrough in a stable mark order", async () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="4">文字</p>';
  const controller = mockMarkdownController("文字", 4, 0);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", "文字", 4, 0, 1);
  await flushRenderer();

  const paragraph = root.querySelector(".document-page-content p");
  selectContents(paragraph);
  assert.equal(api.command("renderer", "bold").changed, true);
  assert.equal(controller.value(), "**文字**");

  selectContents(paragraph);
  assert.equal(api.command("renderer", "strike").changed, true);
  assert.equal(controller.value(), "~~**文字**~~");
  assert.equal(paragraph.innerHTML, "<del><strong>文字</strong></del>");
});

test("removes one mark from a composed selection without removing the others", async () => {
  const root = document.getElementById("renderer");
  const markdown = "~~**文字**~~";
  root.querySelector(".document-pagination-source").innerHTML =
    `<p data-markdown-from="0" data-markdown-to="${markdown.length}"><del><strong>文字</strong></del></p>`;
  const controller = mockMarkdownController(markdown, 5, 2);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", markdown, 5, 2, 1);
  await flushRenderer();

  const paragraph = root.querySelector(".document-page-content p");
  selectContents(paragraph);
  assert.equal(api.command("renderer", "strike").changed, true);
  assert.equal(controller.value(), "**文字**");
  assert.equal(paragraph.innerHTML, "<strong>文字</strong>");
});

test("escapes literal tildes instead of turning them into strikethrough", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML = "<p>~~字面量~~</p>";
  api.paginate(root, true);

  assert.equal(api.serializeMarkdown(root), "\\~\\~字面量\\~\\~");
});

test("serializes leaving a quote as a quote followed by a normal paragraph", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    "<blockquote><p>引用</p></blockquote><p>正文</p>";
  api.paginate(root, true);
  const [quote, paragraph] = root.querySelectorAll(".document-page-content > *");
  paragraph.dataset.documentBlockId = quote.dataset.documentBlockId;
  paragraph.dataset.markdownFrom = quote.dataset.markdownFrom = "0";
  paragraph.dataset.markdownTo = quote.dataset.markdownTo = "4";

  assert.equal(api.serializeMarkdown(root), "> 引用\n\n正文");
});

test("ignores an older render acknowledgement after the latest page is accepted", async () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="2">最新</p>';
  window.InfiniteMarkdownEditor = mockMarkdownController("最新", 6, 2);
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", "最新", 6, 2, 20);
  await flushRenderer();
  assert.equal(root.querySelector(".document-page-content").textContent, "最新");

  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="1">旧</p>';
  const stale = api.mount("renderer", true, {}, true, "wysiwyg-bridge", "旧", 6, 1, 19);
  await flushRenderer();

  assert.equal(stale.stale, true);
  assert.equal(root.querySelector(".document-page-content").textContent, "最新");
});

test("an undo at the beginning does not block later canonical rendering", async () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="2">正文</p>';
  window.InfiniteMarkdownEditor = {
    initialize() { return { ok: true }; },
    getSnapshot() {
      return { documentRevision: 7, editRevision: 1, markdown: "正文", origin: "test" };
    },
    getRevision() { return 1; },
    undo() { return false; },
    redo() { return false; },
  };
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", "正文", 7, 1, 1);
  await flushRenderer();
  assert.equal(api.command("renderer", "undo").changed, false);

  root.querySelector(".document-pagination-source").innerHTML =
    '<h1 data-markdown-from="0" data-markdown-to="2">正文</h1>';
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", "正文", 7, 1, 2);
  await flushRenderer();

  assert.ok(root.querySelector(".document-page-content h1"));
});

test("keeps ordinary typing in the live page when no pagination boundary changes", async () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="2">原文</p>';
  const received = [];
  const controller = mockMarkdownController("原文", 8, 1, received);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", "原文", 8, 1, 1);
  await flushRenderer();

  const paragraph = root.querySelector(".document-page-content p");
  selectContents(paragraph);
  paragraph.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "insertText",
  }));
  paragraph.textContent = "原文字";
  selectContents(paragraph);
  paragraph.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
  }));
  assert.equal(controller.value(), "原文字");
  assert.deepEqual(received[0], [{ id: "block-0", from: 2, to: 2, insert: "字" }]);

  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="3">原文字</p>';
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", "原文字", 8, 2, 2);
  await flushRenderer();

  assert.equal(paragraph.isConnected, true);
  assert.equal(root.querySelector(".document-page-content p"), paragraph);
});

test("keeps a normal Enter in the live page instead of rebuilding the document", async () => {
  const root = document.getElementById("renderer");
  const initial = "第一行";
  root.querySelector(".document-pagination-source").innerHTML =
    `<p data-markdown-from="0" data-markdown-to="${initial.length}">${initial}</p>`;
  const controller = mockMarkdownController(initial, 9, 1);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", initial, 9, 1, 1);
  await flushRenderer();

  const first = root.querySelector(".document-page-content p");
  selectContents(first);
  first.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "insertParagraph",
  }));
  const second = document.createElement("p");
  second.textContent = "第二行";
  first.after(second);
  selectContents(second);
  second.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "insertParagraph",
  }));

  const expected = "第一行\n\n第二行";
  assert.equal(controller.value(), expected);
  root.querySelector(".document-pagination-source").innerHTML =
    '<p data-markdown-from="0" data-markdown-to="3">第一行</p>'
    + '<p data-markdown-from="5" data-markdown-to="8">第二行</p>';
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", expected, 9, 2, 2);
  await flushRenderer();

  assert.equal(first.isConnected, true);
  assert.equal(second.isConnected, true);
  assert.deepEqual(
    [...root.querySelectorAll(".document-page-content > p")],
    [first, second]
  );
});

test("keeps a normal Enter inside the same Markdown quote block", async () => {
  const root = document.getElementById("renderer");
  const initial = "> 第一行";
  root.querySelector(".document-pagination-source").innerHTML =
    `<blockquote data-markdown-from="0" data-markdown-to="${initial.length}"><p>第一行</p></blockquote>`;
  const controller = mockMarkdownController(initial, 10, 1);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", initial, 10, 1, 1);
  await flushRenderer();

  const quote = root.querySelector(".document-page-content blockquote");
  const firstLine = quote.querySelector("p");
  selectContents(firstLine);
  firstLine.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "insertParagraph",
  }));
  const secondLine = document.createElement("p");
  secondLine.textContent = "第二行";
  quote.appendChild(secondLine);
  selectContents(secondLine);
  secondLine.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "insertParagraph",
  }));

  const quotes = root.querySelectorAll(".document-page-content > blockquote");
  assert.equal(quotes.length, 1);
  assert.deepEqual(
    [...quotes[0].children].map((element) => element.textContent),
    ["第一行", "第二行"]
  );
  assert.equal(controller.value(), "> 第一行\n>\n> 第二行");
});

test("exits a quote when Enter is pressed on its empty line", async () => {
  const root = document.getElementById("renderer");
  const initial = "> 第一行\n>";
  root.querySelector(".document-pagination-source").innerHTML =
    `<blockquote data-markdown-from="0" data-markdown-to="${initial.length}"><p>第一行</p><p><br></p></blockquote>`;
  const controller = mockMarkdownController(initial, 11, 1);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", initial, 11, 1, 1);
  await flushRenderer();

  const quote = root.querySelector(".document-page-content blockquote");
  const emptyLine = quote.lastElementChild;
  selectContents(emptyLine);
  emptyLine.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "insertParagraph",
  }));
  const nextLine = document.createElement("p");
  nextLine.appendChild(document.createElement("br"));
  quote.appendChild(nextLine);
  selectContents(nextLine);
  nextLine.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "insertParagraph",
  }));

  const quotes = root.querySelectorAll(".document-page-content > blockquote");
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].textContent, "第一行");
  const ordinaryLine = quotes[0].nextElementSibling;
  assert.equal(ordinaryLine.tagName, "P");
  assert.equal(controller.value(), "> 第一行\n\n&nbsp;");
});

test("coalesces bold pagination fragments before serializing Markdown", () => {
  const root = document.getElementById("renderer");
  root.querySelector("[data-document-pages]").innerHTML = `
    <article class="document-page"><div class="document-page-content">
      <p data-document-block-id="block-0" data-markdown-from="0" data-markdown-to="8"><strong>a</strong></p>
    </div></article>
    <article class="document-page"><div class="document-page-content">
      <p data-document-block-id="block-0" data-document-fragment-continuation="true" data-markdown-from="0" data-markdown-to="8"><strong>rkd</strong></p>
    </div></article>`;

  assert.equal(api.serializeMarkdown(root), "**arkd**");
});

test("preserves formatted blank lines without emitting empty Markdown marks", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    "<p><strong>a</strong></p><p><strong><br></strong></p><p><strong><br></strong></p>";
  api.paginate(root, true);

  assert.equal(api.serializeMarkdown(root), "**a**\n\n&nbsp;\n\n&nbsp;");
});

test("persists ordinary empty paragraphs with a Markdown-compatible marker", () => {
  const root = document.getElementById("renderer");
  root.querySelector(".document-pagination-source").innerHTML =
    "<p>第一行</p><p><br></p><p>第二行</p>";
  api.paginate(root, true);

  assert.equal(api.serializeMarkdown(root), "第一行\n\n&nbsp;\n\n第二行");
});

test("commits leaving a styled quote as one structural Markdown transaction", async () => {
  const root = document.getElementById("renderer");
  const initial = "> 引用";
  root.querySelector(".document-pagination-source").innerHTML =
    `<blockquote data-markdown-from="0" data-markdown-to="${initial.length}"><p>引用</p></blockquote>`;
  const controller = mockMarkdownController(initial, 9, 1);
  window.InfiniteMarkdownEditor = controller;
  api.mount("renderer", true, {}, true, "wysiwyg-bridge", initial, 9, 1, 1);
  await flushRenderer();

  const quote = root.querySelector(".document-page-content blockquote");
  selectContents(quote);
  quote.dispatchEvent(new dom.window.InputEvent("beforeinput", {
    bubbles: true,
    inputType: "insertParagraph",
  }));
  const paragraph = document.createElement("p");
  paragraph.textContent = "正文";
  quote.after(paragraph);
  selectContents(paragraph);
  paragraph.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "insertParagraph",
  }));

  assert.equal(controller.value(), "> 引用\n\n正文");
});
