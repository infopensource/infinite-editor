export const INFINITE_AST_VERSION = 1;

function rawSource(node, source) {
  const from = node?.position?.start?.offset;
  const to = node?.position?.end?.offset;
  if (Number.isInteger(from) && Number.isInteger(to)) return source.slice(from, to);
  return typeof node?.value === "string" ? node.value : "";
}

export function infiniteAstFromRemark(root, source) {
  const sourceMap = [];
  const collectRanges = (nodes, parentPath = []) => nodes.forEach((node, index) => {
    const path = [...parentPath, index];
    const from = node?.position?.start?.offset;
    const to = node?.position?.end?.offset;
    if (Number.isInteger(from) && Number.isInteger(to)) {
      sourceMap.push({ path, from, to });
    }
    if (Array.isArray(node.children)) collectRanges(node.children, path);
  });
  collectRanges(root.children);

  const inline = (nodes) => nodes.map((node) => {
    switch (node.type) {
      case "text": return { kind: "text", value: node.value };
      case "emphasis": return { kind: "emphasis", children: inline(node.children) };
      case "strong": return { kind: "strong", children: inline(node.children) };
      case "delete": return { kind: "strike", children: inline(node.children) };
      case "inlineCode": return { kind: "code_inline", value: node.value };
      case "inlineMath": return { kind: "math_inline", value: node.value };
      case "break": return { kind: "hard_break" };
      case "link": return {
        kind: "link",
        href: node.url,
        title: node.title ?? null,
        children: inline(node.children),
      };
      case "linkReference": return {
        kind: "link_reference",
        identifier: node.identifier,
        children: inline(node.children),
      };
      case "image": return {
        kind: "image",
        src: node.url,
        alt: node.alt ?? "",
        title: node.title ?? null,
      };
      case "imageReference": return {
        kind: "image_reference",
        identifier: node.identifier,
        alt: node.alt ?? "",
      };
      default: return {
        kind: "opaque_inline",
        syntax: node.type,
        source: rawSource(node, source),
      };
    }
  });

  const blocks = (nodes) => nodes.map((node) => {
    switch (node.type) {
      case "paragraph": return { kind: "paragraph", children: inline(node.children) };
      case "heading": return {
        kind: "heading",
        level: node.depth,
        children: inline(node.children),
      };
      case "blockquote": return { kind: "blockquote", children: blocks(node.children) };
      case "code": return {
        kind: "code_block",
        value: node.value,
        language: node.lang ?? null,
        meta: node.meta ?? null,
      };
      case "math": return {
        kind: "math_block",
        value: node.value,
        meta: node.meta ?? null,
      };
      case "thematicBreak": return { kind: "thematic_break" };
      case "list": return {
        kind: "list",
        ordered: node.ordered,
        start: node.start ?? null,
        children: node.children.map((item) => ({
          kind: "list_item",
          checked: item.checked ?? null,
          children: blocks(item.children),
        })),
      };
      case "table": return {
        kind: "table",
        align: node.align ?? [],
        children: node.children.map((row) => ({
          kind: "table_row",
          children: row.children.map((cell) => ({
            kind: "table_cell",
            children: inline(cell.children),
          })),
        })),
      };
      case "definition": return {
        kind: "definition",
        identifier: node.identifier,
        href: node.url,
        title: node.title ?? null,
        source: rawSource(node, source),
      };
      case "html": {
        const raw = rawSource(node, source);
        return /^<!--\s*infinite-editor:page-break\s*-->$/u.test(raw.trim())
          ? { kind: "page_break", source: raw }
          : { kind: "opaque_block", syntax: "html", source: raw };
      }
      default: return {
        kind: "opaque_block",
        syntax: node.type,
        source: rawSource(node, source),
      };
    }
  });

  return {
    version: INFINITE_AST_VERSION,
    children: blocks(root.children),
    source_map: sourceMap,
  };
}

export function assertInfiniteAst(documentNode) {
  if (documentNode?.version !== INFINITE_AST_VERSION) {
    throw new RangeError(
      `不支持 Infinite AST v${documentNode?.version ?? "unknown"}，需要 v${INFINITE_AST_VERSION}`,
    );
  }
  if (!Array.isArray(documentNode.children)) {
    throw new TypeError("Infinite AST document.children 必须是数组");
  }
  if (documentNode.source_map !== undefined && !Array.isArray(documentNode.source_map)) {
    throw new TypeError("Infinite AST document.source_map 必须是数组");
  }
  return documentNode;
}
