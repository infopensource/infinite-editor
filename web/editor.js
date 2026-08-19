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
let controller = null;

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
    for (let number = firstLine.number; number <= lastLine.number; number += 1) {
      const line = doc.line(number);
      const structuralPrefix = /^(?:\s*(?:>\s*)?)(?:(?:[-+*]|\d+[.)])\s+)?/.exec(line.text)[0].length;
      const start = Math.max(from, line.from + structuralPrefix);
      const end = Math.min(to, line.to);
      if (start >= end) continue;
      const surrounded = start >= open.length
        && doc.sliceString(start - open.length, start) === open
        && doc.sliceString(end, end + close.length) === close;
      if (surrounded) {
        changes.push(
          { from: start - open.length, to: start, insert: "" },
          { from: end, to: end + close.length, insert: "" },
        );
      } else {
        changes.push({ from: start, insert: open }, { from: end, insert: close });
      }
    }
    return changes.length > 0
      ? applySourceTransaction({ changes })
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
      if (existing?.view.dom.isConnected) return { ok: true };
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
    const entry = views.get(hostId);
    if (entry) entry.view.destroy();
    views.delete(hostId);
    controller = null;
    return { ok: true };
  }
};

window.dispatchEvent(new CustomEvent("infinite-markdown-editor-ready"));
