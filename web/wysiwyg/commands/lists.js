import { chainCommands, joinBackward, selectNodeBackward } from "prosemirror-commands";
import { closeHistory } from "prosemirror-history";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";

function isolated(command) {
  return (state, dispatch, view) => command(
    state,
    dispatch ? (transaction) => dispatch(closeHistory(transaction)) : undefined,
    view,
  );
}

export function listCommands(schema) {
  const item = schema.nodes.list_item;
  const splitCurrentItem = (state, dispatch) => {
    let task = false;
    for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
      const ancestor = state.selection.$from.node(depth);
      if (ancestor.type === item) {
        task = ancestor.attrs.checked !== null;
        break;
      }
    }
    return splitListItem(item)(state, dispatch && ((transaction) => {
      if (task) {
        const { $from } = transaction.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const ancestor = $from.node(depth);
          if (ancestor.type === item) {
            transaction.setNodeMarkup($from.before(depth), undefined, {
              ...ancestor.attrs,
              checked: false,
            });
            break;
          }
        }
      }
      dispatch(transaction);
    }));
  };
  return {
    enter: isolated(splitCurrentItem),
    backspace: isolated(chainCommands(joinBackward, selectNodeBackward)),
    indent: isolated(sinkListItem(item)),
    outdent: isolated(liftListItem(item)),
  };
}

export function listKeyBindings(schema) {
  const commands = listCommands(schema);
  return {
    Enter: commands.enter,
    Backspace: commands.backspace,
    Tab: commands.indent,
    "Shift-Tab": commands.outdent,
  };
}
