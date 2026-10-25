// Tags the ```igrasp-* blocks of a tutorial chapter (after sanitization) so the preview renders
// them as folded step cards. The card reads the block's text as YAML; nothing in it becomes
// markup. Quick checks are `igrasp-quiz` blocks, tagged by `quizBlocks.ts`.

import type { Root } from 'hast';
import { visit } from 'unist-util-visit';
import { isTutorialBlockKind } from '../../academy/tutorialBlocks';
import { codeLanguage, textContent } from './highlight';

export function markTutorialBlocks(tree: Root): void {
  visit(tree, 'element', (node) => {
    if (node.tagName !== 'pre') return;
    const language = codeLanguage(node);
    if (!language?.startsWith('igrasp-')) return;
    const kind = language.slice('igrasp-'.length);
    if (!isTutorialBlockKind(kind)) return;
    node.properties.dataTutorialStep = kind;
    node.properties.dataTutorialSource = textContent(node);
  });
}
