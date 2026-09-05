import { assertMarkdownAstBackend, remarkReferenceBackend } from "./markdown/backend.js";
import { documentFromInfiniteAst } from "./markdown/parser.js";
import { MarkdownPositionMapper } from "./markdown/position_mapper.js";
import { markdownFromDocument } from "./markdown/serializer.js";
import { wysiwygSchema } from "./schema.js";

export function parseMarkdown(markdown, backend = remarkReferenceBackend) {
  const ast = assertMarkdownAstBackend(backend).parse(markdown);
  return documentFromInfiniteAst(ast, wysiwygSchema);
}

export function parseMarkdownWithMapping(markdown, backend = remarkReferenceBackend) {
  const ast = assertMarkdownAstBackend(backend).parse(markdown);
  const documentNode = documentFromInfiniteAst(ast, wysiwygSchema);
  return {
    ast,
    document: documentNode,
    mapper: new MarkdownPositionMapper(ast, documentNode, markdown),
  };
}

export function serializeMarkdown(documentNode) {
  return markdownFromDocument(documentNode);
}

export function serializeMarkdownSlice(slice, schema = wysiwygSchema) {
  const children = [];
  slice.content.forEach((node) => children.push(node));
  const content = children.length > 0 && children.every((node) => node.isInline)
    ? [schema.nodes.paragraph.create(null, children)]
    : children;
  return markdownFromDocument(schema.nodes.doc.create(null, content));
}

export { remarkReferenceBackend };
