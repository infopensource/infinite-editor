import { lift, setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { liftListItem, wrapInList } from "prosemirror-schema-list";
import { blockCommands } from "./blocks.js";

function toggleBlock(type, fallback) {
  return (state, dispatch) => {
    const active = state.selection.$from.parent.type === type;
    return setBlockType(active ? fallback : type)(state, dispatch);
  };
}

function toggleHeading(schema, level) {
  return (state, dispatch) => {
    const parent = state.selection.$from.parent;
    const active = parent.type === schema.nodes.heading && parent.attrs.level === level;
    return setBlockType(
      active ? schema.nodes.paragraph : schema.nodes.heading,
      active ? undefined : { level },
    )(state, dispatch);
  };
}

function toggleBlockquote(schema) {
  return (state, dispatch) => {
    for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
      if (state.selection.$from.node(depth).type === schema.nodes.blockquote) {
        return lift(state, dispatch);
      }
    }
    return wrapIn(schema.nodes.blockquote)(state, dispatch);
  };
}

function toggleList(schema, targetType) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type !== schema.nodes.bullet_list && node.type !== schema.nodes.ordered_list) continue;
      if (node.type === targetType) return liftListItem(schema.nodes.list_item)(state, dispatch);
      if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(depth), targetType));
      return true;
    }
    return wrapInList(targetType)(state, dispatch);
  };
}

export function toolbarCommands(schema) {
  const blocks = blockCommands(schema);
  return {
    undo,
    redo,
    bold: toggleMark(schema.marks.strong),
    italic: toggleMark(schema.marks.em),
    strike: toggleMark(schema.marks.strike),
    code_block: toggleBlock(schema.nodes.code_block, schema.nodes.paragraph),
    quote: toggleBlockquote(schema),
    unordered_list: toggleList(schema, schema.nodes.bullet_list),
    ordered_list: toggleList(schema, schema.nodes.ordered_list),
    horizontal_rule: blocks.horizontalRule(),
    page_break: blocks.pageBreak(),
    heading1: toggleHeading(schema, 1),
    heading2: toggleHeading(schema, 2),
    heading3: toggleHeading(schema, 3),
    paragraph: setBlockType(schema.nodes.paragraph),
  };
}
