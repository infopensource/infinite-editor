import { EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory,
  redo,
  undo
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput
} from "@codemirror/language";

const views = new Map();
const scrollSyncs = new Map();
const pendingScrollSyncs = new Map();
let controller = null;
const pendingClipboardImagePastes = new Map();
let clipboardPasteRequest = 0;

function clipboardMayContainImage(clipboardData) {
  const bridge = document.getElementById("clipboard-paste-bridge");
  if (bridge?.dataset.nativeClipboard !== "true") return false;
  const text = clipboardData?.getData?.("text/plain") ?? "";
  const html = clipboardData?.getData?.("text/html") ?? "";
  if (/<img[\s>]/i.test(html)) return true;
  for (let index = 0; index < Number(clipboardData?.types?.length ?? 0); index += 1) {
    const type = clipboardData.types[index] ?? clipboardData.types.item?.(index);
    if (String(type).startsWith("image/")) return true;
  }
  return text.length === 0;
}

function requestClipboardImage(onImage) {
  const bridge = document.getElementById("clipboard-paste-bridge");
  if (!bridge) return false;
  const requestId = ++clipboardPasteRequest;
  const timeout = setTimeout(() => pendingClipboardImagePastes.delete(requestId), 10000);
  pendingClipboardImagePastes.set(requestId, { onImage, timeout });
  bridge.value = JSON.stringify({ request_id: requestId });
  bridge.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function completeClipboardImagePaste(requestId, path) {
  const pending = pendingClipboardImagePastes.get(requestId);
  if (!pending) return false;
  pendingClipboardImagePastes.delete(requestId);
  clearTimeout(pending.timeout);
  pending.onImage(path);
  return true;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function interpolate(points, value, fromKey, toKey) {
  if (points.length < 2) return 0;
  const bounded = clamp(value, points[0][fromKey], points.at(-1)[fromKey]);
  let low = 0;
  let high = points.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle][fromKey] <= bounded) low = middle;
    else high = middle;
  }
  const start = points[low];
  const end = points[high];
  const distance = end[fromKey] - start[fromKey];
  if (distance <= 0) return start[toKey];
  const progress = (bounded - start[fromKey]) / distance;
  return start[toKey] + progress * (end[toKey] - start[toKey]);
}

function disconnectScrollSync(hostId) {
  const sync = scrollSyncs.get(hostId);
  if (!sync) return;
  sync.source.removeEventListener("scroll", sync.onSourceScroll);
  sync.preview.removeEventListener("scroll", sync.onPreviewScroll);
  sync.observer.disconnect();
  if (sync.frame) cancelAnimationFrame(sync.frame);
  scrollSyncs.delete(hostId);
}

function connectScrollSync(hostId, previewId) {
  const view = views.get(hostId)?.view;
  const preview = document.getElementById(previewId);
  if (!view || !preview) return { ok: false, error: "找不到源码编辑器或预览区" };

  const existing = scrollSyncs.get(hostId);
  if (existing?.preview === preview && existing.source === view.scrollDOM) {
    existing.points = null;
    return { ok: true, reused: true };
  }
  disconnectScrollSync(hostId);

  const sync = {
    source: view.scrollDOM,
    preview,
    view,
    points: null,
    frame: 0,
    ignoreSource: null,
    ignorePreview: null,
  };

  const buildPoints = () => {
    const sourceMax = Math.max(0, sync.source.scrollHeight - sync.source.clientHeight);
    const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight);
    const previewRect = preview.getBoundingClientRect();
    const points = [{ source: 0, preview: 0 }];

    for (const node of preview.querySelectorAll("[data-markdown-from]")) {
      const position = Number(node.dataset.markdownFrom);
      if (!Number.isFinite(position)) continue;
      const source = clamp(view.lineBlockAt(clamp(position, 0, view.state.doc.length)).top, 0, sourceMax);
      const targetRect = node.getBoundingClientRect();
      const target = clamp(targetRect.top - previewRect.top + preview.scrollTop, 0, previewMax);
      const previous = points.at(-1);
      if (
        source <= previous.source
        || target <= previous.preview
        || source >= sourceMax
        || target >= previewMax
      ) continue;
      points.push({ source, preview: target });
    }

    const previous = points.at(-1);
    if (sourceMax > previous.source || previewMax > previous.preview) {
      points.push({ source: sourceMax, preview: previewMax });
    }
    sync.points = points;
    return points;
  };

  const schedule = (side) => {
    if (sync.frame) return;
    sync.frame = requestAnimationFrame(() => {
      sync.frame = 0;
      const points = sync.points ?? buildPoints();
      if (side === "source") {
        const target = interpolate(points, sync.source.scrollTop, "source", "preview");
        sync.ignorePreview = target;
        preview.scrollTop = target;
      } else {
        const target = interpolate(points, preview.scrollTop, "preview", "source");
        sync.ignoreSource = target;
        sync.source.scrollTop = target;
      }
    });
  };

  sync.onSourceScroll = () => {
    if (sync.ignoreSource !== null && Math.abs(sync.source.scrollTop - sync.ignoreSource) < 2) {
      sync.ignoreSource = null;
      return;
    }
    schedule("source");
  };
  sync.onPreviewScroll = () => {
    if (sync.ignorePreview !== null && Math.abs(preview.scrollTop - sync.ignorePreview) < 2) {
      sync.ignorePreview = null;
      return;
    }
    schedule("preview");
  };
  sync.observer = typeof ResizeObserver === "undefined"
    ? { observe() {}, disconnect() {} }
    : new ResizeObserver(() => { sync.points = null; });
  sync.observer.observe(preview);
  const rendered = preview.querySelector(".markdown-rendered-html");
  if (rendered) sync.observer.observe(rendered);
  sync.source.addEventListener("scroll", sync.onSourceScroll, { passive: true });
  preview.addEventListener("scroll", sync.onPreviewScroll, { passive: true });
  scrollSyncs.set(hostId, sync);
  buildPoints();
  return { ok: true };
}

function activeBridge() {
  return controller?.bridgeId ? document.getElementById(controller.bridgeId) : null;
}

function emitChange(origin) {
  if (!controller) return;
  const markdown = controller.state.doc.toString();
  const envelope = {
    document_revision: controller.documentRevision,
    edit_revision: controller.editRevision,
    origin,
    markdown
  };
  const payload = JSON.stringify(envelope);
  const bridge = activeBridge();
  if (bridge && bridge.value !== payload) {
    bridge.value = payload;
    bridge.dispatchEvent(new Event("input", { bubbles: true }));
  }
  window.dispatchEvent(new CustomEvent("infinite-markdown-change", {
    detail: envelope
  }));
}

function extensions() {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ extensions: GFM }),
    EditorView.domEventHandlers({
      mousedown(event) {
        if (event.button !== 0 || !event.ctrlKey || event.metaKey) return false;
        event.preventDefault();
        return true;
      },
      paste(event, view) {
        if (!clipboardMayContainImage(event.clipboardData)) return false;
        event.preventDefault();
        const selection = view.state.selection.main;
        requestClipboardImage((path) => {
          if (!path || !controller) return;
          const markdown = `![粘贴的图片](${path})`;
          const transaction = controller.state.update({
            changes: { from: selection.from, to: selection.to, insert: markdown },
            selection: { anchor: selection.from + markdown.length },
            userEvent: "input.paste",
          });
          applyTransactions([transaction], "source", view);
          view.update([transaction]);
          view.focus();
        });
        return true;
      }
    }),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": { height: "100%", backgroundColor: "#f8fafc", color: "#0f172a" },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: 'Consolas, "Cascadia Mono", "JetBrains Mono", monospace',
        fontSize: "14px",
        lineHeight: "24px"
      },
      ".cm-content": { padding: "12px 0", caretColor: "#0f172a" },
      ".cm-line": { padding: "0 16px" },
      ".cm-gutters": {
        backgroundColor: "#f1f5f9",
        color: "#94a3b8",
        borderRight: "1px solid #e2e8f0"
      },
      ".cm-activeLine": { backgroundColor: "rgba(219, 234, 254, 0.35)" },
      ".cm-activeLineGutter": { backgroundColor: "#e2e8f0", color: "#475569" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "#bfdbfe"
      },
      "&.cm-focused": { outline: "none" }
    })
  ];
}

function createState(value) {
  return EditorState.create({ doc: value, extensions: extensions() });
}

function updateAttachedViews(transactions, sourceView = null) {
  for (const entry of views.values()) {
    if (entry.view === sourceView || !entry.view.dom.isConnected) continue;
    entry.view.update(transactions);
  }
}

function applyTransactions(transactions, origin = "transaction", sourceView = null) {
  if (!controller || transactions.length === 0) {
    return { changed: false, revision: controller?.editRevision ?? null };
  }
  let expected = controller.state;
  for (const transaction of transactions) {
    if (transaction.startState !== expected) {
      throw new RangeError("Markdown transaction 不是从当前文档状态创建的");
    }
    expected = transaction.state;
  }

  const changed = transactions.some((transaction) => transaction.docChanged);
  controller.state = expected;
  if (changed) {
    controller.editRevision += 1;
    controller.lastOrigin = origin;
  }
  updateAttachedViews(transactions, sourceView);
  if (changed) emitChange(origin);
  return { changed, revision: controller.editRevision };
}

function initialize(value, documentRevision, bridgeId, editRevision = 0) {
  if (controller && documentRevision < controller.documentRevision) {
    return { ok: true, reset: false, staleDocument: true };
  }

  if (!controller || controller.documentRevision < documentRevision) {
    for (const entry of views.values()) entry.view.destroy();
    views.clear();
    controller = {
      state: createState(value),
      documentRevision,
      editRevision,
      bridgeId: bridgeId ?? null,
      lastOrigin: "initialize"
    };
    return { ok: true, reset: true, revision: editRevision };
  }

  // Within one document session, the transaction state is authoritative.
  // Rust/Dioxus sends full Markdown snapshots back asynchronously; accepting a
  // mismatching snapshot here can roll the controller back and truncate its
  // undo history. Real external document replacement must increment
  // documentRevision and take the reset branch above.
  return {
    ok: true,
    reset: false,
    revision: controller.editRevision,
    ignoredSnapshot: controller.state.doc.toString() !== value
  };
}

function commandTarget(origin) {
  return {
    get state() {
      return controller.state;
    },
    dispatch(transaction) {
      applyTransactions([transaction], origin);
    }
  };
}

function historyCommand(command, origin) {
  if (!controller) return false;
  return command(commandTarget(origin));
}

function applySourceTransaction(spec) {
  if (!controller) return { ok: false, changed: false, error: "Markdown 文档控制器尚未初始化" };
  const transaction = controller.state.update({
    ...spec,
    annotations: isolateHistory.of("full")
  });
  return { ok: true, ...applyTransactions([transaction], "source-command") };
}

function toggleInlineMark(open, close = open) {
  if (!controller) return { ok: false, changed: false, error: "Markdown 文档控制器尚未初始化" };
  const { from, to } = controller.state.selection.main;
  const doc = controller.state.doc;
  const firstLine = doc.lineAt(from);
  const lastLine = doc.lineAt(to);
  if (firstLine.number !== lastLine.number) {
    const changes = [];
    let mappedFrom = null;
    let mappedTo = null;
    let delta = 0;
    for (let number = firstLine.number; number <= lastLine.number; number += 1) {
      const line = doc.line(number);
      const structuralPrefix = /^(?:\s*(?:>\s*)?)(?:(?:[-+*]|\d+[.)])\s+)?/.exec(line.text)[0].length;
      const start = Math.max(from, line.from + structuralPrefix);
      const end = Math.min(to, line.to);
      if (start >= end) continue;
      const openerFrom = start >= open.length
        && doc.sliceString(start - open.length, start) === open
          ? start - open.length
          : doc.sliceString(start, start + open.length) === open
            ? start
            : null;
      const closerFrom = doc.sliceString(end, end + close.length) === close
        ? end
        : end >= close.length && doc.sliceString(end - close.length, end) === close
          ? end - close.length
          : null;
      const surrounded = openerFrom !== null
        && closerFrom !== null
        && openerFrom + open.length <= closerFrom;
      if (surrounded) {
        const contentFromBefore = openerFrom + open.length;
        const contentToBefore = closerFrom;
        changes.push(
          { from: openerFrom, to: contentFromBefore, insert: "" },
          { from: closerFrom, to: closerFrom + close.length, insert: "" },
        );
        const contentFrom = openerFrom + delta;
        const contentTo = contentToBefore + delta - open.length;
        mappedFrom ??= contentFrom;
        mappedTo = contentTo;
        delta -= open.length + close.length;
      } else {
        changes.push({ from: start, insert: open }, { from: end, insert: close });
        const contentFrom = start + delta + open.length;
        const contentTo = end + delta + open.length;
        mappedFrom ??= contentFrom;
        mappedTo = contentTo;
        delta += open.length + close.length;
      }
    }
    return changes.length > 0
      ? applySourceTransaction({
          changes,
          // Keep the selection on the original text. CodeMirror's default
          // boundary association otherwise includes inserted delimiters, so a
          // second toolbar click sees `****text****` and keeps stacking stars.
          selection: EditorSelection.range(
            controller.state.selection.main.anchor <= controller.state.selection.main.head
              ? mappedFrom
              : mappedTo,
            controller.state.selection.main.anchor <= controller.state.selection.main.head
              ? mappedTo
              : mappedFrom,
          ),
        })
      : { ok: true, changed: false, revision: controller.editRevision };
  }
  let hasSurroundingMark = from >= open.length
    && doc.sliceString(from - open.length, from) === open
    && doc.sliceString(to, to + close.length) === close;
  if (open === "*" && hasSurroundingMark) {
    let before = 0;
    let after = 0;
    while (from - before - 1 >= 0 && doc.sliceString(from - before - 1, from - before) === "*") before += 1;
    while (to + after < doc.length && doc.sliceString(to + after, to + after + 1) === "*") after += 1;
    hasSurroundingMark = before % 2 === 1 && after % 2 === 1;
  }
  if (hasSurroundingMark) {
    return applySourceTransaction({
      changes: [
        { from: from - open.length, to: from, insert: "" },
        { from: to, to: to + close.length, insert: "" }
      ],
      selection: EditorSelection.range(from - open.length, to - open.length)
    });
  }
  return applySourceTransaction({
    changes: [
      { from, insert: open },
      { from: to, insert: close }
    ],
    selection: EditorSelection.range(from + open.length, to + open.length)
  });
}

function selectedLines() {
  const selection = controller.state.selection.main;
  const first = controller.state.doc.lineAt(selection.from);
  let last = controller.state.doc.lineAt(selection.to);
  if (!selection.empty && selection.to === last.from && last.number > first.number) {
    last = controller.state.doc.line(last.number - 1);
  }
  const lines = [];
  for (let number = first.number; number <= last.number; number += 1) {
    lines.push(controller.state.doc.line(number));
  }
  return lines;
}

function toggleLinePrefix(kind) {
  if (!controller) return { ok: false, changed: false, error: "Markdown 文档控制器尚未初始化" };
  const lines = selectedLines();
  const patterns = {
    quote: /^(\s*)>\s?/,
    unordered_list: /^(\s*)[-+*]\s+/,
    ordered_list: /^(\s*)\d+[.)]\s+/,
  };
  const prefixes = { quote: "> ", unordered_list: "- ", ordered_list: "1. " };
  const pattern = patterns[kind];
  const anyListPattern = /^(\s*)(?:(?:[-+*])|(?:\d+[.)]))\s+/;
  const remove = lines.filter((line) => line.text.trim()).every((line) => pattern.test(line.text));
  const changes = lines.map((line, index) => {
    if (!remove) {
      const prefix = kind === "ordered_list" ? `${index + 1}. ` : prefixes[kind];
      const existing = kind === "quote" ? null : anyListPattern.exec(line.text);
      return existing
        ? {
            from: line.from + existing[1].length,
            to: line.from + existing[0].length,
            insert: prefix,
          }
        : { from: line.from, insert: prefix };
    }
    const match = pattern.exec(line.text);
    return match
      ? { from: line.from + match[1].length, to: line.from + match[0].length, insert: "" }
      : { from: line.from, to: line.from, insert: "" };
  });
  return applySourceTransaction({ changes });
}

function sourceCommand(name) {
  if (name === "undo" || name === "redo") {
    const changed = historyCommand(name === "undo" ? undo : redo, name);
    return { ok: true, changed, revision: controller?.editRevision ?? null };
  }
  if (name === "bold") return toggleInlineMark("**");
  if (name === "italic") return toggleInlineMark("*");
  if (name === "strike") return toggleInlineMark("~~");
  if (name === "quote" || name === "unordered_list" || name === "ordered_list") {
    return toggleLinePrefix(name);
  }
  return { ok: false, changed: false, error: `源码模式暂不支持命令：${name}` };
}

function transactionSpec(changes, userEvent, isolate) {
  return {
    changes,
    ...(userEvent ? { userEvent } : {}),
    ...(isolate ? { annotations: isolateHistory.of("full") } : {})
  };
}

window.InfiniteMarkdownEditor = {
  initialize,
  clipboardMayContainImage,
  requestClipboardImage,
  completeClipboardImagePaste,

  mount(hostId, bridgeId, initialValue, documentRevision) {
    const host = document.getElementById(hostId);
    const bridge = document.getElementById(bridgeId);
    if (!host || !bridge) {
      return { ok: false, error: "找不到 Markdown 编辑器挂载节点" };
    }

    try {
      const initialized = initialize(initialValue, documentRevision, bridgeId);
      if (initialized.staleDocument) return initialized;
      const existing = views.get(hostId);
      if (existing?.view.dom.isConnected) {
        const previewId = pendingScrollSyncs.get(hostId);
        if (previewId) connectScrollSync(hostId, previewId);
        return { ok: true };
      }
      if (existing) {
        existing.view.destroy();
        views.delete(hostId);
      }

      const view = new EditorView({
        state: controller.state,
        parent: host,
        dispatchTransactions(transactions, sourceView) {
          applyTransactions(transactions, "source", sourceView);
          sourceView.update(transactions);
        }
      });
      views.set(hostId, { view });
      const previewId = pendingScrollSyncs.get(hostId);
      if (previewId) connectScrollSync(hostId, previewId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },

  setValue(hostId, value, documentRevision) {
    try {
      return initialize(value, documentRevision, controller?.bridgeId ?? null);
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },

  replaceAll(value, origin = "wysiwyg-input", userEvent = "input.type", isolate = false) {
    if (!controller) return { ok: false, error: "Markdown 文档控制器尚未初始化" };
    if (controller.state.doc.toString() === value) {
      return { ok: true, changed: false, revision: controller.editRevision };
    }
    const transaction = controller.state.update(transactionSpec(
      { from: 0, to: controller.state.doc.length, insert: value },
      userEvent,
      isolate || origin === "wysiwyg-command"
    ));
    return { ok: true, ...applyTransactions([transaction], origin) };
  },

  applyChange(
    from,
    to,
    insert,
    origin = "wysiwyg-input",
    userEvent = "input.type",
    isolate = false
  ) {
    if (!controller) return { ok: false, error: "Markdown 文档控制器尚未初始化" };
    if (from < 0 || to < from || to > controller.state.doc.length) {
      return { ok: false, error: "Markdown 修改范围无效" };
    }
    if (from === to && insert.length === 0) {
      return { ok: true, changed: false, revision: controller.editRevision };
    }
    const transaction = controller.state.update({
      ...transactionSpec(
        { from, to, insert },
        userEvent,
        isolate || origin === "wysiwyg-command"
      ),
      selection: { anchor: from + insert.length },
    });
    return { ok: true, ...applyTransactions([transaction], origin) };
  },

  applyEdits(
    edits,
    origin = "wysiwyg-input",
    userEvent = "input.type",
    isolate = false
  ) {
    if (!controller) return { ok: false, error: "Markdown 文档控制器尚未初始化" };
    const changes = [...edits]
      .map(({ from, to, insert }) => ({ from, to, insert }))
      .sort((left, right) => left.from - right.from);
    if (changes.some((change, index) =>
      change.from < 0
      || change.to < change.from
      || change.to > controller.state.doc.length
      || (index > 0 && changes[index - 1].to > change.from)
    )) {
      return { ok: false, error: "Markdown 修改范围无效或相互重叠" };
    }
    if (changes.every((change) => change.from === change.to && change.insert.length === 0)) {
      return { ok: true, changed: false, revision: controller.editRevision };
    }
    const transaction = controller.state.update(transactionSpec(
      changes,
      userEvent,
      isolate || origin === "wysiwyg-command"
    ));
    return { ok: true, ...applyTransactions([transaction], origin) };
  },

  insertText(hostId, value) {
    const view = views.get(hostId)?.view;
    const range = view?.state.selection.main ?? controller?.state.selection.main;
    if (!controller || !range) return { ok: false, error: "Markdown 编辑器尚未初始化" };
    const transaction = controller.state.update({
      changes: { from: range.from, to: range.to, insert: value },
      selection: { anchor: range.from + value.length },
      userEvent: "input.type"
    });
    applyTransactions([transaction], "source");
    return { ok: true, revision: controller.editRevision };
  },

  undo() {
    return historyCommand(undo, "undo");
  },

  redo() {
    return historyCommand(redo, "redo");
  },

  command(name) {
    return sourceCommand(name);
  },

  setSelection(hostId, anchor, head = anchor) {
    const view = views.get(hostId);
    if (!view) return { ok: false, error: "Markdown 编辑器尚未挂载" };
    view.view.dispatch({ selection: EditorSelection.range(anchor, head) });
    return { ok: true };
  },

  syncPreview(hostId, previewId) {
    pendingScrollSyncs.set(hostId, previewId);
    return connectScrollSync(hostId, previewId);
  },

  getValue() {
    return controller?.state.doc.toString() ?? null;
  },

  getRevision() {
    return controller?.editRevision ?? null;
  },

  getSnapshot() {
    if (!controller) return null;
    return {
      documentRevision: controller.documentRevision,
      editRevision: controller.editRevision,
      origin: controller.lastOrigin,
      markdown: controller.state.doc.toString()
    };
  },

  destroy(hostId) {
    disconnectScrollSync(hostId);
    const entry = views.get(hostId);
    if (entry) entry.view.destroy();
    views.delete(hostId);
    pendingScrollSyncs.delete(hostId);
    controller = null;
    return { ok: true };
  }
};

window.dispatchEvent(new CustomEvent("infinite-markdown-editor-ready"));
