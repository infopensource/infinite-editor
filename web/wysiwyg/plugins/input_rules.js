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

export function markdownInputRules(schema) {
  return inputRules({
    rules: [
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
