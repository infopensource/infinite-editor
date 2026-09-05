export const PAGE_BREAK_SOURCE = "<!-- infinite-editor:page-break -->";

export function isPageBreakSource(source) {
  return /^<!--\s*infinite-editor:page-break\s*-->$/u.test(source.trim());
}

export function sourceSlice(node, source) {
  const from = node?.position?.start?.offset;
  const to = node?.position?.end?.offset;
  if (Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from) {
    return source.slice(from, to);
  }
  if (typeof node?.value === "string") return node.value;
  return "";
}
