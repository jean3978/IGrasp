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
  'ul',
  'ol',
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

/** Start lines of the blockquotes, in document order, before alerts replace some of them. */
const quoteLines = new WeakMap<Root, number[]>();

/**
 * Runs before the GitHub alerts plugin, which rebuilds an alert without source positions: the
 * lines recorded here give the alert its `data-line` (the rendered diff cuts blocks on it).
 */
export function rehypeQuoteLines() {
  return (tree: Root) => {
    const lines: number[] = [];
    visit(tree, 'element', (node) => {
      if (node.tagName === 'blockquote') lines.push(node.position?.start.line ?? NaN);
    });
    quoteLines.set(tree, lines);
  };
}

export function rehypeSourceLines() {
  return (tree: Root) => {
    const quotes = quoteLines.get(tree) ?? [];
    let quote = 0;
    visit(tree, 'element', (node) => {
      if (!BLOCKS.has(node.tagName)) return;
      let line = node.position?.start.line;
      // An alert replaced its blockquote, in the same place in document order.
      const isQuote = node.tagName === 'blockquote' || node.properties['dataAlert'] !== undefined;
      if (isQuote) {
        const recorded = quotes[quote];
        if (line === undefined && recorded !== undefined && !Number.isNaN(recorded)) {
          line = recorded;
        }
        quote += 1;
      }
      if (line !== undefined) node.properties.dataLine = line;
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
