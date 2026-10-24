// Scrolling the preview to a heading or a source line, briefly flashing the target, and
// highlighting matched text with the CSS Custom Highlight API (when the webview has it).

import type { PendingScroll } from '../../stores/tabs';
import { blockForLine } from './pipeline/lines';
import { ID_PREFIX } from './pipeline/ids';

const FLASH_MS = 1200;
const HIGHLIGHT_NAME = 'igrasp-match';

/** Restarts the flash animation of an element. */
export function flash(el: Element): void {
  el.classList.remove('flash');
  // Reading layout restarts the CSS animation when the class is added again.
  el.getBoundingClientRect();
  el.classList.add('flash');
  window.setTimeout(() => {
    el.classList.remove('flash');
  }, FLASH_MS);
}

/** The element of an anchor: `#x` targets `user-content-x`, exactly or ignoring case. */
export function findAnchor(container: ParentNode, id: string): HTMLElement | null {
  const exact =
    container.querySelector<HTMLElement>(`[id="${CSS.escape(ID_PREFIX + id)}"]`) ??
    container.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  if (exact) return exact;
  const wanted = (ID_PREFIX + id).toLowerCase();
  for (const el of container.querySelectorAll<HTMLElement>('[id]')) {
    if (el.id.toLowerCase() === wanted) return el;
  }
  return null;
}

export function clearMatchHighlight(): void {
  if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete(HIGHLIGHT_NAME);
}

/** Highlights every occurrence of the needles (case-insensitive) in an element's text. */
export function highlightMatches(root: Element, needles: string[]): boolean {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') {
    return false;
  }
  const nodes: { node: Text; start: number }[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += n.nodeValue ?? '';
  }
  const lower = text.toLowerCase();
  const locate = (offset: number) => {
    let i = nodes.length - 1;
    while (i > 0 && (nodes[i]?.start ?? 0) > offset) i -= 1;
    const entry = nodes[i];
    return entry ? { node: entry.node, offset: offset - entry.start } : null;
  };
  const ranges: Range[] = [];
  for (const needle of needles) {
    const n = needle.toLowerCase();
    if (n.trim() === '') continue;
    for (let at = lower.indexOf(n); at >= 0; at = lower.indexOf(n, at + n.length)) {
      const start = locate(at);
      const end = locate(at + n.length - 1);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset + 1);
      ranges.push(range);
    }
  }
  if (ranges.length === 0) return false;
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  return true;
}

/**
 * Applies a pending scroll to the rendered preview. Returns false while the target is not in the
 * DOM yet (the preview renders asynchronously), so the caller can retry on the next frame.
 */
export function revealPending(container: HTMLElement, pending: PendingScroll): boolean {
  const body = container.querySelector('.markdown-body');
  if (!body) return false;
  if (pending.anchor !== undefined) {
    const target = findAnchor(body, pending.anchor);
    if (!target) return false;
    target.scrollIntoView({ block: 'start' });
    flash(target);
    return true;
  }
  if (pending.line !== undefined) {
    const block = blockForLine(body, pending.line);
    if (!block) return body.querySelector('[data-line]') !== null;
    block.scrollIntoView({ block: 'center' });
    flash(block);
    if (pending.highlight) highlightMatches(block, pending.highlight);
    return true;
  }
  return true;
}
