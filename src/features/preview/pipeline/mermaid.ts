// Tags ```mermaid code blocks (after sanitization) so the preview renders them as diagrams.

import type { Root } from 'hast';
import { visit } from 'unist-util-visit';
import { codeLanguage, textContent } from './highlight';

export function markMermaidBlocks(tree: Root): void {
  visit(tree, 'element', (node) => {
    if (node.tagName === 'pre' && codeLanguage(node) === 'mermaid') {
      node.properties.dataMermaid = textContent(node).trim();
    }
  });
}
