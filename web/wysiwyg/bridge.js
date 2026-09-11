import { findTextMatches, searchIndex } from "../text_search.js";
import { TextSelection } from "prosemirror-state";
import { installDocumentZoom } from '../document_zoom.js';

if (typeof window !== 'undefined') installDocumentZoom(window);

import {
  WYSIWYG_BRIDGE_VERSION,
  WysiwygBridgeSession,
} from "./bridge/session.js";

export { WYSIWYG_BRIDGE_VERSION, WysiwygBridgeSession };

export function installWysiwygBridge(target = window) {
  const sessions = new Map();
  target.InfiniteWysiwygEditor = Object.freeze({
    version: WYSIWYG_BRIDGE_VERSION,
    mount(config) {
      const host = document.getElementById(config.host_id);
      const bridge = document.getElementById(config.bridge_id);
      const pageStatusBridge = document.getElementById(config.page_status_bridge_id);
      const selectionStatusBridge = document.getElementById(config.selection_status_bridge_id);
      if (!host || !bridge) return { ok: false, error: "找不到 WYSIWYG 挂载点或消息桥" };
      sessions.get(config.host_id)?.destroy();
      try {
        sessions.set(config.host_id, new WysiwygBridgeSession({
          host,
          bridge,
          onPageChange: pageStatusBridge ? (status) => {
            const value = JSON.stringify(status);
            if (pageStatusBridge.value === value) return;
            pageStatusBridge.value = value;
            pageStatusBridge.dispatchEvent(new Event("input", { bubbles: true }));
          } : null,
          onSelectionChange: selectionStatusBridge ? (status) => {
            const value = JSON.stringify(status);
            if (selectionStatusBridge.value === value) return;
            selectionStatusBridge.value = value;
            selectionStatusBridge.dispatchEvent(new Event("input", { bubbles: true }));
          } : null,
          ast: config.ast,
          markdown: config.markdown,
          documentRevision: config.document_revision,
          editRevision: config.edit_revision,
          resources: config.resources,
        }));
        return { ok: true, bridge_version: WYSIWYG_BRIDGE_VERSION };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    setDocument(hostId, update) {
      return sessions.get(hostId)?.setDocument(update)
        ?? { ok: false, error: "WYSIWYG 会话不存在" };
    },
    navigateHeading(hostId, index) {
      const editor = sessions.get(hostId)?.editor;
      if (!editor || editor.compositionActive || editor.view.composing) return false;
      let ordinal = 0;
      let target = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && ordinal++ === index) target = pos + 1;
      });
      if (target === null) return false;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)).scrollIntoView());
      editor.focus();
      return true;
    },
    search(hostId, query, requested = 0) {
      const editor = sessions.get(hostId)?.editor;
      if (!editor || editor.compositionActive || editor.view.composing) return { index: -1, total: 0 };
      const matches = [];
      editor.state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return;
        matches.push(...findTextMatches(node.textBetween(0, node.content.size, '', '\ufffc'), query, pos + 1));
        return false;
      });
      const index = searchIndex(requested, matches.length);
      const match = matches[index];
      if (match) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).scrollIntoView());
      return { index, total: matches.length };
    },
    replaceMatches(hostId, query, replacement, requested = 0, all = false) {
      const session = sessions.get(hostId);
      const editor = session?.editor;
      if (!editor || editor.compositionActive || editor.view.composing) return { count: 0, deferred: true };
      session.flushChange("wysiwyg-before-command");
      const matches = [];
      editor.state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return;
        matches.push(...findTextMatches(node.textBetween(0, node.content.size, '', '\ufffc'), query, pos + 1));
        return false;
      });
      const selected = all ? matches : matches.slice(searchIndex(requested, matches.length), searchIndex(requested, matches.length) + 1);
      if (!selected.length) return { count: 0 };
      let tr = editor.state.tr;
      // Work backwards so earlier offsets remain valid. One transaction = one undo step.
      for (const match of [...selected].reverse()) tr = tr.insertText(replacement, match.from, match.to);
      editor.view.dispatch(tr);
      session.flushChange("wysiwyg-command", "input", true);
      return { count: selected.length };
    },
    command(hostId, name) {
      return sessions.get(hostId)?.command(name)
        ?? { ok: false, changed: false, error: "WYSIWYG 会话不存在" };
    },
    setResources(hostId, resources) {
      return sessions.get(hostId)?.setResources(resources)
        ?? { ok: false, error: "WYSIWYG 会话不存在" };
    },
    prepareModeSwitch(hostId) {
      return sessions.get(hostId)?.prepareModeSwitch()
        ?? { ok: false, error: "WYSIWYG 会话不存在" };
    },
    destroy(hostId) {
      const session = sessions.get(hostId);
      if (!session) return { ok: true, destroyed: false };
      sessions.delete(hostId);
      return session.destroy();
    },
  });
  target.dispatchEvent?.(new CustomEvent("infinite-wysiwyg-editor-ready"));
  return target.InfiniteWysiwygEditor;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installWysiwygBridge(window);
}
