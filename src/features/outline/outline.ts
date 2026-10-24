// The outline of a document, built from its rendered tree: exactly the headings (and ids) the
// preview shows, with no IPC.

import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { ID_PREFIX } from '../preview/pipeline/ids';
import { textContent } from '../preview/pipeline/hastText';

export interface OutlineItem {
  /** DOM id of the heading (with the `user-content-` prefix). */
  id: string;
  text: string;
  /** 1–6. */
  level: number;
  /** 0 for top-level items; a skipped level nests under the nearest shallower heading. */
  depth: number;
  /** id of the parent item, or null. */
  parent: string | null;
  hasChildren: boolean;
}

export function buildOutline(tree: Root): OutlineItem[] {
  const items: OutlineItem[] = [];
  const stack: OutlineItem[] = [];
  visit(tree, 'element', (node: Element) => {
    const match = /^h([1-6])$/.exec(node.tagName);
    const id = node.properties.id;
    if (!match?.[1] || typeof id !== 'string') return;
    // The generated footnotes heading is not part of the document's own structure.
    if (id === `${ID_PREFIX}footnote-label`) return;
    const level = Number(match[1]);
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    if (parent) parent.hasChildren = true;
    const item: OutlineItem = {
      id,
      text: textContent(node).trim() || '(untitled)',
      level,
      depth: stack.length,
      parent: parent?.id ?? null,
      hasChildren: false,
    };
    items.push(item);
    stack.push(item);
  });
  return items;
}

/**
 * The rows to show: with a filter, the matches and their ancestors (expanded); without, every
 * item whose ancestors are all expanded.
 */
export function visibleOutline(
  items: OutlineItem[],
  collapsed: ReadonlySet<string>,
  filter: string,
): OutlineItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const needle = filter.trim().toLowerCase();
  if (needle !== '') {
    const keep = new Set<string>();
    for (const item of items) {
      if (!item.text.toLowerCase().includes(needle)) continue;
      for (let cur: OutlineItem | undefined = item; cur; cur = byId.get(cur.parent ?? '')) {
        keep.add(cur.id);
      }
    }
    return items.filter((i) => keep.has(i.id));
  }
  const hidden = (item: OutlineItem): boolean => {
    for (let p = byId.get(item.parent ?? ''); p; p = byId.get(p.parent ?? '')) {
      if (collapsed.has(p.id)) return true;
    }
    return false;
  };
  return items.filter((i) => !hidden(i));
}

/** Index of the last offset at or above the top of the viewport (binary search), or -1. */
export function activeIndex(offsets: number[], scrollTop: number, slack = 8): number {
  let lo = 0;
  let hi = offsets.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((offsets[mid] ?? Infinity) <= scrollTop + slack) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
