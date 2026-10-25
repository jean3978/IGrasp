// Splits a markdown document into its top-level blocks (mdast), with the source lines and offsets
// of each, so two versions can be compared block by block. Front matter and reference
// definitions are blocks of their own.

import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export interface Block {
  /** Position in the document's block list. */
  index: number;
  /** mdast node type: `paragraph`, `heading`, `list`, `table`, `yaml`, `definition`... */
  kind: string;
  /** 1-based first and last source line (inclusive). */
  startLine: number;
  endLine: number;
  /** Source offsets of the block (end exclusive). */
  start: number;
  end: number;
  /** The block's source text. */
  raw: string;
  /** What separates this block from the previous one (or the document start). */
  gapBefore: string;
  /** `raw` with whitespace collapsed: two blocks with the same key are the same block. */
  key: string;
}

export interface BlockList {
  blocks: Block[];
  /** Text after the last block (usually a newline). */
  trailing: string;
}

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkMath);

export const normalizeBlockText = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

export function splitBlocks(text: string): BlockList {
  const tree = parser.parse(text);
  const blocks: Block[] = [];
  let cursor = 0;
  for (const node of tree.children) {
    const pos = node.position;
    if (!pos || pos.start.offset === undefined || pos.end.offset === undefined) continue;
    const raw = text.slice(pos.start.offset, pos.end.offset);
    blocks.push({
      index: blocks.length,
      kind: node.type,
      startLine: pos.start.line,
      endLine: pos.end.line,
      start: pos.start.offset,
      end: pos.end.offset,
      raw,
      gapBefore: text.slice(cursor, pos.start.offset),
      key: `${node.type}:${normalizeBlockText(raw)}`,
    });
    cursor = pos.end.offset;
  }
  return { blocks, trailing: text.slice(cursor) };
}

/** A short human name of a block kind, for labels. */
export function blockLabel(kind: string): string {
  switch (kind) {
    case 'paragraph':
      return 'paragraph';
    case 'heading':
      return 'heading';
    case 'list':
      return 'list';
    case 'table':
      return 'table';
    case 'code':
      return 'code block';
    case 'blockquote':
      return 'quote';
    case 'yaml':
      return 'front matter';
    case 'definition':
      return 'link definition';
    case 'thematicBreak':
      return 'separator';
    case 'html':
      return 'HTML block';
    case 'math':
      return 'formula';
    case 'footnoteDefinition':
      return 'footnote';
    default:
      return 'block';
  }
}
