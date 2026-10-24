// Math rendering with KaTeX (trusted generator, runs after sanitization). KaTeX, its CSS and
// fonts are loaded only when a document actually contains math.

import type { Element, Root } from 'hast';
import type { Options as KatexOptions } from 'rehype-katex';
import { unified } from 'unified';
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
    const [{ default: rehypeKatex }] = await Promise.all([
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

const isDisplayMathBlock = (node: Element): boolean =>
  node.tagName === 'pre' &&
  node.children.some(
    (c) =>
      c.type === 'element' &&
      isMath(c) &&
      Array.isArray(c.properties.className) &&
      c.properties.className.includes('math-display'),
  );

export async function renderMath(tree: Root, file: VFile): Promise<void> {
  if (!hasMath(tree)) return;
  // KaTeX replaces each display block: its source line (`data-line`) is carried over, in order.
  const lines: unknown[] = [];
  visit(tree, 'element', (node) => {
    if (isDisplayMathBlock(node)) lines.push(node.properties.dataLine);
  });
  const processor = await getKatexProcessor();
  await processor.run(tree, file);
  const displays: Element[] = [];
  visit(tree, 'element', (node) => {
    const classes = node.properties.className;
    if (Array.isArray(classes) && classes.includes('katex-display')) {
      displays.push(node);
      return 'skip';
    }
    return undefined;
  });
  if (displays.length !== lines.length) return;
  displays.forEach((node, i) => {
    const line = lines[i];
    if (typeof line === 'number' && node.properties.dataLine === undefined) {
      node.properties.dataLine = line;
    }
  });
}
