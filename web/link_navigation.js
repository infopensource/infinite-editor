import { validateLinkHref } from "./link_dialog.js";

const installation = Symbol.for("infinite-editor.link-navigation");
const surfaces = ".ProseMirror, .markdown-rendered-html, [data-document-pages]";

// One delegated controller survives pagination/preview swaps and is shared by
// both bundles. Never decorate the anchor itself: ProseMirror owns its attrs,
// including the author's title, which must not become a tooltip in Markdown.
export function installDocumentLinkNavigation(target = window) {
  if (target[installation]) return target[installation];
  const doc = target.document;
  const mac = /Mac|iPhone|iPad/u.test(target.navigator.platform);
  let anchor = null;
  let tooltip = null;
  let timer = null;
  const modified = event => !event.altKey && (event.ctrlKey || (mac && event.metaKey));
  const linkAt = node => {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const link = element?.closest?.("a[href]");
    return link?.closest(surfaces) ? link : null;
  };
  const hide = () => {
    target.clearTimeout(timer);
    timer = null;
    tooltip?.remove();
    tooltip = null;
    anchor = null;
  };
  const setModifier = event => doc.documentElement.classList.toggle("infinite-link-open-modifier", !!modified(event));
  const show = () => {
    timer = null;
    if (!anchor?.isConnected || doc.querySelector(".infinite-link-overlay")) return;
    tooltip = doc.createElement("div");
    tooltip.className = "infinite-link-tooltip";
    tooltip.setAttribute("role", "tooltip");
    const address = doc.createElement("div");
    address.className = "infinite-link-tooltip-address";
    address.textContent = anchor.getAttribute("href");
    const hint = doc.createElement("div");
    hint.className = "infinite-link-tooltip-hint";
    const key = doc.createElement("kbd");
    key.textContent = mac ? "Ctrl / ⌘" : "Ctrl";
    hint.append(key, doc.createTextNode(" + 单击打开链接"));
    tooltip.append(address, hint);
    tooltip.style.visibility = "hidden";
    (anchor.closest(".word-shell") ?? doc.body).append(tooltip);
    const bounds = anchor.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const left = Math.max(12, Math.min(bounds.left, target.innerWidth - box.width - 12));
    const below = bounds.bottom + 8;
    const top = below + box.height <= target.innerHeight - 12 ? below : bounds.top - box.height - 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(12, Math.min(top, target.innerHeight - box.height - 12))}px`;
    tooltip.style.visibility = "visible";
  };
  const hover = event => {
    setModifier(event);
    const next = event.buttons ? null : linkAt(event.target);
    if (next === anchor) return;
    hide();
    anchor = next;
    if (anchor) timer = target.setTimeout(show, 300);
  };
  const leave = event => {
    if (anchor && !anchor.contains(event.relatedTarget)) hide();
  };
  const open = link => {
    const href = link.getAttribute("href")?.trim() ?? "";
    if (validateLinkHref(href)) return;
    if (href.startsWith("#")) {
      let id;
      try { id = decodeURIComponent(href.slice(1)); } catch { return; }
      const destination = id ? doc.getElementById(id) ?? doc.getElementsByName(id)[0] : link.closest(surfaces);
      destination?.scrollIntoView({ block: "start" });
      return;
    }
    // Dioxus desktop's normal anchor handler uses this same browser_open IPC.
    // window.open alone cannot open the system browser in every WebView.
    const interpreter = target.interpreter;
    if (interpreter?.intercept_link_redirects && !interpreter.liveview && typeof interpreter.sendIpcMessage === "function") {
      interpreter.sendIpcMessage("browser_open", { href });
    } else {
      target.open(link.href, "_blank", "noopener,noreferrer");
    }
  };
  const mousedown = event => {
    const link = linkAt(event.target);
    hide();
    // Keep Ctrl-click from changing the editor selection or selecting an atom.
    if (link && event.button === 0 && modified(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const click = event => {
    const link = linkAt(event.target);
    if (!link) return;
    // Also stop Dioxus desktop's ancestor listener, which opens anchors even
    // when another handler has already called preventDefault.
    event.preventDefault();
    event.stopPropagation();
    hide();
    if (event.button === 0 && modified(event)) open(link);
  };
  const doubleClick = event => {
    if (linkAt(event.target) && modified(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const keydown = event => {
    setModifier(event);
    const link = linkAt(event.target);
    if (link && event.key === "Enter" && !event.isComposing && modified(event)) {
      event.preventDefault();
      event.stopPropagation();
      hide();
      open(link);
    } else if (!["Control", "Meta"].includes(event.key)) hide();
  };
  const blur = () => { hide(); doc.documentElement.classList.remove("infinite-link-open-modifier"); };
  const listeners = [
    ["mouseover", hover], ["mousemove", hover], ["mouseout", leave],
    ["mousedown", mousedown], ["click", click], ["auxclick", click], ["dblclick", doubleClick],
    ["keydown", keydown], ["keyup", setModifier], ["scroll", hide], ["dragstart", hide],
  ];
  for (const [type, handler] of listeners) doc.addEventListener(type, handler, true);
  target.addEventListener("resize", hide);
  target.addEventListener("blur", blur);
  const controller = {
    hide,
    destroy() {
      blur();
      for (const [type, handler] of listeners) doc.removeEventListener(type, handler, true);
      target.removeEventListener("resize", hide);
      target.removeEventListener("blur", blur);
      delete target[installation];
    },
  };
  target[installation] = controller;
  return controller;
}
