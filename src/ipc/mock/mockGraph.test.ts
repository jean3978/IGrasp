import { describe, expect, it, vi } from 'vitest';
import { createMockBackend } from '.';
import { FIXTURE_FILES, FIXTURE_ROOT } from './fixture';
import { buildGraph, classify, parseMarkdown } from './mockGraph';

describe('mock graph extractor', () => {
  it('finds headings, anchors and links outside code', () => {
    const doc = parseMarkdown(
      '---\ntitle: x\n---\n# Title\n\nSub\n---\n\n```\n# not\n[no](x.md)\n```\n\n## `code` *em* [l](a.md)\n\n[a](b.md#c) ![img](i.png) <a name="top"></a>\n',
    );
    expect(doc.headings.map((h) => [h.level, h.slug, h.line])).toEqual([
      [1, 'title', 4],
      [2, 'sub', 6],
      [2, 'code-em-l', 14],
    ]);
    expect(doc.links.map((l) => l.href)).toEqual(['a.md', 'b.md#c']);
    expect(doc.anchors.has('top')).toBe(true);
  });

  it('classifies like the Rust resolver', () => {
    expect(classify('docs/a.md', '../src/My%20File.rs?raw=1#L3')).toEqual({
      kind: 'file',
      relPath: 'src/My File.rs',
      fragment: 'L3',
    });
    expect(classify('a.md', '../x.md')).toEqual({ kind: 'outside' });
    expect(classify('a.md', 'file:///etc')).toEqual({ kind: 'unsupported' });
    expect(classify('a.md', '#Top')).toEqual({ kind: 'anchor', fragment: 'Top' });
  });
});

describe('mock graph of the fixture', () => {
  const graph = buildGraph(
    new Map(Object.entries(FIXTURE_FILES)),
    Object.keys(FIXTURE_FILES).filter(
      (p) => /\.(md|markdown)$/i.test(p) && !/^(build|node_modules|\.github)\//.test(p),
    ),
  );
  const status = (doc: string, href: string) =>
    graph.get(doc)?.links.find((l) => l.href === href)?.status.kind;

  it('flags the fixture broken links', () => {
    expect(status('docs/architecture.md', 'old-design.md')).toBe('missingFile');
    expect(status('docs/guide/getting-started.md', 'advanced/deep-dive.markdown#internals')).toBe(
      'missingAnchor',
    );
    expect(status('docs/guide/getting-started.md', '../Architecture.md')).toBe('caseMismatch');
    expect(status('docs/guide/getting-started.md', '../../README.md#features')).toBe('ok');
    expect(status('README.md', 'src/main.ts#L9-L12')).toBe('ok');
    expect(status('docs/architecture.md', 'decisions/')).toBe('ok');
  });
});

describe('mock graph queries', () => {
  it('serves doc links, backlinks and the broken links report', async () => {
    const b = createMockBackend();
    await b.openRoot(FIXTURE_ROOT);
    await vi.waitFor(async () => {
      expect((await b.getGraphStatus()).ready).toBe(true);
    });
    const links = await b.getDocLinks('docs/architecture.md');
    expect(links.links.map((l) => [l.href, l.status.kind])).toEqual([
      ['guide/getting-started.md', 'ok'],
      ['decisions/', 'ok'],
      ['old-design.md', 'missingFile'],
    ]);
    const back = await b.getBacklinks('README.md');
    expect(back.items).toEqual([
      {
        fromPath: 'docs/guide/getting-started.md',
        line: expect.any(Number) as number,
        text: 'features',
        fragment: 'features',
      },
    ]);
    const report = await b.listBrokenLinks();
    expect(report.docs.map((d) => [d.relPath, d.links.length])).toEqual([
      ['docs/architecture.md', 1],
      ['docs/guide/getting-started.md', 2],
    ]);
  });
});

describe('mock graph events', () => {
  it('builds after the index and reports changes', async () => {
    const b = createMockBackend();
    const ready = vi.fn();
    const changed = vi.fn();
    await b.listen('graph://ready', ready);
    await b.listen('graph://changed', changed);
    await b.openRoot(FIXTURE_ROOT);
    await vi.waitFor(() => {
      expect(ready).toHaveBeenCalled();
    });
    expect((await b.getGraphStatus()).brokenCount).toBe(3);
    b.controls.writeFiles({ 'docs/old-design.md': '# Old design\n' });
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({
        brokenCount: 2,
        docs: ['docs/architecture.md', 'docs/old-design.md'],
      }),
    );
  });
});
