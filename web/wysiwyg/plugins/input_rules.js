import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";

function horizontalRule(schema) {
  return new InputRule(/^(?:---|\*\*\*)\s$/u, (state) => {
    const paragraphStart = state.selection.$from.before();
    return state.tr.replaceWith(
      paragraphStart,
      state.selection.$from.after(),
      schema.nodes.horizontal_rule.create(),
    );
  });
}

// Track unfinished source delimiters before applying Markdown shortcuts.
// In particular, TeX underscores/asterisks belong to the formula, not marks.
function sourceContext(prefix) {
  let code = 0;
  let math = 0;
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] === "\\") { index += 1; continue; }
    const character = prefix[index];
    if (character !== "`" && character !== "$") continue;
    let length = 1;
    while (prefix[index + length] === character) length += 1;
    index += length - 1;
    if (character === "`" && !math) {
      if (!code) code = length;
      else if (code === length) code = 0;
    } else if (character === "$" && !code) {
      if (!math) math = length;
      else if (math === length) math = 0;
    }
  }
  return { code, math };
}

function contextBefore(state, start) {
  const $start = state.doc.resolve(start);
  const prefix = $start.parent.textBetween(0, $start.parentOffset);
  return {
    ...sourceContext(prefix),
    escaped: ((prefix.match(/\\+$/u)?.[0].length ?? 0) % 2) !== 0,
  };
}

function mathInputRule(schema, displayMode) {
  const pattern = displayMode
    ? /^\$\$((?:\\[^\n]|[^\\$\n])+)\$\$$/u
    : /(?<!\$)\$((?:\\[^\n]|[^\\$\n])+)\$$/u;
  return new InputRule(pattern, (state, match, start, end) => {
    const context = contextBefore(state, start);
    if (context.escaped || context.code || context.math || !match[1].trim()) return null;
    if (match[1] !== match[1].trim()) return null;
    const type = displayMode ? schema.nodes.math_block : schema.nodes.math_inline;
    const formula = type.create({ value: match[1] });
    if (displayMode) {
      const $start = state.doc.resolve(start);
      if ($start.parent.type !== schema.nodes.paragraph || end !== $start.end()) return null;
      return state.tr.replaceWith($start.before(), $start.after(), [
        formula, schema.nodes.paragraph.create(),
      ]);
    }
    return state.tr.replaceWith(start, end, formula);
  }, { inCodeMark: false });
}

function inlineMarkRule(pattern, delimiter, marks) {
  return new InputRule(pattern, (state, match, start, end) => {
    const context = contextBefore(state, start);
    if (context.escaped || context.code || context.math) return null;

    const transaction = state.tr;
    // The final delimiter is still an input event, not yet document content.
    // Insert only the pending suffix, retaining existing inline nodes/marks.
    const pending = match[0].slice(state.selection.from - start);
    if (pending) transaction.insertText(pending, state.selection.from, end);
    const contentEnd = start + delimiter.length + match[1].length;
    transaction.delete(contentEnd, start + match[0].length);
    transaction.delete(start, start + delimiter.length);
    for (const mark of marks) {
      transaction.addMark(start, start + match[1].length, mark.create());
    }
    for (const mark of marks) transaction.removeStoredMark(mark);
    return transaction;
  }, { inCodeMark: false });
}

export function markdownInputRules(schema) {
  return inputRules({
    rules: [
      mathInputRule(schema, true),
      mathInputRule(schema, false),
      inlineMarkRule(/(?<!\*)\*\*\*([^\s*](?:[^*\n]*[^\s*])?)\*\*\*$/u, "***", [schema.marks.strong, schema.marks.em]),
      inlineMarkRule(/(?<![\p{L}\p{N}_])___([^\s_](?:[^_\n]*[^\s_])?)___$/u, "___", [schema.marks.strong, schema.marks.em]),
      inlineMarkRule(/(?<!\*)\*\*([^\s*](?:[^*\n]*[^\s*])?)\*\*$/u, "**", [schema.marks.strong]),
      inlineMarkRule(/(?<![\p{L}\p{N}_])__([^\s_](?:[^_\n]*[^\s_])?)__$/u, "__", [schema.marks.strong]),
      inlineMarkRule(/(?<!\*)\*([^\s*](?:[^*\n]*[^\s*])?)\*$/u, "*", [schema.marks.em]),
      inlineMarkRule(/(?<![\p{L}\p{N}_])_([^\s_](?:[^_\n]*[^\s_])?)_$/u, "_", [schema.marks.em]),
      inlineMarkRule(/(?<!~)~~([^\s~](?:[^~\n]*[^\s~])?)~~$/u, "~~", [schema.marks.strike]),
      inlineMarkRule(/(?<!`)`([^`\n]+)`$/u, "`", [schema.marks.code]),
      textblockTypeInputRule(/^(#{1,6})\s$/u, schema.nodes.heading, (match) => ({
        level: match[1].length,
      })),
      textblockTypeInputRule(/^```([^\s`]*)\s$/u, schema.nodes.code_block, (match) => ({
        params: match[1] ?? "",
      })),
      wrappingInputRule(/^\s*>\s$/u, schema.nodes.blockquote),
      wrappingInputRule(/^\s*([-+*])\s$/u, schema.nodes.bullet_list),
      wrappingInputRule(/^(\d+)[.)]\s$/u, schema.nodes.ordered_list, (match) => ({
        order: Number(match[1]),
      }), (match, node) => node.childCount + node.attrs.order === Number(match[1])),
      horizontalRule(schema),
    ],
  });
}
