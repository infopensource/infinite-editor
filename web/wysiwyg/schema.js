import { Schema } from "prosemirror-model";
import { bulletList, listItem, orderedList } from "prosemirror-schema-list";

const blockDom = (tag) => [tag, 0];

const baseSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => blockDom("p"),
    },
    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => blockDom("blockquote"),
    },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: Array.from({ length: 6 }, (_, index) => ({
        tag: `h${index + 1}`,
        attrs: { level: index + 1 },
      })),
      toDOM: (node) => blockDom(`h${node.attrs.level}`),
    },
    code_block: {
      attrs: { params: { default: "" } },
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
      toDOM: () => ["pre", ["code", 0]],
    },
    horizontal_rule: {
      group: "block",
      atom: true,
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr"],
    },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
    image: {
      inline: true,
      group: "inline",
      draggable: true,
      atom: true,
      attrs: {
        src: {},
        alt: { default: null },
        title: { default: null },
      },
      parseDOM: [{
        tag: "img[src]",
        getAttrs: (element) => ({
          src: element.getAttribute("src"),
          alt: element.getAttribute("alt"),
          title: element.getAttribute("title"),
        }),
      }],
      toDOM: (node) => ["img", node.attrs],
    },
    math_inline: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { value: {} },
      parseDOM: [{
        tag: "span[data-math-inline]",
        getAttrs: (element) => ({ value: element.dataset.mathSource ?? "" }),
      }],
      toDOM: (node) => [
        "span",
        { "data-math-inline": "true", "data-math-source": node.attrs.value },
        `$${node.attrs.value}$`,
      ],
    },
    math_block: {
      group: "block",
      atom: true,
      attrs: { value: {}, meta: { default: null } },
      parseDOM: [{
        tag: "div[data-math-block]",
        getAttrs: (element) => ({
          value: element.dataset.mathSource ?? "",
          meta: element.dataset.mathMeta ?? null,
        }),
      }],
      toDOM: (node) => [
        "div",
        { "data-math-block": "true", "data-math-source": node.attrs.value },
        `$$\n${node.attrs.value}\n$$`,
      ],
    },
    page_break: {
      group: "block",
      atom: true,
      attrs: { source: { default: "<!-- infinite-editor:page-break -->" } },
      parseDOM: [{ tag: "div[data-page-break]" }],
      toDOM: () => ["div", { "data-page-break": "true" }, "Page break"],
    },
    link_definition: {
      group: "block",
      atom: true,
      selectable: false,
      attrs: {
        identifier: {},
        href: {},
        title: { default: null },
        source: { default: "" },
      },
      parseDOM: [{
        tag: "div[data-link-definition]",
        getAttrs: (element) => ({
          identifier: element.dataset.definitionIdentifier ?? "",
          href: element.dataset.definitionHref ?? "",
          title: element.dataset.definitionTitle ?? null,
          source: element.textContent ?? "",
        }),
      }],
      toDOM: (node) => [
        "div",
        {
          "data-link-definition": "true",
          "data-definition-identifier": node.attrs.identifier,
          "data-definition-href": node.attrs.href,
          ...(node.attrs.title ? { "data-definition-title": node.attrs.title } : {}),
          hidden: "hidden",
          "aria-hidden": "true",
        },
        node.attrs.source,
      ],
    },
    table: {
      group: "block",
      content: "table_row+",
      isolating: true,
      attrs: { align: { default: [] } },
      parseDOM: [{ tag: "table" }],
      toDOM: () => ["table", ["tbody", 0]],
    },
    table_row: {
      content: "(table_header | table_cell)+",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0],
    },
    table_header: {
      attrs: { align: { default: null } },
      content: "inline*",
      isolating: true,
      parseDOM: [{ tag: "th" }],
      toDOM: (node) => ["th", node.attrs.align ? { style: `text-align:${node.attrs.align}` } : {}, 0],
    },
    table_cell: {
      attrs: { align: { default: null } },
      content: "inline*",
      isolating: true,
      parseDOM: [{ tag: "td" }],
      toDOM: (node) => ["td", node.attrs.align ? { style: `text-align:${node.attrs.align}` } : {}, 0],
    },
    opaque_block: {
      group: "block",
      atom: true,
      code: true,
      attrs: { source: {}, kind: { default: "unknown" } },
      parseDOM: [{
        tag: "pre[data-opaque-source]",
        preserveWhitespace: "full",
        getAttrs: (element) => ({
          source: element.textContent ?? "",
          kind: element.dataset.opaqueKind ?? "unknown",
        }),
      }],
      toDOM: (node) => [
        "pre",
        { "data-opaque-source": "true", "data-opaque-kind": node.attrs.kind },
        node.attrs.source,
      ],
    },
    opaque_inline: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { source: {}, kind: { default: "unknown" } },
      parseDOM: [{
        tag: "code[data-opaque-inline]",
        getAttrs: (element) => ({
          source: element.textContent ?? "",
          kind: element.dataset.opaqueKind ?? "unknown",
        }),
      }],
      toDOM: (node) => [
        "code",
        { "data-opaque-inline": "true", "data-opaque-kind": node.attrs.kind },
        node.attrs.source,
      ],
    },
    ordered_list: { ...orderedList, content: "list_item+", group: "block" },
    bullet_list: { ...bulletList, content: "list_item+", group: "block" },
    list_item: {
      ...listItem,
      attrs: { checked: { default: null } },
      content: "paragraph block*",
      toDOM: (node) => node.attrs.checked === null
        ? ["li", 0]
        : ["li", { "data-task-checked": String(node.attrs.checked) }, 0],
    },
    text: { group: "inline" },
  },
  marks: {
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      parseDOM: [{
        tag: "a[href]",
        getAttrs: (element) => ({
          href: element.getAttribute("href"),
          title: element.getAttribute("title"),
        }),
      }],
      toDOM: (mark) => ["a", mark.attrs, 0],
    },
    em: {
      parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }],
      toDOM: () => ["em", 0],
    },
    strong: {
      parseDOM: [
        { tag: "strong" },
        { tag: "b", getAttrs: (node) => node.style.fontWeight !== "normal" && null },
        { style: "font-weight=400", clearMark: (mark) => mark.type.name === "strong" },
        { style: "font-weight", getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null },
      ],
      toDOM: () => ["strong", 0],
    },
    code: {
      code: true,
      excludes: "_",
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
    },
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
      toDOM: () => ["s", 0],
    },
  },
});

export const wysiwygSchema = baseSchema;
