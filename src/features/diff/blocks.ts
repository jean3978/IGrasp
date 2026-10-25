// Splits a markdown document into its top-level blocks (mdast), with the source lines and offsets
// of each, so two versions can be compared block by block. Front matter and reference
// definitions are blocks of their own.

import { diffArrays } from 'diff';
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

// Front matter only exists at the start of the document, never at the start of a slice.
const sliceParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

export const normalizeBlockText = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

/** Where a block is in the document, before its text is cut out. */
interface Span {
  kind: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}

/** The top-level blocks of `text[from, to)`, with offsets and lines in the whole text. */
function parseSpans(text: string, from: number, to: number, firstLine: number): Span[] {
  const tree = (from === 0 ? parser : sliceParser).parse(text.slice(from, to));
  const spans: Span[] = [];
  for (const node of tree.children) {
    const pos = node.position;
    if (!pos || pos.start.offset === undefined || pos.end.offset === undefined) continue;
    spans.push({
      kind: node.type,
      start: from + pos.start.offset,
      end: from + pos.end.offset,
      startLine: firstLine + pos.start.line - 1,
      endLine: firstLine + pos.end.line - 1,
    });
  }
  return spans;
}

function toBlockList(text: string, spans: Span[]): BlockList {
  const blocks: Block[] = [];
  let cursor = 0;
  for (const span of spans) {
    const raw = text.slice(span.start, span.end);
    blocks.push({
      index: blocks.length,
      kind: span.kind,
      startLine: span.startLine,
      endLine: span.endLine,
      start: span.start,
      end: span.end,
      raw,
      gapBefore: text.slice(cursor, span.start),
      key: `${span.kind}:${normalizeBlockText(raw)}`,
    });
    cursor = span.end;
  }
  return { blocks, trailing: text.slice(cursor) };
}

export function splitBlocks(text: string): BlockList {
  return toBlockList(text, parseSpans(text, 0, text.length, 1));
}

const sameSpan = (a: Span | undefined, kind: string, start: number, end: number): boolean =>
  a !== undefined && a.kind === kind && a.start === start && a.end === end;

/** Changed lines between two texts: `[oldStart, oldEnd)` became `[newStart, newEnd)` (1-based). */
interface LineChange {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

// Past this many changed lines, parsing the whole text costs less than finding what to reuse.
const MAX_CHANGED_LINES = 1000;

function lineChanges(oldText: string, newText: string): LineChange[] | undefined {
  const parts = diffArrays(oldText.split('\n'), newText.split('\n'), {
    maxEditLength: MAX_CHANGED_LINES,
  });
  if (!parts) return undefined;
  const changes: LineChange[] = [];
  let o = 1;
  let n = 1;
  for (const part of parts) {
    const count = part.value.length;
    if (!part.added && !part.removed) {
      o += count;
      n += count;
      continue;
    }
    let change = changes[changes.length - 1];
    if (change?.oldEnd !== o || change.newEnd !== n) {
      change = { oldStart: o, oldEnd: o, newStart: n, newEnd: n };
      changes.push(change);
    }
    if (part.removed) change.oldEnd = o += count;
    else change.newEnd = n += count;
  }
  return changes;
}

/** Offset of the start of each line (index 1 is line 1). */
function lineStarts(text: string): number[] {
  const starts = [0, 0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/**
 * `splitBlocks(text)` for a new version of a document already split (`previous` is
 * `splitBlocks(previousText)`): only the regions around the changed lines are parsed, the other
 * blocks are reused. A region runs from the last unchanged block before a change to the first
 * one after it; when they do not parse back as the same blocks (an edit that opens a code fence,
 * turns a paragraph into a setext heading...), the whole text is parsed.
 */
export function splitBlocksFrom(
  previousText: string,
  previous: BlockList,
  text: string,
): BlockList {
  if (text === previousText) return previous;
  const old = previous.blocks;
  // An unclosed front matter fence changes how the rest of the document parses (lists and quotes
  // are no longer recognized), so an edit near it can change every block after it.
  if (previousText.startsWith('---') && old[0]?.kind !== 'yaml') return splitBlocks(text);
  const changes = lineChanges(previousText, text);
  if (!changes) return splitBlocks(text);

  // Regions, as indexes in `old`: the last block wholly before a change (-1: the document start)
  // and the first block wholly after it (old.length: the end). Overlapping regions merge.
  const regions: { head: number; tail: number; lineShift: number }[] = [];
  let lineShift = 0;
  let head = -1;
  for (const change of changes) {
    while ((old[head + 1]?.endLine ?? Infinity) < change.oldStart) head++;
    let tail = Math.max(head + 1, regions[regions.length - 1]?.tail ?? 0);
    while ((old[tail]?.startLine ?? Infinity) < change.oldEnd) tail++;
    lineShift += change.newEnd - change.newStart - (change.oldEnd - change.oldStart);
    const region = regions[regions.length - 1];
    if (region && head <= region.tail) {
      region.tail = tail;
      region.lineShift = lineShift;
    } else {
      regions.push({ head, tail, lineShift });
    }
  }
  if (regions[0]?.head === -1 && text.startsWith('---')) return splitBlocks(text);

  const oldStarts = lineStarts(previousText);
  const newStarts = lineStarts(text);
  // An unchanged block, moved by the lines added or removed before it.
  const moved = (b: Block, shift: number): Span => {
    const start = (newStarts[b.startLine + shift] ?? 0) + b.start - (oldStarts[b.startLine] ?? 0);
    return {
      kind: b.kind,
      start,
      end: start + b.end - b.start,
      startLine: b.startLine + shift,
      endLine: b.endLine + shift,
    };
  };
  const spans: Span[] = [];
  let next = 0;
  let shift = 0;
  for (const region of regions) {
    for (; next < Math.max(region.head, 0); next++) {
      const b = old[next];
      if (b) spans.push(moved(b, shift));
    }
    const headBlock = old[region.head];
    const tailBlock = old[region.tail];
    const first = headBlock && moved(headBlock, shift);
    const last = tailBlock && moved(tailBlock, region.lineShift);
    const parsed = parseSpans(
      text,
      first?.start ?? 0,
      last?.end ?? text.length,
      first?.startLine ?? 1,
    );
    if (first && !sameSpan(parsed[0], first.kind, first.start, first.end)) return splitBlocks(text);
    if (last && !sameSpan(parsed[parsed.length - 1], last.kind, last.start, last.end)) {
      return splitBlocks(text);
    }
    spans.push(...parsed);
    next = region.tail + 1;
    shift = region.lineShift;
  }
  for (; next < old.length; next++) {
    const b = old[next];
    if (b) spans.push(moved(b, shift));
  }
  return toBlockList(text, spans);
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
