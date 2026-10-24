// Marks block elements with the source line they start on (`data-line`), so a search result or a
// broken link can scroll the preview to the right place. Runs before sanitization; the schema
// allows `dataLine` explicitly (a number, harmless even when written by hand in raw HTML).

import type { Root } from 'hast';
import { visit } from 'unist-util-visit';

const BLOCKS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'pre',
  'blockquote',
  'table',
  'tr',
  'div',
  'dt',
  'dd',
  'hr',
  'img',
  'video',
]);

export function rehypeSourceLines() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      const line = node.position?.start.line;
      if (line !== undefined && BLOCKS.has(node.tagName)) node.properties.dataLine = line;
    });
  };
}

/**
 * The element to scroll to for a 1-based source line: the last marked block starting at or before
 * it (document order), so a line inside a paragraph or a list lands on that block.
 */
export function blockForLine(container: ParentNode, line: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLine = -1;
  for (const el of container.querySelectorAll<HTMLElement>('[data-line]')) {
    const value = Number(el.dataset.line);
    // Nested blocks (li > p) share lines: prefer the innermost one, which comes later.
    if (value <= line && value >= bestLine) {
      best = el;
      bestLine = value;
    }
  }
  return best;
}
