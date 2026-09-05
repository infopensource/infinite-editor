import { toolbarCommands } from "../commands/toolbar.js";
import { MinimalWysiwygEditor, wysiwygSchema } from "../editor.js";
import { remarkReferenceBackend } from "../markdown/backend.js";
import { assertInfiniteAst } from "../markdown/infinite_ast.js";
import { MarkdownPositionMapper } from "../markdown/position_mapper.js";
import { resolveResource } from "../../resource_path.js";
import { TextSelection } from "prosemirror-state";

export const WYSIWYG_BRIDGE_VERSION = 1;

export class WysiwygBridgeSession {
  constructor({
    host,
    bridge = null,
    ast,
    markdown,
    documentRevision,
    editRevision = 0,
    onChange = null,
    changeDebounceMs = 120,
    resources = {},
    documentSession = window.InfiniteMarkdownEditor,
  }) {
    this.ast = assertInfiniteAst(ast);
    this.documentRevision = documentRevision;
    this.editRevision = editRevision;
    this.bridge = bridge;
    this.onChange = onChange;
    this.pendingDocument = null;
    this.pendingDocumentTimer = null;
    this.changeTimer = null;
    this.changeDebounceMs = changeDebounceMs;
    this.dirty = false;
    this.destroyed = false;
    this.host = host;
    this.resources = resources;
    this.documentSession = documentSession;
    const initialized = this.documentSession?.initialize?.(
      markdown,
      documentRevision,
      bridge?.id ?? null,
      editRevision,
    );
    if (initialized?.staleDocument) {
      throw new Error("WYSIWYG 收到了早于当前文档会话的快照");
    }
    this.usesSharedHistory = initialized?.ok === true;
    this.commands = toolbarCommands(wysiwygSchema);
    const backend = { parse: () => this.ast };
    this.editor = new MinimalWysiwygEditor(host, markdown, {
      backend,
      resources: () => this.resources,
      sharedHistory: this.usesSharedHistory ? {
        undo: () => this.historyCommand("undo").changed,
        redo: () => this.historyCommand("redo").changed,
      } : null,
      handlePaste: (view, event) => this.handlePaste(view, event),
      onTransaction: ({ transaction, previousState }) => {
        if (!transaction.docChanged) return;
        if (this.usesSharedHistory && !this.dirty) {
          this.captureHistoryStart(previousState);
        }
        if (!this.usesSharedHistory) this.editRevision += 1;
        this.dirty = true;
        this.scheduleChange();
      },
      onCompositionChange: (active) => {
        if (!active) this.schedulePendingDocument();
      },
      onBlur: () => this.flushChange("wysiwyg-blur"),
    });
    const snapshot = this.documentSession?.getSnapshot?.();
    if (this.usesSharedHistory && snapshot?.selection) {
      const mapper = this.editor.positionMapper;
      const anchor = mapper.sourceToProseMirror(snapshot.selection.anchor);
      const head = mapper.sourceToProseMirror(snapshot.selection.head);
      this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.between(
        this.editor.state.doc.resolve(anchor), this.editor.state.doc.resolve(head),
      )).scrollIntoView());
    }
  }

  handlePaste(view, event) {
    const sourceApi = window.InfiniteMarkdownEditor;
    if (!sourceApi?.clipboardMayContainImage?.(event.clipboardData)) return false;
    event.preventDefault();
    const documentRevision = this.documentRevision;
    sourceApi.requestClipboardImage((path) => {
      if (!path || this.destroyed || this.documentRevision !== documentRevision) return;
      const node = wysiwygSchema.nodes.image.create({ src: path, alt: "粘贴的图片", title: null });
      view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
      view.focus();
    });
    return true;
  }

  setResources(resources) {
    this.resources = resources ?? {};
    // Recreating node views is unnecessary; a harmless node-markup transaction asks
    // existing image views to resolve their current Markdown paths again.
    this.editor.view.updateState(this.editor.view.state);
    for (const image of this.host.querySelectorAll("img[data-markdown-src]")) {
      image.src = resolveResource(this.resources, image.dataset.markdownSrc);
    }
    return { ok: true };
  }

  scheduleChange() {
    if (this.changeTimer || this.destroyed) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.flushChange("wysiwyg-input");
    }, this.changeDebounceMs);
  }

  currentSourceSelection(markdown) {
    const ast = remarkReferenceBackend.parse(markdown);
    const mapper = this.editor.refreshPositionMapper(markdown, ast);
    return this.mapSourceSelection(mapper, this.editor.state.selection);
  }

  mapSourceSelection(mapper, selection) {
    const { anchor, head } = selection;
    return {
      anchor: mapper.proseMirrorToSource(anchor),
      head: mapper.proseMirrorToSource(head),
    };
  }

  captureHistoryStart(previousState) {
    const markdown = this.documentSession?.getValue?.();
    if (typeof markdown !== "string") return;
    const ast = remarkReferenceBackend.parse(markdown);
    const mapper = new MarkdownPositionMapper(ast, previousState.doc, markdown);
    const selection = this.mapSourceSelection(mapper, previousState.selection);
    this.documentSession.setDocumentSelection?.(
      selection.anchor, selection.head, this.richSnapshot(previousState),
    );
  }

  richSnapshot(state = this.editor.state) {
    // ProseMirror documents are immutable and share unchanged subtrees. Keep
    // the node reference instead of copying the entire document on every flush.
    return { doc: state.doc, selection: state.selection.toJSON() };
  }

  scrollContainer() {
    return this.host.closest(".editor-surface") ?? this.host;
  }

  revealHistorySelection() {
    const reveal = () => {
      if (this.destroyed || !this.host.isConnected) return;
      this.editor.focus();
      this.editor.view.dispatch(this.editor.state.tr.scrollIntoView());
    };
    reveal();
    // Pagination decorations are measured on animation frames. Reveal again
    // after they settle so a page gap cannot move the restored caret offscreen.
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  }

  flushChange(origin = "wysiwyg-snapshot", userEvent = "input.type", isolate = false) {
    if (!this.dirty) return null;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = null;
    if (this.editor.compositionActive || this.editor.view.composing) {
      this.scheduleChange();
      return null;
    }
    const markdown = this.editor.getMarkdown();
    if (this.usesSharedHistory) {
      const result = this.documentSession.replaceAll(
        markdown,
        origin,
        userEvent,
        isolate,
        this.currentSourceSelection(markdown),
        this.richSnapshot(),
      );
      if (!result?.ok) return result ?? null;
      this.dirty = false;
      this.editRevision = result.revision;
      if (!result.changed) return null;
      const envelope = this.changeEnvelope(markdown, origin);
      this.onChange?.(envelope);
      return envelope;
    }
    this.dirty = false;
    return this.emitChange(markdown, origin);
  }

  schedulePendingDocument() {
    if (!this.pendingDocument || this.pendingDocumentTimer || this.destroyed) return;
    this.pendingDocumentTimer = setTimeout(() => {
      this.pendingDocumentTimer = null;
      if (this.editor.compositionActive || this.editor.view.composing) {
        this.schedulePendingDocument();
        return;
      }
      const pending = this.pendingDocument;
      this.pendingDocument = null;
      this.setDocument(pending);
    }, 20);
  }

  changeEnvelope(markdown, origin) {
    return {
      bridge_version: WYSIWYG_BRIDGE_VERSION,
      document_revision: this.documentRevision,
      edit_revision: this.editRevision,
      origin,
      markdown,
    };
  }

  emitChange(markdown, origin) {
    const envelope = this.changeEnvelope(markdown, origin);
    const payload = JSON.stringify(envelope);
    if (this.bridge && this.bridge.value !== payload) {
      this.bridge.value = payload;
      this.bridge.dispatchEvent(new Event("input", { bubbles: true }));
    }
    this.onChange?.(envelope);
    return envelope;
  }

  setDocument(update) {
    if (this.destroyed) return { ok: false, error: "WYSIWYG 会话已销毁" };
    const current = this.documentSession?.getSnapshot?.();
    if (this.usesSharedHistory && current && (
      update.documentRevision < current.documentRevision
      || (update.documentRevision === current.documentRevision
        && (update.editRevision < current.editRevision || this.dirty))
    )) return { ok: true, applied: false, stale: true };
    if (
      update.documentRevision < this.documentRevision
      || (update.documentRevision === this.documentRevision
        && update.editRevision <= this.editRevision)
    ) {
      return { ok: true, applied: false, stale: true };
    }
    assertInfiniteAst(update.ast);
    if (this.editor.compositionActive || this.editor.view.composing) {
      const current = this.pendingDocument;
      if (
        !current
        || update.documentRevision > current.documentRevision
        || (update.documentRevision === current.documentRevision
          && update.editRevision > current.editRevision)
      ) this.pendingDocument = update;
      return { ok: true, applied: false, deferred: true };
    }

    const alreadyDisplayed = this.documentRevision === update.documentRevision
      && this.editor.getMarkdown() === update.markdown;
    this.ast = update.ast;
    this.documentRevision = update.documentRevision;
    this.editRevision = update.editRevision;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = null;
    this.dirty = false;
    this.documentSession?.initialize?.(
      update.markdown,
      update.documentRevision,
      this.bridge?.id ?? null,
      update.editRevision,
    );
    if (alreadyDisplayed) {
      // An asynchronous acknowledgement must not overwrite the restored
      // selection, or a selection the user has moved since the command.
      return { ok: true, applied: true, preservedHistory: true };
    }
    const applied = this.editor.setMarkdown(update.markdown);
    if (applied && update.selection) {
      const mapper = this.editor.refreshPositionMapper(update.markdown, update.ast);
      const anchor = mapper.sourceToProseMirror(update.selection.anchor);
      const head = mapper.sourceToProseMirror(update.selection.head);
      const selection = TextSelection.between(
        this.editor.state.doc.resolve(anchor),
        this.editor.state.doc.resolve(head),
      );
      this.editor.view.dispatch(
        this.editor.state.tr
          .setSelection(selection)
          .setMeta("addToHistory", false),
      );
    }
    if (applied && update.selection) this.revealHistorySelection();
    return { ok: applied, applied };
  }

  command(name) {
    if (this.destroyed) return { ok: false, changed: false, error: "WYSIWYG 会话已销毁" };
    if ((name === "undo" || name === "redo") && this.usesSharedHistory) {
      return this.historyCommand(name);
    }
    const command = this.commands[name];
    if (!command) return { ok: false, changed: false, error: `未知 WYSIWYG 命令：${name}` };
    this.flushChange("wysiwyg-before-command");
    const changed = command(
      this.editor.state,
      (transaction) => this.editor.view.dispatch(transaction),
      this.editor.view,
    );
    if (changed) {
      this.flushChange("wysiwyg-command", "input", true);
      this.editor.focus();
    }
    return { ok: true, changed, revision: this.editRevision };
  }

  historyCommand(name) {
    if (this.editor.compositionActive || this.editor.view.composing) {
      return { ok: true, changed: false, deferred: true };
    }
    this.flushChange("wysiwyg-before-history");
    const changed = this.documentSession?.[name]?.() ?? false;
    const snapshot = this.documentSession?.getSnapshot?.();
    if (changed && snapshot?.richSnapshot) {
      this.editor.restoreSnapshot(snapshot.richSnapshot);
      this.revealHistorySelection();
    } else if (changed && snapshot) {
      // Source-originated history has no rich snapshot. Project immediately so
      // rapid undo/edit sequences do not wait for an asynchronous Rust echo.
      this.setDocument({
        ...snapshot,
        ast: remarkReferenceBackend.parse(snapshot.markdown),
      });
    }
    return {
      ok: true,
      changed,
      revision: snapshot?.editRevision ?? this.editRevision,
    };
  }

  getViewSnapshot() {
    const { from, to } = this.editor.state.selection;
    const scroll = this.scrollContainer();
    const scrollMaximum = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    return {
      selection: { from, to },
      scroll_ratio: scrollMaximum > 0 ? scroll.scrollTop / scrollMaximum : 0,
      focused: this.editor.view.hasFocus(),
    };
  }

  getSourceViewSnapshot(markdown) {
    const selection = this.currentSourceSelection(markdown);
    const view = this.getViewSnapshot();
    return {
      selection: {
        anchor: selection.anchor,
        head: selection.head,
      },
      scroll_ratio: view.scroll_ratio,
      focused: view.focused,
    };
  }

  prepareModeSwitch() {
    if (this.editor.compositionActive || this.editor.view.composing) {
      return { ok: false, deferred: true, reason: "composition" };
    }
    const markdown = this.editor.getMarkdown();
    this.flushChange("wysiwyg-switch");
    if (this.usesSharedHistory) {
      const selection = this.currentSourceSelection(markdown);
      this.documentSession.setDocumentSelection?.(
        selection.anchor, selection.head, this.richSnapshot(),
      );
    }
    return {
      ok: true,
      bridge_version: WYSIWYG_BRIDGE_VERSION,
      document_revision: this.documentRevision,
      edit_revision: this.editRevision,
      markdown,
      view: this.getSourceViewSnapshot(markdown),
    };
  }

  destroy() {
    if (this.destroyed) return { ok: true, destroyed: false };
    this.flushChange("wysiwyg-destroy");
    this.editor.destroy();
    this.destroyed = true;
    this.pendingDocument = null;
    if (this.pendingDocumentTimer) clearTimeout(this.pendingDocumentTimer);
    this.pendingDocumentTimer = null;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = null;
    this.dirty = false;
    return { ok: true, destroyed: true };
  }
}
