import { Fragment } from "prosemirror-model";
import { assertInfiniteAst } from "./infinite_ast.js";

function withMark(nodes, mark) {
  return nodes.map((node) => node.mark(mark.addToSet(node.marks)));
}

function definitionMap(documentNode) {
  return new Map(documentNode.children
    .filter((node) => node.kind === "definition")
    .map((node) => [node.identifier.toLowerCase(), node]));
}

export function documentFromInfiniteAst(input, schema) {
  const documentNode = assertInfiniteAst(input);
  const definitions = definitionMap(documentNode);
  const opaque = (name, node) => schema.nodes[name].create({
    source: node.source ?? "",
    kind: node.syntax ?? node.kind,
  });

  const inline = (nodes) => nodes.flatMap((node) => {
    switch (node.kind) {
      case "text":
        return node.value ? [schema.text(node.value)] : [];
      case "emphasis":
        return withMark(inline(node.children), schema.marks.em.create());
      case "strong":
        return withMark(inline(node.children), schema.marks.strong.create());
      case "strike":
        return withMark(inline(node.children), schema.marks.strike.create());
      case "code_inline":
        return [schema.text(node.value, [schema.marks.code.create()])];
      case "hard_break":
        return [schema.nodes.hard_break.create()];
      case "link":
        return withMark(inline(node.children), schema.marks.link.create({
          href: node.href,
          title: node.title ?? null,
        }));
      case "link_reference": {
        const definition = definitions.get(node.identifier.toLowerCase());
        if (!definition) return [opaque("opaque_inline", node)];
        return withMark(inline(node.children), schema.marks.link.create({
          href: definition.href,
          title: definition.title ?? null,
        }));
      }
      case "image":
        return [schema.nodes.image.create({
          src: node.src,
          alt: node.alt ?? null,
          title: node.title ?? null,
        })];
      case "image_reference": {
        const definition = definitions.get(node.identifier.toLowerCase());
        if (!definition) return [opaque("opaque_inline", node)];
        return [schema.nodes.image.create({
          src: definition.href,
          alt: node.alt ?? null,
          title: definition.title ?? null,
        })];
      }
      case "math_inline":
        return [schema.nodes.math_inline.create({ value: node.value })];
      case "opaque_inline":
      default:
        return [opaque("opaque_inline", node)];
    }
  });

  const blocks = (nodes) => nodes.flatMap((node) => {
    switch (node.kind) {
      case "paragraph":
        return [schema.nodes.paragraph.create(null, inline(node.children))];
      case "heading":
        return [schema.nodes.heading.create({ level: node.level }, inline(node.children))];
      case "blockquote":
        return [schema.nodes.blockquote.create(null, blocks(node.children))];
      case "code_block": {
        const params = [node.language, node.meta].filter(Boolean).join(" ");
        const content = node.value ? schema.text(node.value) : null;
        return [schema.nodes.code_block.create({ params }, content)];
      }
      case "thematic_break":
        return [schema.nodes.horizontal_rule.create()];
      case "math_block":
        return [schema.nodes.math_block.create({ value: node.value, meta: node.meta ?? null })];
      case "list": {
        const type = node.ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list;
        const attrs = node.ordered ? { order: node.start ?? 1 } : null;
        return [type.create(attrs, node.children.map((item) => {
          const content = blocks(item.children);
          if (content.length === 0 || content[0].type !== schema.nodes.paragraph) {
            content.unshift(schema.nodes.paragraph.create());
          }
          return schema.nodes.list_item.create({ checked: item.checked ?? null }, content);
        }))];
      }
      case "table":
        return [schema.nodes.table.create(
          { align: node.align ?? [] },
          node.children.map((row, rowIndex) => schema.nodes.table_row.create(
            null,
            row.children.map((cell, cellIndex) => schema.nodes[
              rowIndex === 0 ? "table_header" : "table_cell"
            ].create({ align: node.align?.[cellIndex] ?? null }, inline(cell.children))),
          )),
        )];
      case "page_break":
        return [schema.nodes.page_break.create({ source: node.source })];
      case "definition":
        return [schema.nodes.link_definition.create({
          identifier: node.identifier,
          href: node.href,
          title: node.title ?? null,
          source: node.source ?? "",
        })];
      case "opaque_block":
      default:
        return [opaque("opaque_block", node)];
    }
  });

  const content = blocks(documentNode.children);
  if (content.at(-1)?.type === schema.nodes.page_break) {
    content.push(schema.nodes.paragraph.create());
  }
  return schema.nodes.doc.create(null, Fragment.fromArray(
    content.length > 0 ? content : [schema.nodes.paragraph.create()],
  ));
}
