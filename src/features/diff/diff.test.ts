import { describe, expect, it } from 'vitest';
import { blockDiff } from './blockDiff';
import { splitBlocks, splitBlocksFrom } from './blocks';
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

describe('splitBlocksFrom', () => {
  const expectSame = (oldText: string, newText: string) => {
    expect(splitBlocksFrom(oldText, splitBlocks(oldText), newText)).toEqual(splitBlocks(newText));
  };
  const doc = [
    '---',
    'title: T',
    '---',
    '',
    '# Title',
    '',
    'A paragraph',
    'on two lines.',
    '',
    '- one',
    '- two',
    '',
    '> quote',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '',
    '$$',
    'x^2',
    '$$',
    '',
    '<div>html</div>',
    '',
    'Last paragraph.',
    '',
  ].join('\n');
  const lines = doc.split('\n');
  const edit = (at: number, remove: number, ...insert: string[]) => {
    const copy = [...lines];
    copy.splice(at, remove, ...insert);
    return copy.join('\n');
  };

  it('matches a full split for edits that change the blocks around them', () => {
    const cases = [
      edit(6, 1, 'A changed paragraph'),
      edit(8, 0, '==='), // the paragraph becomes a setext heading
      edit(8, 1, 'lazy continuation'), // no blank line before the list
      edit(11, 0, '- three'),
      edit(2, 1), // unclosed front matter: lists and quotes after it are paragraphs
      edit(11, 1, '  continued item', ''), // indented: stays in the list
      edit(13, 0, 'lazy quote line'),
      edit(18, 0, '```'), // opens a fence that swallows the rest
      edit(22, 0, '$$'), // an unclosed formula
      edit(0, 0, 'Before the front matter'),
      edit(0, 3, '---', 'title: U', '---'),
      edit(4, 0, '---', 'not front matter', '---', ''),
      edit(28, 1, 'Last paragraph, changed.'),
      edit(28, 2),
      edit(4, 25),
      doc + 'Appended.\n',
      '',
      doc.replace(/\n/g, '\r\n'),
    ];
    for (const newText of cases) {
      expectSame(doc, newText);
      expectSame(newText, doc);
    }
  });

  it('matches a full split for random line edits', () => {
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    // Lines that open, close, continue or interrupt blocks (30 000 rounds passed locally).
    const pool = [
      '',
      'text',
      '#',
      '===',
      '---',
      '- item',
      '  - nested',
      '- [ ] task',
      '1. one',
      '2. two',
      '> q',
      '>',
      '```',
      '~~~',
      '    code',
      '\tcode',
      '$$',
      '| 1 | 2 |',
      '<div>',
      '<!--',
      '[x]: http://e.com',
      '[^1]: note',
    ];
    const mutate = (from: string[], edits: number) => {
      const copy = [...from];
      for (; edits > 0; edits--) {
        copy.splice(
          random(copy.length + 1),
          random(3),
          ...Array.from({ length: random(3) }, () => pool[random(pool.length)] ?? ''),
        );
      }
      return copy;
    };
    for (let i = 0; i < 300; i++) {
      const before = mutate(i % 2 ? lines : [...lines, ...lines, ...lines], random(3));
      expectSame(before.join('\n'), mutate(before, 1 + random(4)).join('\n'));
    }
    // 300 rounds take about 5 s on CI with coverage.
  }, 30_000);

  it('keeps the blocks around an edit, and the same list for an unchanged text', () => {
    const newText = edit(6, 1, 'A changed paragraph');
    const previous = splitBlocks(doc);
    const next = splitBlocksFrom(doc, previous, newText);
    expect(next.blocks.map((b) => b.kind)).toEqual(previous.blocks.map((b) => b.kind));
    expect(next.blocks[2]?.raw).toBe('A changed paragraph\non two lines.');
    expect(splitBlocksFrom(doc, previous, doc)).toBe(previous);
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
