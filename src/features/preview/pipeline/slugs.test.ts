// The Rust document graph (src-tauri/src/graph/slug.rs) computes heading anchors without
// rendering; this test runs the same shared fixture through the real preview pipeline so the two
// can never drift silently.

import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';
import cases from '../../../test/fixtures/slugs.json';
import { ID_PREFIX } from './ids';
import { renderMarkdown } from './processor';

function headingIds(tree: Root): string[] {
  const ids: string[] = [];
  visit(tree, 'element', (node: Element) => {
    if (/^h[1-6]$/.test(node.tagName) && typeof node.properties.id === 'string') {
      ids.push(node.properties.id.slice(ID_PREFIX.length));
    }
  });
  return ids;
}

describe('heading ids', () => {
  it.each(cases.map((c) => [c.name, c] as const))('match the shared fixture: %s', async (_, c) => {
    const markdown = c.headings.map((h) => `## ${h}`).join('\n\n');
    const { hast } = await renderMarkdown(markdown);
    expect(headingIds(hast)).toEqual(c.slugs);
  });
});
