// Math rendering with KaTeX (trusted generator, runs after sanitization). KaTeX, its CSS and
// fonts are loaded only when a document actually contains math.

import type { Element, Root } from 'hast';
import type { Options as KatexOptions } from 'rehype-katex';
import type { Processor } from 'unified';
import { visit, EXIT } from 'unist-util-visit';
import type { VFile } from 'vfile';

let katexProcessor: Promise<Processor<undefined, Root, Root>> | null = null;

function isMath(node: Element): boolean {
  const classes = node.properties.className;
  return (
    node.tagName === 'code' &&
    Array.isArray(classes) &&
    (classes.includes('math-inline') || classes.includes('math-display'))
  );
}

export function hasMath(tree: Root): boolean {
  let found = false;
  visit(tree, 'element', (node) => {
    if (isMath(node)) {
      found = true;
      return EXIT;
    }
    return undefined;
  });
  return found;
}

function getKatexProcessor() {
  katexProcessor ??= (async () => {
    const [{ unified }, { default: rehypeKatex }] = await Promise.all([
      import('unified'),
      import('rehype-katex'),
      import('katex/dist/katex.min.css'),
    ]);
    // rehype-katex catches TeX errors itself and renders them as red source text, so an
    // invalid formula never fails the whole document.
    const options: KatexOptions = { output: 'htmlAndMathml', strict: 'ignore' };
    return unified().use(rehypeKatex, options) as unknown as Processor<undefined, Root, Root>;
  })();
  return katexProcessor;
}

export async function renderMath(tree: Root, file: VFile): Promise<void> {
  if (!hasMath(tree)) return;
  const processor = await getKatexProcessor();
  await processor.run(tree, file);
}
