// GitHub treats `$…$` as inline math only when the content does not start or end with a space,
// so prose like "costs $5 and $10" stays text. remark-math does not apply that rule; this
// plugin turns such spans back into text.

import type { Root } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';

export function remarkGithubDollarMath() {
  return (tree: Root) => {
    visit(tree, 'inlineMath', (node, index, parent) => {
      if (parent === undefined || index === undefined) return;
      if (!/^\s|\s$/.test(node.value)) return;
      parent.children[index] = { type: 'text', value: `$${node.value}$` };
      return SKIP;
    });
  };
}
