// Formatting that Markdown cannot express without changing the block type.
// Keep these comments at the end of a paragraph, outside its inline content.
export const BLOCK_METADATA = /^<!-- infinite-editor:(?:align=(left|center|right|justify)|(indent|list-indent)=([1-9]\d*)|(continuation)=1) -->$/u;

export function blockMetadata(nodes) {
  const children = [...nodes];
  const attrs = { textAlign: null, indent: 0, listIndent: 0, continuation: false };
  while (children.at(-1)?.kind === "opaque_inline") {
    const match = BLOCK_METADATA.exec(children.at(-1).source);
    if (!match) break;
    children.pop();
    if (match[1]) attrs.textAlign = match[1];
    else if (match[4]) attrs.continuation = true;
    else attrs[match[2] === "indent" ? "indent" : "listIndent"] = Number(match[3]);
  }
  return { children, attrs };
}
