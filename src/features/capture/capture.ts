// Region capture, step 1: from a rectangle in client coordinates to the source lines it covers.
// Markdown tabs: every block with `data-line` (pipeline/lines.ts) that the rectangle intersects.
// Code tabs: every rendered `.code-line` (the viewer is virtualized: only visible rows exist).

import { splitLines } from '../code/codeLines';

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

/**
 * The lines of a markdown document covered by `rect`: from the smallest start line of the blocks
 * it intersects to the line before the next block's start (or the document end). When nothing
 * intersects (an image only, the margin), the nearest block's line with an empty text.
 */
export function captureMarkdownRegion(
  container: ParentNode,
  rect: CaptureRect,
  source: string,
): LineCapture | null {
  const marked = [...container.querySelectorAll<HTMLElement>('[data-line]')]
    .map((el) => ({ line: Number(el.dataset['line']), box: el.getBoundingClientRect() }))
    .filter((m) => Number.isFinite(m.line));
  if (marked.length === 0) return null;
  const hit = marked.filter((m) => intersects(rect, m.box));
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

/** The lines of a text file covered by `rect`, from the rendered rows of the code viewer. */
export function captureCodeRegion(
  container: ParentNode,
  rect: CaptureRect,
  source: string,
): LineCapture | null {
  const rows = [...container.querySelectorAll<HTMLElement>('.code-line[data-index]')]
    .map((el) => ({ line: Number(el.dataset['index']) + 1, box: el.getBoundingClientRect() }))
    .filter((m) => Number.isFinite(m.line));
  if (rows.length === 0) return null;
  const hit = rows.filter((m) => intersects(rect, m.box));
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
