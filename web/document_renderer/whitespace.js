// Markdown's HTML serializer inserts newlines around block tags. With
// break-spaces these become anonymous line boxes (including before a list's
// first paragraph). Keep authored inline whitespace, but discard formatting
// newlines at structural block boundaries before measuring or displaying HTML.
const containers = 'ul, ol, li, blockquote, table, thead, tbody, tfoot, tr';
const blocks = 'p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, table, thead, tbody, tfoot, tr, th, td, hr';

export function normalizeBlockWhitespace(root) {
  const parents = [root, ...root.querySelectorAll(containers)];
  for (const parent of parents) {
    // The root can itself be a paragraph cloned for pagination.
    if (parent === root && !parent.matches(containers)
      && !parent.classList.contains('markdown-rendered-html')
      && !parent.classList.contains('document-pagination-source')) continue;
    for (const node of [...parent.childNodes]) {
      if (node.nodeType !== 3 || !node.data.includes('\n')) continue;
      const previous = node.previousSibling;
      const next = node.nextSibling;
      let text = node.data;
      if (!previous || previous.nodeType === 1 && previous.matches(blocks)) {
        text = text.replace(/^[\t ]*\r?\n/, '');
      }
      if (!next || next.nodeType === 1 && next.matches(blocks)) {
        text = text.replace(/\r?\n[\t ]*$/, '');
      }
      if (text !== node.data) {
        if (text) node.data = text;
        else node.remove();
      }
    }
  }
}
