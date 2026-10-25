// Selections for the AI chat: from boxes in client coordinates (a dragged rectangle, or the line
// boxes of highlighted text) to the source lines they cover, and the boxes that keep the
// selection highlighted while the chat is open.
// Markdown tabs: every block with `data-line` (pipeline/lines.ts) that a box intersects.
// Code tabs: every rendered `.code-line` (the viewer is virtualized: only visible rows exist).

import { splitLines } from '../code/codeLines';

/** The draft a region and a text selection pre-fill (cleared when nothing was added). */
export const DRAFT_PREFIX = 'About this region:';
export const TEXT_DRAFT_PREFIX = 'About this selection:';

/** A rectangle in client (viewport) coordinates. */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LineCapture {
  /** 1-based, inclusive. */
  firstLine: number;
  lastLine: number;
  /** The source text of those lines; empty when only a nearby block could be identified. */
  text: string;
}

/** Smallest selection (CSS pixels) the overlay accepts. */
export const MIN_CAPTURE_SIZE = 24;

export const isBigEnough = (r: CaptureRect): boolean =>
  r.width >= MIN_CAPTURE_SIZE && r.height >= MIN_CAPTURE_SIZE;

/** The rectangle spanned by two points, whatever the drag direction. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): CaptureRect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}

/** Keeps `r` inside `bounds` (shrinking it if needed). */
export function clampRect(r: CaptureRect, bounds: CaptureRect): CaptureRect {
  const width = Math.min(r.width, bounds.width);
  const height = Math.min(r.height, bounds.height);
  return {
    x: Math.min(Math.max(r.x, bounds.x), bounds.x + bounds.width - width),
    y: Math.min(Math.max(r.y, bounds.y), bounds.y + bounds.height - height),
    width,
    height,
  };
}

const intersects = (a: CaptureRect, b: DOMRect): boolean =>
  b.width > 0 &&
  b.height > 0 &&
  a.x < b.right &&
  a.x + a.width > b.left &&
  a.y < b.bottom &&
  a.y + a.height > b.top;

export const toCaptureRect = (r: DOMRect): CaptureRect => ({
  x: r.left,
  y: r.top,
  width: r.width,
  height: r.height,
});

/** The smallest rectangle around all `rects` (null for none). */
export function boundingRect(rects: readonly CaptureRect[]): CaptureRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const asList = (r: CaptureRect | readonly CaptureRect[]): readonly CaptureRect[] =>
  'x' in r ? [r] : r;

/** Vertical distance from the rectangle to an element box (0 when they overlap vertically). */
const verticalGap = (a: CaptureRect, b: DOMRect): number =>
  Math.max(b.top - (a.y + a.height), a.y - b.bottom, 0);

function sliceLines(source: string, first: number, last: number): LineCapture {
  const lines = splitLines(source);
  const lastLine = Math.min(Math.max(last, first), Math.max(lines.length, first));
  let end = lastLine;
  // Blank lines that only separate blocks are not part of the capture.
  while (end > first && (lines[end - 1] ?? '').trim() === '') end--;
  return {
    firstLine: first,
    lastLine: end,
    text: lines.slice(first - 1, end).join('\n'),
  };
}

/** Markdown source as the reader sees it: no link targets, tags, list or heading marks, emphasis. */
function plainText(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
    .replace(/[*_`~|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Narrows the block lines of a text selection to the source lines that hold the highlighted
 * text (four lines highlighted in a long paragraph or list are those four lines, not the
 * whole block). The rendered text is found in the markup-free source; when it cannot be found
 * (an unusual construct), the block lines stay. `before` is the rendered text of the block
 * before the highlight: a phrase found more than once is the occurrence nearest to it.
 */
export function narrowToSelection(
  source: string,
  block: LineCapture,
  selection: string,
  before = '',
): LineCapture {
  const lines = splitLines(source);
  const wanted = plainText(selection.replace(/\s+/g, ' '));
  if (wanted === '') return block;
  const expectedAt = plainText(before.replace(/\s+/g, ' ')).length;
  /** Where `needle` occurs at or after `start`, nearest to the highlight's position. */
  const nearest = (haystack: string, needle: string, start = 0): number => {
    let best = -1;
    for (let at = haystack.indexOf(needle, start); at >= 0; at = haystack.indexOf(needle, at + 1)) {
      if (best < 0 || Math.abs(at - expectedAt) < Math.abs(best - expectedAt)) best = at;
    }
    return best;
  };
  // The block's lines as one plain string, remembering where each line starts.
  let joined = '';
  const starts: { offset: number; line: number }[] = [];
  for (let n = block.firstLine; n <= block.lastLine; n++) {
    const plain = plainText(lines[n - 1] ?? '');
    if (plain === '') continue;
    if (joined !== '') joined += ' ';
    starts.push({ offset: joined.length, line: n });
    joined += plain;
  }
  let from = nearest(joined, wanted);
  let to = from + wanted.length;
  if (from < 0) {
    // Rendering may differ inside (a footnote mark, an inline formula): match both ends, with
    // shorter ends when a longer one runs into the difference.
    from = -1;
    for (const size of [40, 24, 12]) {
      const edge = Math.min(size, Math.floor(wanted.length / 2));
      if (edge < 8) break;
      const headAt = nearest(joined, wanted.slice(0, edge));
      const tail = wanted.slice(-edge);
      const tailAt = headAt < 0 ? -1 : joined.indexOf(tail, headAt);
      if (tailAt >= 0) {
        from = headAt;
        to = tailAt + tail.length;
        break;
      }
    }
    if (from < 0) return block;
  }
  const lineAt = (offset: number) =>
    starts.reduce((found, s) => (s.offset <= offset ? s.line : found), block.firstLine);
  return sliceLines(source, lineAt(from), lineAt(Math.max(from, to - 1)));
}

/**
 * The lines of a markdown document covered by `rects`: from the smallest start line of the
 * blocks they intersect to the line before the next block's start (or the document end). When
 * nothing intersects (an image only, the margin), the nearest block's line with an empty text.
 */
export function captureMarkdownRegion(
  container: ParentNode,
  rects: CaptureRect | readonly CaptureRect[],
  source: string,
): LineCapture | null {
  const boxes = asList(rects);
  const rect = boundingRect(boxes);
  const marked = [...container.querySelectorAll<HTMLElement>('[data-line]')]
    .map((el) => ({ line: Number(el.dataset['line']), box: el.getBoundingClientRect() }))
    .filter((m) => Number.isFinite(m.line));
  if (marked.length === 0 || !rect) return null;
  const hit = marked.filter((m) => boxes.some((r) => intersects(r, m.box)));
  if (hit.length === 0) {
    const centre = rect.y + rect.height / 2;
    let best = marked[0];
    let bestGap = Infinity;
    for (const m of marked) {
      const gap = Math.min(
        verticalGap(rect, m.box),
        Math.abs((m.box.top + m.box.bottom) / 2 - centre),
      );
      if (gap < bestGap) {
        best = m;
        bestGap = gap;
      }
    }
    return best ? { firstLine: best.line, lastLine: best.line, text: '' } : null;
  }
  const first = Math.min(...hit.map((m) => m.line));
  const lastStart = Math.max(...hit.map((m) => m.line));
  const next = Math.min(...marked.map((m) => m.line).filter((l) => l > lastStart), Infinity);
  const total = splitLines(source).length;
  return sliceLines(source, first, Number.isFinite(next) ? next - 1 : total);
}

/** The lines of a text file covered by `rects`, from the rendered rows of the code viewer. */
export function captureCodeRegion(
  container: ParentNode,
  rects: CaptureRect | readonly CaptureRect[],
  source: string,
): LineCapture | null {
  const boxes = asList(rects);
  const rect = boundingRect(boxes);
  const rows = [...container.querySelectorAll<HTMLElement>('.code-line[data-index]')]
    .map((el) => ({ line: Number(el.dataset['index']) + 1, box: el.getBoundingClientRect() }))
    .filter((m) => Number.isFinite(m.line));
  if (rows.length === 0 || !rect) return null;
  const hit = rows.filter((m) => boxes.some((r) => intersects(r, m.box)));
  if (hit.length === 0) {
    const centre = rect.y + rect.height / 2;
    const nearest = rows.reduce((a, b) =>
      Math.abs((a.box.top + a.box.bottom) / 2 - centre) <=
      Math.abs((b.box.top + b.box.bottom) / 2 - centre)
        ? a
        : b,
    );
    return { firstLine: nearest.line, lastLine: nearest.line, text: '' };
  }
  const first = Math.min(...hit.map((m) => m.line));
  const last = Math.max(...hit.map((m) => m.line));
  return sliceLines(source, first, last);
}

/** The blocks (markdown) or text cells (code) a dragged rectangle intersects, in document order. */
export function elementsInRect(container: ParentNode, rect: CaptureRect): HTMLElement[] {
  const blocks = [
    ...container.querySelectorAll<HTMLElement>('[data-line], .code-line[data-index] .code-text'),
  ];
  const hit = blocks.filter((el) => intersects(rect, el.getBoundingClientRect()));
  // Nested blocks (a list and its items) are covered by their outermost hit.
  return hit.filter((el) => !hit.some((other) => other !== el && other.contains(el)));
}

/** A range over the contents of `elements` (in document order), from the first to the last. */
export function rangeOver(elements: readonly HTMLElement[]): Range | null {
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.childNodes.length);
  return range;
}

/**
 * The line boxes of the text inside `range`, in client coordinates: one per line of every text
 * node, cut to the range. The boxes of whole elements are left out (a selected list does not
 * paint its full width), and boxes of one line that touch are merged.
 */
export function textRects(range: Range): CaptureRect[] {
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument ?? document;
  const nodes: Node[] = [];
  if (root.nodeType === Node.TEXT_NODE) {
    nodes.push(root);
  } else {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (range.intersectsNode(n) && (n.textContent ?? '').trim() !== '') nodes.push(n);
    }
  }
  const boxes: CaptureRect[] = [];
  for (const node of nodes) {
    const part = doc.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    // jsdom has no layout, and no boxes for ranges.
    if (typeof part.getClientRects !== 'function') continue;
    for (const r of part.getClientRects()) {
      if (r.width >= 1 && r.height >= 1) boxes.push(toCaptureRect(r));
    }
  }
  return mergeLineRects(boxes);
}

/** Merges boxes of one line that touch or overlap (fewer, cleaner highlight boxes). */
export function mergeLineRects(rects: readonly CaptureRect[]): CaptureRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: CaptureRect[] = [];
  for (const r of sorted) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      Math.abs(prev.y - r.y) < 2 &&
      Math.abs(prev.height - r.height) < 2 &&
      r.x <= prev.x + prev.width + 1
    ) {
      prev.width = Math.max(prev.x + prev.width, r.x + r.width) - prev.x;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** From client coordinates to coordinates in `container`'s scrolled content. */
export function toContentRect(container: HTMLElement, r: CaptureRect): CaptureRect {
  const origin = container.getBoundingClientRect();
  return {
    x: r.x - origin.left + container.scrollLeft,
    y: r.y - origin.top + container.scrollTop,
    width: r.width,
    height: r.height,
  };
}
