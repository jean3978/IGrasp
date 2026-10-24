// The Rust parser (src-tauri/src/graph/parse.rs) must find the same heading anchors as the
// preview. headings.json holds the ids the preview gives the fixture documents and Rust asserts
// the same file: when a fixture changes, update headings.json with what this test receives.

import type { Element } from 'hast';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';
import gfm from '../../../test/fixtures/markdown/gfm.md?raw';
import headings from '../../../test/fixtures/markdown/headings.md?raw';
import expected from '../../../test/fixtures/markdown/headings.json';
import unsafe from '../../../test/fixtures/markdown/unsafe.md?raw';
import { ID_PREFIX } from './ids';
import { renderMarkdown } from './processor';

const FILES: Record<string, string> = {
  'gfm.md': gfm,
  'headings.md': headings,
  'unsafe.md': unsafe,
};

async function headingIds(markdown: string): Promise<string[]> {
  const { hast } = await renderMarkdown(markdown);
  const ids: string[] = [];
  visit(hast, 'element', (node: Element) => {
    const id = node.properties.id;
    // The footnotes section has a generated heading with its own id, not a slugged one.
    if (
      /^h[1-6]$/.test(node.tagName) &&
      typeof id === 'string' &&
      id !== `${ID_PREFIX}footnote-label`
    ) {
      ids.push(id.slice(ID_PREFIX.length));
    }
  });
  return ids;
}

describe('heading ids of the markdown fixtures', () => {
  it('match headings.json, shared with the Rust parser', async () => {
    const actual: Record<string, string[]> = {};
    for (const [name, markdown] of Object.entries(FILES)) actual[name] = await headingIds(markdown);
    expect(actual).toEqual(expected);
  });
});
