const mathSnippets = [
  { label: "分数", template: "\\frac{}{}", selection: [6, 6], title: "插入分数" },
  { label: "上标", template: "^{}", selection: [2, 2], title: "插入上标" },
  { label: "下标", template: "_{}", selection: [2, 2], title: "插入下标" },
  { label: "根号", template: "\\sqrt{}", selection: [6, 6], title: "插入根号" },
  { label: "求和", template: "\\sum_{}^{}", selection: [6, 6], title: "插入求和符号" },
  { label: "积分", template: "\\int_{}^{}", selection: [6, 6], title: "插入积分符号" },
  { label: "括号", template: "\\left(  \\right)", selection: [7, 7], title: "插入自适应括号" },
  {
    label: "矩阵",
    template: "\\begin{bmatrix}\n  &  \\\\\n  &  \n\\end{bmatrix}",
    selection: [16, 16],
    title: "插入 2 × 2 矩阵",
  },
];

let activeMathEditor = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderMath(dom, value, displayMode) {
  dom.textContent = displayMode ? `$$\n${value}\n$$` : `$${value}$`;
  const render = () => window.InfiniteMathRenderer?.renderInto?.(dom, value, displayMode);
  if (window.InfiniteMathRenderer?.renderInto) render();
  else window.addEventListener("infinite-math-renderer-ready", render, { once: true });
}

export function openMathEditor({ value, displayMode, onSave, onClose }) {
  activeMathEditor?.close();

  const overlay = element("div", "infinite-math-editor-overlay");
  const dialog = element("section", "infinite-math-editor");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "infinite-math-editor-title");

  const header = element("header", "infinite-math-editor-header");
  const heading = element("div", "infinite-math-editor-heading");
  const titleRow = element("div", "infinite-math-editor-title-row");
  const title = element("h2", "infinite-math-editor-title", "编辑 LaTeX 公式");
  title.id = "infinite-math-editor-title";
  const type = element(
    "span",
    "infinite-math-editor-type",
    displayMode ? "独立公式" : "行内公式",
  );
  titleRow.append(title, type);
  heading.append(titleRow, element("p", "infinite-math-editor-subtitle", "输入源码时会自动更新下方效果"));
  const closeButton = element("button", "infinite-math-editor-close", "×");
  closeButton.type = "button";
  closeButton.title = "关闭";
  closeButton.setAttribute("aria-label", "关闭公式编辑器");
  header.append(heading, closeButton);

  const body = element("div", "infinite-math-editor-body");
  const editorLabel = element("label", "infinite-math-editor-label", "LaTeX 源码");
  editorLabel.htmlFor = "infinite-math-editor-input";
  const textarea = element("textarea", "infinite-math-editor-input");
  textarea.id = "infinite-math-editor-input";
  textarea.value = value;
  textarea.rows = displayMode ? 5 : 3;
  textarea.spellcheck = false;
  textarea.autocomplete = "off";
  textarea.placeholder = String.raw`例如：\frac{a}{b} + \sqrt{x}`;
  textarea.setAttribute("aria-describedby", "infinite-math-editor-hint infinite-math-editor-error");

  const toolbar = element("div", "infinite-math-editor-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "常用 LaTeX 语法");
  for (const snippet of mathSnippets) {
    const button = element("button", "infinite-math-editor-snippet", snippet.label);
    button.type = "button";
    button.title = snippet.title;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.setRangeText(snippet.template, start, end, "end");
      textarea.setSelectionRange(start + snippet.selection[0], start + snippet.selection[1]);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
    });
    toolbar.append(button);
  }

  const previewHeader = element("div", "infinite-math-editor-preview-header");
  previewHeader.append(
    element("span", "infinite-math-editor-label", "实时预览"),
    element("span", "infinite-math-editor-preview-state", "已同步"),
  );
  const preview = element("div", "infinite-math-editor-preview");
  const previewContent = element("div", "infinite-math-editor-preview-content");
  preview.append(previewContent);
  const error = element("div", "infinite-math-editor-error");
  error.id = "infinite-math-editor-error";
  error.setAttribute("role", "status");
  const hint = element(
    "div",
    "infinite-math-editor-hint",
    "Tab 插入缩进 · Ctrl/⌘ + Enter 保存 · Esc 取消",
  );
  hint.id = "infinite-math-editor-hint";
  body.append(editorLabel, textarea, toolbar, previewHeader, preview, error, hint);

  const footer = element("footer", "infinite-math-editor-footer");
  const cancelButton = element("button", "infinite-math-editor-button", "取消");
  cancelButton.type = "button";
  const saveButton = element("button", "infinite-math-editor-button primary", "应用公式");
  saveButton.type = "button";
  footer.append(cancelButton, saveButton);
  dialog.append(header, body, footer);
  overlay.append(dialog);

  let closed = false;
  const close = (saved = false) => {
    if (closed) return;
    closed = true;
    overlay.remove();
    if (activeMathEditor?.overlay === overlay) activeMathEditor = null;
    if (!saved) onClose?.();
  };
  const save = () => {
    if (saveButton.disabled) return;
    const nextValue = textarea.value;
    close(true);
    onSave(nextValue);
  };
  const updatePreview = () => {
    const source = textarea.value;
    previewContent.replaceChildren();
    error.textContent = "";
    preview.classList.remove("invalid");
    if (!source.trim()) {
      previewContent.append(element("span", "infinite-math-editor-empty", "公式预览会显示在这里"));
      saveButton.disabled = false;
      return;
    }
    const renderer = window.InfiniteMathRenderer?.renderInto;
    if (!renderer) {
      previewContent.textContent = displayMode ? `$$\n${source}\n$$` : `$${source}$`;
      return;
    }
    const result = renderer(previewContent, source, displayMode, true);
    saveButton.disabled = !result?.ok;
    if (!result?.ok) {
      preview.classList.add("invalid");
      previewContent.append(element("span", "infinite-math-editor-empty", "暂时无法预览"));
      error.textContent = String(result?.error ?? "LaTeX 语法有误").replace(/^KaTeX parse error:\s*/u, "");
    }
  };

  closeButton.addEventListener("click", () => close());
  cancelButton.addEventListener("click", () => close());
  saveButton.addEventListener("click", save);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  dialog.addEventListener("mousedown", (event) => event.stopPropagation());
  textarea.addEventListener("input", updatePreview);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = textarea.selectionStart;
      textarea.setRangeText("  ", start, textarea.selectionEnd, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  });

  document.body.append(overlay);
  activeMathEditor = { overlay, close };
  updatePreview();
  window.addEventListener("infinite-math-renderer-ready", updatePreview, { once: true });
  textarea.focus();
  textarea.select();
}
