// Shared by the source and rich-text surfaces. Keep editor transactions in the
// callers so opening/cancelling this form never changes the document or history.
export function validateLinkHref(value) {
  const href = value.trim();
  if (!href) return "请输入链接地址";
  if (/[\u0000-\u0020\u007f]/u.test(href)) return "地址中不能包含空格或控制字符，请使用 %20 表示空格";
  const scheme = /^([a-z][a-z\d+.-]*):/iu.exec(href)?.[1].toLowerCase();
  if (scheme && !["http", "https", "mailto", "tel"].includes(scheme)) {
    return "支持 http、https、mailto、tel，以及相对路径和 #书签";
  }
  if (scheme === "http" || scheme === "https") {
    try {
      if (!/^https?:\/\//iu.test(href) || !new URL(href).hostname) return "请输入完整的网址，例如 https://example.com";
    } catch {
      return "请输入有效的网址，例如 https://example.com";
    }
  }
  return "";
}

export function openLinkDialog({
  ownerDocument = document, text = "", href = "", hasLink = false,
  textEditable = true, sourceMode = false, onSave, onRemove, onClose,
}) {
  const doc = ownerDocument;
  // Both bundles may be loaded at once; the DOM owns the single active dialog.
  doc.querySelector(".infinite-link-overlay")?.dispatchEvent(new doc.defaultView.Event("link-dialog-close"));
  const create = (tag, className, content) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const button = (className, label) => {
    const node = create("button", className, label);
    node.type = "button";
    return node;
  };
  const overlay = create("div", "infinite-link-overlay");
  const form = create("form", "infinite-link-dialog");
  form.noValidate = true;
  form.setAttribute("role", "dialog");
  form.setAttribute("aria-modal", "true");
  form.setAttribute("aria-labelledby", "infinite-link-title");
  form.setAttribute("aria-describedby", "infinite-link-description");
  const header = create("header", "infinite-link-header");
  const icon = create("span", "infinite-link-icon");
  icon.setAttribute("aria-hidden", "true");
  // Static SVG only. User-supplied text and addresses always use textContent.
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7 .4l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.4l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
  const heading = create("div", "infinite-link-heading");
  const title = create("h2", "", hasLink ? "编辑超链接" : "添加超链接");
  title.id = "infinite-link-title";
  const description = create("p", "", "为文字添加跳转地址，移除链接时保留文字。");
  description.id = "infinite-link-description";
  heading.append(title, description);
  const dismiss = button("infinite-link-dismiss", "×");
  dismiss.setAttribute("aria-label", "关闭链接编辑器");
  header.append(icon, heading, dismiss);

  const body = create("div", "infinite-link-body");
  const textLabel = create("label", "infinite-link-label", sourceMode ? "显示文字（Markdown）" : "显示文字");
  textLabel.htmlFor = "infinite-link-text";
  const textInput = create("textarea", "infinite-link-input infinite-link-text");
  textInput.id = "infinite-link-text";
  textInput.rows = 2;
  textInput.value = text;
  textInput.placeholder = "留空时使用链接地址作为显示文字";
  textInput.readOnly = !textEditable;
  const addressLabel = create("label", "infinite-link-label", "链接地址");
  addressLabel.htmlFor = "infinite-link-href";
  const address = create("input", "infinite-link-input");
  address.id = "infinite-link-href";
  address.type = "text";
  address.value = href;
  address.placeholder = "https://example.com";
  address.autocomplete = "off";
  address.spellcheck = false;
  address.setAttribute("aria-describedby", "infinite-link-hint infinite-link-error");
  const hint = create("p", "infinite-link-hint", textEditable
    ? "支持网页、邮箱、电话、相对路径及文档内 #书签。"
    : "当前选区包含段落或非文字内容，将保留原有内容与格式。");
  hint.id = "infinite-link-hint";
  const error = create("p", "infinite-link-error");
  error.id = "infinite-link-error";
  error.setAttribute("role", "alert");
  body.append(textLabel, textInput, addressLabel, address, hint, error);

  const footer = create("footer", "infinite-link-footer");
  const remove = button("infinite-link-button remove", "移除链接");
  remove.hidden = !hasLink;
  const actions = create("div", "infinite-link-actions");
  const cancel = button("infinite-link-button", "取消");
  const save = button("infinite-link-button primary", hasLink ? "保存修改" : "添加链接");
  save.type = "submit";
  actions.append(cancel, save);
  footer.append(remove, actions);
  form.append(header, body, footer);
  overlay.append(form);

  let closed = false;
  let attempted = false;
  const close = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("focusin", containFocus);
    overlay.remove();
    if (restoreFocus) onClose?.();
  };
  const containFocus = (event) => {
    if (!closed && !form.contains(event.target)) address.focus();
  };
  const update = () => {
    const textError = sourceMode && /\n\s*\n/u.test(textInput.value)
      ? "显示文字不能包含空行，请分别为各段文字添加链接。" : "";
    const addressError = validateLinkHref(address.value);
    const message = addressError || textError;
    save.disabled = !!message;
    error.textContent = attempted ? message : "";
    address.setAttribute("aria-invalid", String(attempted && !!addressError));
    textInput.setAttribute("aria-invalid", String(attempted && !!textError));
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    attempted = true;
    update();
    if (save.disabled) { address.focus(); return; }
    const result = onSave({ text: textInput.value, href: address.value.trim() });
    if (result === false) {
      error.textContent = "文档已发生变化，请关闭后重新选择文字。";
      return;
    }
    close();
  });
  remove.addEventListener("click", () => { onRemove?.(); close(); });
  dismiss.addEventListener("click", () => close());
  cancel.addEventListener("click", () => close());
  overlay.addEventListener("mousedown", event => { if (event.target === overlay) close(); });
  overlay.addEventListener("link-dialog-close", () => close());
  overlay.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Enter" && !event.isComposing && (event.target === address || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
    if (event.key === "Tab") {
      const controls = [...form.querySelectorAll("button, input, textarea")].filter(node => !node.disabled && !node.hidden);
      const index = controls.indexOf(doc.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && (index === controls.length - 1 || index < 0)) { event.preventDefault(); controls[0].focus(); }
    }
  });
  address.addEventListener("input", () => { attempted = true; update(); });
  textInput.addEventListener("input", update);
  doc.addEventListener("focusin", containFocus);
  (doc.querySelector(".word-shell") ?? doc.body).append(overlay);
  update();
  address.focus();
  address.select();
  return { close };
}
