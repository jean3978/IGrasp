import type { Nodes } from 'hast';

/** The text of a hast node and its descendants (what `hast-util-to-string` returns). */
export function textContent(node: Nodes): string {
  if (node.type === 'text') return node.value;
  if ('children' in node) return node.children.map((c) => textContent(c as Nodes)).join('');
  return '';
}
