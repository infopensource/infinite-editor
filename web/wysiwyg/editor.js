import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, Selection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { listKeyBindings } from "./commands/lists.js";
import {
  parseMarkdown,
  parseMarkdownWithMapping,
  serializeMarkdown,
  serializeMarkdownSlice,
} from "./markdown.js";
import { MarkdownPositionMapper } from "./markdown/position_mapper.js";
import { wysiwygSchema } from "./schema.js";
import { createNodeViews } from "./node_views.js";
import { markdownInputRules } from "./plugins/input_rules.js";
import { paginationPlugin } from "./plugins/pagination.js";

function editorPlugins(options = {}) {
  const sharedHistory = options.sharedHistory;
  return [
    ...(sharedHistory ? [] : [history()]),
    markdownInputRules(wysiwygSchema),
    paginationPlugin(),
    keymap(listKeyBindings(wysiwygSchema)),
    keymap(sharedHistory
      ? {
          "Mod-z": () => sharedHistory.undo(),
          "Mod-y": () => sharedHistory.redo(),
          "Shift-Mod-z": () => sharedHistory.redo(),
        }
      : {
          "Mod-z": undo,
          "Mod-y": redo,
          "Shift-Mod-z": redo,
        }),
    keymap(baseKeymap),
  ];
}

export function createEditorState(markdown, options = {}) {
  return EditorState.create({
    schema: wysiwygSchema,
    doc: parseMarkdown(markdown, options.backend),
    plugins: editorPlugins(options),
  });
}

export class MinimalWysiwygEditor {
  constructor(host, markdown, options = {}) {
    if (!(host instanceof HTMLElement)) {
      throw new TypeError("MinimalWysiwygEditor 需要一个 HTMLElement host");
    }

    this.host = host;
    this.options = options;
    this.compositionActive = false;
    const parsed = parseMarkdownWithMapping(markdown, options.backend);
    this.positionMapper = parsed.mapper;
    this.view = new EditorView(host, {
      state: EditorState.create({
        schema: wysiwygSchema,
        doc: parsed.document,
        plugins: editorPlugins(options),
      }),
      clipboardTextSerializer: (slice) => serializeMarkdownSlice(slice),
      nodeViews: createNodeViews(() => this.options.resources?.() ?? {}),
      handlePaste: (view, event, slice) => (
        this.options.handlePaste?.(view, event, slice) ?? false
      ),
      dispatchTransaction: (transaction) => {
        const previousState = this.view.state;
        const nextState = previousState.apply(transaction);
        this.view.updateState(nextState);
        this.options.onTransaction?.({
          transaction,
          previousState,
          state: nextState,
          getMarkdown: () => serializeMarkdown(nextState.doc),
        });
      },
      handleDOMEvents: {
        beforeinput: (_view, event) => {
          if (!this.options.sharedHistory) return false;
          if (event.inputType === "historyUndo") {
            event.preventDefault();
            return this.options.sharedHistory.undo();
          }
          if (event.inputType === "historyRedo") {
            event.preventDefault();
            return this.options.sharedHistory.redo();
          }
          return false;
        },
        compositionstart: () => {
          this.compositionActive = true;
          this.options.onCompositionChange?.(true);
          return false;
        },
        compositionend: () => {
          this.compositionActive = false;
          this.options.onCompositionChange?.(false);
          return false;
        },
        blur: () => {
          this.options.onBlur?.();
          return false;
        },
      },
    });
  }

  get state() {
    return this.view.state;
  }

  getMarkdown() {
    return serializeMarkdown(this.view.state.doc);
  }

  refreshPositionMapper(markdown, ast) {
    this.positionMapper = new MarkdownPositionMapper(ast, this.view.state.doc, markdown);
    return this.positionMapper;
  }

  setMarkdown(markdown) {
    if (this.compositionActive || this.view.composing) return false;
    const parsed = parseMarkdownWithMapping(markdown, this.options.backend);
    this.positionMapper = parsed.mapper;
    this.view.updateState(EditorState.create({
      schema: wysiwygSchema,
      doc: parsed.document,
      plugins: editorPlugins(this.options),
    }));
    return true;
  }

  restoreSnapshot(snapshot) {
    const doc = snapshot.doc;
    const selection = Selection.fromJSON(doc, snapshot.selection);
    this.view.updateState(EditorState.create({
      schema: wysiwygSchema,
      doc,
      selection,
      plugins: editorPlugins(this.options),
    }));
  }

  focus() {
    this.view.focus();
  }

  destroy() {
    this.view.destroy();
  }
}

export { parseMarkdown, serializeMarkdown, wysiwygSchema };
