import { parser, GFM } from "@lezer/markdown";

const markdownParser = parser.configure(GFM);
const unescape = value => value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/gu, "$1");
const identifier = value => unescape(value).trim().replace(/\s+/gu, " ").toLowerCase();

// Use the Markdown syntax tree so images, code, escaped brackets, nested
// destinations and reference links are distinguished from real hyperlinks.
export function sourceLinkContext(markdown, selection) {
  const tree = markdownParser.parse(markdown);
  const nodes = [];
  const definitions = new Map();
  const destination = node => {
    const url = node.getChild("URL");
    const title = node.getChild("LinkTitle");
    return {
      href: url ? unescape(markdown.slice(url.from, url.to).replace(/^<|>$/gu, "")) : "",
      rawTitle: title ? markdown.slice(title.from, title.to) : "",
    };
  };
  tree.iterate({ enter(node) {
    if (node.name === "LinkReference") {
      const label = node.node.getChild("LinkLabel");
      if (label) {
        const key = identifier(markdown.slice(label.from + 1, label.to - 1));
        if (!definitions.has(key)) definitions.set(key, destination(node.node));
      }
    }
    if (node.name === "Link" || node.name === "Autolink") nodes.push(node.node);
  } });
  const links = nodes.map(node => {
    const marks = node.getChildren("LinkMark");
    const textFrom = marks[0].to;
    const textTo = marks[1].from;
    let target = destination(node);
    if (!target.href) {
      const label = node.getChild("LinkLabel");
      const key = label && label.to - label.from > 2
        ? markdown.slice(label.from + 1, label.to - 1) : markdown.slice(textFrom, textTo);
      target = definitions.get(identifier(key)) ?? target;
    }
    if (node.name === "Autolink" && target.href.includes("@") && !target.href.includes(":")) target.href = `mailto:${target.href}`;
    return { from: node.from, to: node.to, textFrom, textTo, ...target };
  });
  let { from, to } = selection;
  const selected = links.filter(link => from === to
    ? link.from <= from && link.to >= to
    : link.from < to && link.to > from);
  for (const link of selected) { from = Math.min(from, link.from); to = Math.max(to, link.to); }
  let text = markdown.slice(from, to);
  for (const link of [...selected].reverse()) {
    text = text.slice(0, link.from - from) + markdown.slice(link.textFrom, link.textTo) + text.slice(link.to - from);
  }
  const single = selected.length === 1 && from === selected[0].from && to === selected[0].to ? selected[0] : null;
  return { from, to, text, links: selected, href: single?.href ?? "", rawTitle: single?.rawTitle ?? "" };
}

export function markdownLink(text, href, rawTitle = "") {
  const destination = href.replace(/[\\()<>]/gu, "\\$&");
  return `[${text || href}](${destination}${rawTitle ? ` ${rawTitle}` : ""})`;
}
