// Literal, case-insensitive matches with UTF-16 offsets for both editor engines.
export function findTextMatches(text, query, offset = 0) {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(text.matchAll(new RegExp(escaped, 'giu')), match => ({
    from: offset + match.index, to: offset + match.index + match[0].length,
  }));
}
export function searchIndex(index, total) {
  return total ? ((index % total) + total) % total : -1;
}
