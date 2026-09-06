const WHITESPACE = /\s/u;

function countNonWhitespace(value, from = 0, to = value.length) {
  let count = 0;
  for (let index = from; index < to;) {
    const codePoint = value.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    if (!WHITESPACE.test(character)) count += 1;
    index += character.length;
  }
  return count;
}

function leafText(node) {
  switch (node.type.name) {
    case "image":
      return node.attrs.alt ?? "";
    case "math_inline":
    case "math_block":
      return node.attrs.value ?? "";
    case "opaque_inline":
    case "opaque_block":
      return node.attrs.source ?? "";
    default:
      return "";
  }
}

/** Count only visible, selected ProseMirror content without serializing the document. */
export function selectedCharacterCount(state) {
  const { from, to, empty } = state.selection;
  if (empty) return null;

  let count = 0;
  state.doc.nodesBetween(from, to, (node, position) => {
    if (node.isText) {
      const start = Math.max(0, from - position);
      const end = Math.min(node.text.length, to - position);
      count += countNonWhitespace(node.text, start, end);
    } else if (node.isLeaf && from <= position && to >= position + node.nodeSize) {
      count += countNonWhitespace(leafText(node));
    }
  });
  return count;
}
