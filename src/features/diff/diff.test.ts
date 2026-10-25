import { describe, expect, it } from 'vitest';
import { blockDiff } from './blockDiff';
import { splitBlocks } from './blocks';
import {
  acceptedHunks,
  buildEditReview,
  buildWriteReview,
  composeReview,
  composeWrite,
  resolveHunks,
} from './changes';

const raw = import.meta.glob<string>('../../test/fixtures/diff/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function pair(name: string): [string, string] {
  const get = (side: string) => {
    const entry = Object.entries(raw).find(([path]) => path.endsWith(`/${name}.${side}.md`));
    if (!entry) throw new Error(`missing fixture ${name}.${side}`);
    return entry[1];
  };
  return [get('old'), get('new')];
}

const names = [
  'paragraph-edit',
  'list-item-added',
  'heading-renamed',
  'table-row-removed',
  'front-matter-change',
  'whole-rewrite',
  'new-file',
];

describe('splitBlocks', () => {
  it('splits top-level blocks with their lines, front matter and definitions apart', () => {
    const text = '---\na: 1\n---\n\n# T\n\n- a\n- b\n\n[x]: http://e.com\n';
    const { blocks } = splitBlocks(text);
    expect(blocks.map((b) => [b.kind, b.startLine, b.endLine])).toEqual([
      ['yaml', 1, 3],
      ['heading', 5, 5],
      ['list', 7, 8],
      ['definition', 10, 10],
    ]);
  });

  it('reproduces the document from gaps, blocks and trailing text', () => {
    for (const name of names) {
      for (const text of pair(name)) {
        const { blocks, trailing } = splitBlocks(text);
        expect(blocks.map((b) => b.gapBefore + b.raw).join('') + trailing).toBe(text);
      }
    }
  });
});

describe('blockDiff', () => {
  const summary = (name: string) => {
    const [a, b] = pair(name);
    return blockDiff(a, b).changes.map((g) => [g.kind, g.label]);
  };

  it('detects one changed paragraph', () => {
    expect(summary('paragraph-edit')).toEqual([['changed', 'replaced paragraph']]);
  });
  it('detects a list that gained an item as one changed list', () => {
    expect(summary('list-item-added')).toEqual([['changed', 'replaced list']]);
  });
  it('detects a renamed heading', () => {
    expect(summary('heading-renamed')).toEqual([['changed', 'replaced heading']]);
  });
  it('detects a table that lost a row', () => {
    expect(summary('table-row-removed')).toEqual([['changed', 'replaced table']]);
  });
  it('detects a front matter change on its own', () => {
    expect(summary('front-matter-change')).toEqual([['changed', 'replaced front matter']]);
  });
  it('treats a rewrite as one group', () => {
    expect(summary('whole-rewrite')).toHaveLength(1);
  });
  it('treats a new file as one added group', () => {
    const [a, b] = pair('new-file');
    const diff = blockDiff(a, b);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]?.kind).toBe('added');
    expect(diff.changes[0]?.newBlocks.map((x) => x.kind)).toEqual(['heading', 'paragraph', 'code']);
  });
  it('ignores whitespace-only differences and has no changes for equal texts', () => {
    expect(blockDiff('a  b\n\n\nc\n', 'a b\n\nc\n').changes).toEqual([]);
  });
});

describe('composeWrite', () => {
  it('gives the old text for nothing accepted and the new text for everything', () => {
    for (const name of names) {
      const [a, b] = pair(name);
      const diff = blockDiff(a, b);
      expect(composeWrite(diff, new Set())).toBe(a);
      expect(composeWrite(diff, new Set(diff.changes.map((g) => g.changeIndex)))).toBe(b);
    }
  });

  it('applies only the accepted groups', () => {
    const a = '# T\n\none\n\ntwo\n\nthree\n';
    const b = '# T\n\nONE\n\ntwo\n\nTHREE\n\nfour\n';
    const diff = blockDiff(a, b);
    expect(diff.changes.map((g) => g.kind)).toEqual(['changed', 'changed']);
    expect(composeWrite(diff, new Set([0]))).toBe('# T\n\nONE\n\ntwo\n\nthree\n');
    expect(composeWrite(diff, new Set([1]))).toBe('# T\n\none\n\ntwo\n\nTHREE\n\nfour\n');
    const review = buildWriteReview(a, b);
    expect(review.units.map((u) => u.groups)).toEqual([[0], [1]]);
    expect(composeReview(review, new Set([1]))).toBe('# T\n\none\n\ntwo\n\nTHREE\n\nfour\n');
  });
});

describe('buildEditReview', () => {
  const doc = '# T\n\nAlpha beta gamma.\n\n- x\n- y\n\nLast paragraph.\n';

  it('makes one unit per hunk and composes the accepted ones', () => {
    const hunks = [
      { oldText: 'beta', newText: 'BETA' },
      { oldText: 'Last paragraph.', newText: 'Final paragraph.' },
    ];
    const review = buildEditReview(doc, hunks);
    expect(review.hasUnlocated).toBe(false);
    expect(review.units.map((u) => u.hunks)).toEqual([[0], [1]]);
    expect(review.units.map((u) => u.groups)).toEqual([[0], [1]]);
    expect(acceptedHunks(review, new Set([1]))).toEqual([hunks[1]]);
    expect(review.newText).toBe(doc.replace('beta', 'BETA').replace('Last', 'Final'));
  });

  it('merges hunks in the same paragraph into one unit', () => {
    const review = buildEditReview(doc, [
      { oldText: 'Alpha', newText: 'A' },
      { oldText: 'gamma', newText: 'G' },
    ]);
    expect(review.units).toHaveLength(1);
    expect(review.units[0]?.hunks).toEqual([0, 1]);
    expect(review.units[0]?.label).toBe('2 edits in this paragraph');
  });

  it('attributes an insertion and a deletion to their groups', () => {
    const review = buildEditReview(doc.replace('Last', 'Middle.\n\nLast'), [
      { oldText: '- y\n', newText: '- y\n- z\n' },
      { oldText: '\nLast paragraph.\n', newText: '' },
    ]);
    expect(review.units.map((u) => u.label)).toEqual(['replaced list', 'removed paragraph']);
  });

  it('reports hunks that are not in the content', () => {
    const review = buildEditReview(doc, [{ oldText: 'missing', newText: 'x' }]);
    expect(review.hasUnlocated).toBe(true);
    expect(review.units).toEqual([]);
    expect(resolveHunks(doc, []).newText).toBe(doc);
  });
});
