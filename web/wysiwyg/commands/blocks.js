import { Fragment } from "prosemirror-model";
import { Selection } from "prosemirror-state";

function insertNode(node) {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView());
    return true;
  };
}

function insertPageBreak(schema) {
  return (state, dispatch) => {
    if (!dispatch) return true;
    let transaction = state.tr.replaceSelectionWith(schema.nodes.page_break.create(), false);
    const after = transaction.selection.to;
    if (after === transaction.doc.content.size) {
      transaction = transaction.insert(after, schema.nodes.paragraph.create());
    }
    const selection = Selection.findFrom(transaction.doc.resolve(after), 1, true);
    if (selection) transaction = transaction.setSelection(selection);
    dispatch(transaction.scrollIntoView());
    return true;
  };
}

export function blockCommands(schema) {
  return {
    horizontalRule: () => insertNode(schema.nodes.horizontal_rule.create()),
    pageBreak: () => insertPageBreak(schema),
    image: (attrs) => insertNode(schema.nodes.image.create(attrs)),
    inlineMath: (value) => insertNode(schema.nodes.math_inline.create({ value })),
    blockMath: (value, meta = null) => insertNode(
      schema.nodes.math_block.create({ value, meta }),
    ),
    table(rows = 2, columns = 2, align = []) {
      const rowNodes = Array.from({ length: Math.max(1, rows) }, (_, rowIndex) => {
        const cellType = rowIndex === 0 ? schema.nodes.table_header : schema.nodes.table_cell;
        return schema.nodes.table_row.create(null, Fragment.fromArray(
          Array.from({ length: Math.max(1, columns) }, () => cellType.create()),
        ));
      });
      return insertNode(schema.nodes.table.create({ align }, rowNodes));
    },
    setTaskChecked(checked) {
      return (state, dispatch) => {
        const { $from } = state.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth);
          if (node.type === schema.nodes.list_item) {
            if (dispatch) {
              const position = $from.before(depth);
              dispatch(state.tr.setNodeMarkup(position, undefined, {
                ...node.attrs,
                checked,
              }));
            }
            return true;
          }
        }
        return false;
      };
    },
  };
}
