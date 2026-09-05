import { MarkdownSerializer, defaultMarkdownSerializer } from "prosemirror-markdown";
import { PAGE_BREAK_SOURCE } from "./dialect.js";

function escapeTablePipes(value) {
  return value.replace(/(^|[^\\])\|/gu, "$1\\|").replaceAll("\n", "<br>");
}

function alignmentMarker(value) {
  if (value === "left") return ":---";
  if (value === "right") return "---:";
  if (value === "center") return ":---:";
  return "---";
}

const nodes = {
  ...defaultMarkdownSerializer.nodes,
  list_item(state, node) {
    if (node.attrs.checked !== null) state.write(node.attrs.checked ? "[x] " : "[ ] ");
    state.renderContent(node);
  },
  math_inline(state, node) {
    state.write(`$${node.attrs.value}$`);
  },
  math_block(state, node) {
    const meta = node.attrs.meta ? ` ${node.attrs.meta}` : "";
    state.write(`$$${meta}\n${node.attrs.value}\n$$`);
    state.closeBlock(node);
  },
  page_break(state, node) {
    state.write(node.attrs.source || PAGE_BREAK_SOURCE);
    state.closeBlock(node);
  },
  link_definition(state, node) {
    const title = node.attrs.title
      ? ` "${String(node.attrs.title).replaceAll('"', '\\"')}"`
      : "";
    state.write(
      node.attrs.source || `[${node.attrs.identifier}]: ${node.attrs.href}${title}`,
    );
    state.closeBlock(node);
  },
  opaque_block(state, node) {
    state.write(node.attrs.source);
    state.closeBlock(node);
  },
  opaque_inline(state, node) {
    state.write(node.attrs.source);
  },
  table(state, node) {
    state.flushClose();
    const rows = [];
    for (let rowIndex = 0; rowIndex < node.childCount; rowIndex += 1) {
      const row = node.child(rowIndex);
      const cells = [];
      for (let cellIndex = 0; cellIndex < row.childCount; cellIndex += 1) {
        const cell = row.child(cellIndex);
        const paragraph = node.type.schema.nodes.paragraph.create(null, cell.content);
        const documentNode = node.type.schema.nodes.doc.create(null, [paragraph]);
        cells.push(escapeTablePipes(markdownSerializer.serialize(documentNode).trimEnd()));
      }
      rows.push(`| ${cells.join(" | ")} |`);
      if (rowIndex === 0) {
        const align = node.attrs.align ?? [];
        rows.push(`| ${cells.map((_, index) => alignmentMarker(align[index])).join(" | ")} |`);
      }
    }
    state.write(rows.join("\n"));
    state.closeBlock(node);
  },
  table_row() {
    throw new Error("table_row 必须由 table serializer 处理");
  },
  table_header() {
    throw new Error("table_header 必须由 table serializer 处理");
  },
  table_cell() {
    throw new Error("table_cell 必须由 table serializer 处理");
  },
};

const marks = {
  ...defaultMarkdownSerializer.marks,
  strike: {
    open: "~~",
    close: "~~",
    mixable: true,
    expelEnclosingWhitespace: true,
  },
};

export const markdownSerializer = new MarkdownSerializer(nodes, marks, {
  tightLists: true,
});

export function markdownFromDocument(documentNode) {
  return markdownSerializer.serialize(documentNode, { tightLists: true });
}
