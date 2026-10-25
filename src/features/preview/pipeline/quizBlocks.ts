// Tags ```igrasp-quiz code blocks (after sanitization) so the preview renders them as folded
// question cards. The card reads the block's text as YAML; nothing in it becomes markup.

import type { Root } from 'hast';
import { visit } from 'unist-util-visit';
import { codeLanguage, textContent } from './highlight';

export function markQuizBlocks(tree: Root): void {
  visit(tree, 'element', (node) => {
    if (node.tagName === 'pre' && codeLanguage(node) === 'igrasp-quiz') {
      node.properties.dataQuiz = textContent(node);
    }
  });
}

/** The question blocks of a rendered document. */
export function countQuizBlocks(tree: Root): number {
  let n = 0;
  visit(tree, 'element', (node) => {
    if (node.properties.dataQuiz !== undefined) n++;
  });
  return n;
}
