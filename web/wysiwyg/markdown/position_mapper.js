const AST_LEAF_KINDS = new Set([
  "text", "code_inline", "math_inline", "hard_break", "image", "image_reference",
  "code_block", "math_block", "thematic_break", "page_break", "definition",
  "opaque_block", "opaque_inline",
]);

const PM_LEAF_TYPES = new Set([
  "code_block", "math_inline", "hard_break", "image", "math_block", "horizontal_rule",
  "page_break", "link_definition", "opaque_block", "opaque_inline",
]);

function astLeaves(documentNode) {
  const ranges = new Map((documentNode.source_map ?? []).map((entry) => [
    entry.path.join("."), entry,
  ]));
  const output = [];
  const visit = (nodes, parentPath = []) => nodes.forEach((node, index) => {
    const path = [...parentPath, index];
    if (AST_LEAF_KINDS.has(node.kind)) {
      const range = ranges.get(path.join("."));
      if (range) output.push({ node, range });
      return;
    }
    if (Array.isArray(node.children)) visit(node.children, path);
  });
  visit(documentNode.children);
  return output;
}

function proseMirrorLeaves(documentNode) {
  const output = [];
  const visit = (node, position) => {
    if (node.isText) {
      output.push({ node, from: position, to: position + node.nodeSize });
      return;
    }
    if (PM_LEAF_TYPES.has(node.type.name)) {
      const contentStart = node.type.name === "code_block" ? position + 1 : position;
      const contentEnd = node.type.name === "code_block"
        ? contentStart + node.textContent.length
        : position + node.nodeSize;
      output.push({ node, from: contentStart, to: contentEnd });
      return;
    }
    node.forEach((child, offset) => {
      visit(child, position + offset + (node.type.name === "doc" ? 0 : 1));
    });
  };
  visit(documentNode, 0);
  return output;
}

function sourceContentRange(markdown, leaf) {
  const { node, range } = leaf;
  const value = node.kind === "text"
    ? node.value
    : ["code_inline", "math_inline", "code_block", "math_block"].includes(node.kind)
      ? node.value
      : null;
  if (typeof value !== "string" || value.length === 0) return range;
  const relative = markdown.slice(range.from, range.to).indexOf(value);
  return relative < 0
    ? range
    : { ...range, from: range.from + relative, to: range.from + relative + value.length };
}

function compatible(astNode, pmNode) {
  const expected = {
    text: "text",
    code_inline: "text",
    math_inline: "math_inline",
    hard_break: "hard_break",
    image: "image",
    image_reference: "image",
    code_block: "code_block",
    math_block: "math_block",
    thematic_break: "horizontal_rule",
    page_break: "page_break",
    definition: "link_definition",
    opaque_block: "opaque_block",
    opaque_inline: "opaque_inline",
  }[astNode.kind];
  return expected === pmNode.type.name;
}

function interpolate(value, fromStart, fromEnd, toStart, toEnd) {
  if (fromEnd <= fromStart) return toStart;
  const ratio = Math.max(0, Math.min(1, (value - fromStart) / (fromEnd - fromStart)));
  return Math.round(toStart + ratio * (toEnd - toStart));
}

export class MarkdownPositionMapper {
  constructor(ast, documentNode, markdown) {
    const astItems = astLeaves(ast);
    const pmItems = proseMirrorLeaves(documentNode);
    this.segments = [];
    let pmIndex = 0;
    for (const astItem of astItems) {
      while (pmIndex < pmItems.length && !compatible(astItem.node, pmItems[pmIndex].node)) {
        pmIndex += 1;
      }
      if (pmIndex >= pmItems.length) break;
      const pmItem = pmItems[pmIndex];
      const source = sourceContentRange(markdown, astItem);
      this.segments.push({
        sourceFrom: source.from,
        sourceTo: source.to,
        pmFrom: pmItem.from,
        pmTo: pmItem.to,
      });
      pmIndex += 1;
    }
    this.sourceLength = markdown.length;
    this.pmLength = documentNode.content.size;
  }

  sourceToProseMirror(position) {
    const value = Math.max(0, Math.min(Number(position) || 0, this.sourceLength));
    const containing = this.segments.find((segment) => (
      value >= segment.sourceFrom && value <= segment.sourceTo
    ));
    if (containing) {
      return interpolate(value, containing.sourceFrom, containing.sourceTo, containing.pmFrom, containing.pmTo);
    }
    const next = this.segments.find((segment) => segment.sourceFrom > value);
    if (next) return next.pmFrom;
    return this.segments.at(-1)?.pmTo ?? 1;
  }

  proseMirrorToSource(position) {
    const value = Math.max(0, Math.min(Number(position) || 0, this.pmLength));
    const containing = this.segments.find((segment) => value >= segment.pmFrom && value <= segment.pmTo);
    if (containing) {
      return interpolate(value, containing.pmFrom, containing.pmTo, containing.sourceFrom, containing.sourceTo);
    }
    const next = this.segments.find((segment) => segment.pmFrom > value);
    if (next) return next.sourceFrom;
    return this.segments.at(-1)?.sourceTo ?? 0;
  }
}
