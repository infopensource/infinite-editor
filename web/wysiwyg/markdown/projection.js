import { markdownFromDocument } from './serializer.js';
import { remarkReferenceBackend } from './backend.js';
import { MarkdownPositionMapper } from './position_mapper.js';

// ProseMirror nodes are immutable and structurally shared. Serialization and
// source-position indexes belong to those nodes, so an edit invalidates only
// its changed top-level blocks. Joining strings never requires reparsing them.
export class MarkdownProjection {
  constructor() {
    this.blocks = new WeakMap();
    this.documents = new WeakMap();
    this.originals = new WeakMap();
    this.stats = { serializedBlocks: 0, parsedBlocks: 0 };
  }

  remember(documentNode, markdown, mapper) {
    this.originals.set(documentNode, { markdown, mapper });
  }

  block(node) {
    let block = this.blocks.get(node);
    if (!block) {
      const doc = node.type.schema.nodes.doc.create(null, [node]);
      block = { doc, markdown: markdownFromDocument(doc), mapper: null };
      this.blocks.set(node, block);
      this.stats.serializedBlocks++;
    }
    return block;
  }

  mapping(block) {
    if (!block.mapper) {
      block.mapper = new MarkdownPositionMapper(remarkReferenceBackend.parse(block.markdown), block.doc, block.markdown);
      this.stats.parsedBlocks++;
    }
    return block.mapper;
  }

  snapshot(documentNode) {
    let result = this.documents.get(documentNode);
    if (result) return result;
    const chunks = [];
    const entries = [];
    let length = 0;
    let previous = null;
    documentNode.forEach((node, offset) => {
      const block = this.block(node);
      if (!block.markdown) return;
      if (chunks.length) {
        const separator = previous?.type === node.type && ['bullet_list', 'ordered_list'].includes(node.type.name)
          ? '\n\n\n' : '\n\n';
        chunks.push(separator);
        length += separator.length;
      }
      entries.push({ block, sourceFrom: length, sourceTo: length + block.markdown.length, pmFrom: offset, pmTo: offset + node.nodeSize });
      chunks.push(block.markdown);
      length += block.markdown.length;
      previous = node;
    });
    const locate = (value, toKey) => {
      let low = 0, high = entries.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (entries[middle][toKey] < value) low = middle + 1;
        else high = middle - 1;
      }
      return Math.min(low, entries.length - 1);
    };
    const map = (value, fromKey, toKey, localMethod, fallback) => {
      let index = locate(value, `${fromKey}To`);
      while (index >= 0 && index < entries.length) {
        const entry = entries[index];
        const local = this.mapping(entry.block);
        const last = local.segments.at(-1);
        // Closing markup and whitespace select the next content leaf, just
        // like the original whole-document mapper (including empty blocks).
        if ((!last || value > entry[`${fromKey}From`] + last[`${fromKey}To`]) && index + 1 < entries.length) {
          index++;
          continue;
        }
        return entry[`${toKey}From`] + local[localMethod](value - entry[`${fromKey}From`]);
      }
      return fallback;
    };
    const mapper = {
      sourceToProseMirror: position => map(Math.max(0, Math.min(Number(position) || 0, length)), 'source', 'pm', 'sourceToProseMirror', 1),
      proseMirrorToSource: position => map(Math.max(0, Math.min(Number(position) || 0, documentNode.content.size)), 'pm', 'source', 'proseMirrorToSource', 0),
    };
    result = { markdown: chunks.join(''), mapper };
    this.documents.set(documentNode, result);
    return result;
  }

  sourceMapper(documentNode, markdown) {
    const original = this.originals.get(documentNode);
    if (original?.markdown === markdown) return original.mapper;
    const snapshot = this.snapshot(documentNode);
    if (snapshot.markdown === markdown) return snapshot.mapper;
    // An externally supplied source may preserve noncanonical spelling.
    const mapper = new MarkdownPositionMapper(remarkReferenceBackend.parse(markdown), documentNode, markdown);
    this.remember(documentNode, markdown, mapper);
    return mapper;
  }
}
