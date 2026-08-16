import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";

const editors = new Map();

function emitChange(bridge, value) {
  bridge.value = value;
  bridge.dispatchEvent(new Event("input", { bubbles: true }));
}

function editorState(value, bridge) {
  return EditorState.create({
    doc: value,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      markdown(),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) emitChange(bridge, update.state.doc.toString());
      }),
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
    ]
  });
}

window.InfiniteMarkdownEditor = {
  mount(hostId, bridgeId, initialValue, documentRevision) {
    const existing = editors.get(hostId);
    if (existing?.view.dom.isConnected) {
      return { ok: true };
    }
    if (existing) {
      existing.view.destroy();
      editors.delete(hostId);
    }

    const host = document.getElementById(hostId);
    const bridge = document.getElementById(bridgeId);
    if (!host || !bridge) {
      return { ok: false, error: "找不到 Markdown 编辑器挂载节点" };
    }

    try {
      const state = editorState(initialValue, bridge);
      const view = new EditorView({ state, parent: host });
      editors.set(hostId, { view, bridge, documentRevision });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },

  setValue(hostId, value, documentRevision) {
    const editor = editors.get(hostId);
    if (!editor) return { ok: false, error: "Markdown 编辑器尚未初始化" };

    try {
      if (editor.documentRevision !== documentRevision) {
        editor.view.setState(editorState(value, editor.bridge));
        editor.documentRevision = documentRevision;
      } else if (editor.view.state.doc.toString() !== value) {
        editor.view.dispatch({
          changes: { from: 0, to: editor.view.state.doc.length, insert: value },
          annotations: Transaction.addToHistory.of(false)
        });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },

  insertText(hostId, value) {
    const editor = editors.get(hostId);
    if (!editor) return { ok: false, error: "Markdown 编辑器尚未初始化" };
    const range = editor.view.state.selection.main;
    editor.view.dispatch({
      changes: { from: range.from, to: range.to, insert: value },
      selection: { anchor: range.from + value.length }
    });
    return { ok: true };
  },

  undo(hostId) {
    const editor = editors.get(hostId);
    return editor ? undo(editor.view) : false;
  },

  getValue(hostId) {
    return editors.get(hostId)?.view.state.doc.toString() ?? null;
  },

  destroy(hostId) {
    const editor = editors.get(hostId);
    if (!editor) return { ok: true };
    editor.view.destroy();
    editors.delete(hostId);
    return { ok: true };
  }
};

window.dispatchEvent(new CustomEvent("infinite-markdown-editor-ready"));
