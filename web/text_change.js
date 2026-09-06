// Keep unchanged CodeMirror rope nodes, syntax trees and history ranges when
// a rich-text projection arrives. The bridge API may carry a snapshot; that
// does not mean the editor transaction should replace the whole document.
export function minimalTextChange(previous, next) {
  if (previous === next) return null;
  let from = 0;
  const limit = Math.min(previous.length, next.length);
  while (from < limit && previous.charCodeAt(from) === next.charCodeAt(from)) from++;
  const lowSurrogate = code => code >= 0xDC00 && code <= 0xDFFF;
  if (from > 0 && (lowSurrogate(previous.charCodeAt(from)) || lowSurrogate(next.charCodeAt(from)))) from--;
  let suffix = 0;
  while (suffix < previous.length - from && suffix < next.length - from
    && previous.charCodeAt(previous.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)) suffix++;
  if (suffix > 0 && (lowSurrogate(previous.charCodeAt(previous.length - suffix))
    || lowSurrogate(next.charCodeAt(next.length - suffix)))) suffix--;
  return { from, to: previous.length - suffix, insert: next.slice(from, next.length - suffix) };
}
