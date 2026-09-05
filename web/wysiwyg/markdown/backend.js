import { unified } from "unified";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { infiniteAstFromRemark } from "./infinite_ast.js";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective);

// This adapter exists only for the isolated browser prototype and golden
// tests. The production bridge must inject the equivalent AST produced by the
// Rust markdown-rs boundary instead of coupling application code to Remark.
export const remarkReferenceBackend = Object.freeze({
  name: "remark-reference",
  parse(markdown) {
    return infiniteAstFromRemark(processor.parse(markdown), markdown);
  },
});

export function assertMarkdownAstBackend(backend) {
  if (!backend || typeof backend.parse !== "function") {
    throw new TypeError("Markdown AST backend 必须实现 parse(markdown)");
  }
  return backend;
}
