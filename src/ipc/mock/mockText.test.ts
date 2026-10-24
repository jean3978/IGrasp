import { describe, expect, it, vi } from 'vitest';
import { createMockBackend } from '.';
import type { SearchResultsEvent, TextSearchRequest } from '../types';
import { FIXTURE_ROOT } from './fixture';
import { buildRegExp, filterFiles, makeMatch, searchContent } from './mockText';

const req = (query: string, extra: Partial<TextSearchRequest> = {}): TextSearchRequest => ({
  query,
  matchCase: false,
  wholeWord: false,
  regex: false,
  include: '',
  exclude: '',
  ...extra,
});

describe('mock text search rules (same as Rust)', () => {
  const text = "Agent writes\nan agent's TODO\nreagent\n";
  const lines = (r: TextSearchRequest) =>
    searchContent(buildRegExp(r), text, 100).map((m) => m.line);

  it('applies match case, whole word and regex', () => {
    expect(lines(req('agent'))).toEqual([1, 2, 3]);
    expect(lines(req('agent', { matchCase: true }))).toEqual([2, 3]);
    expect(lines(req('agent', { wholeWord: true }))).toEqual([1, 2]);
    expect(lines(req('^\\w+ag', { regex: true }))).toEqual([3]);
    expect(lines(req('a.e'))).toEqual([]);
    expect(() => buildRegExp(req('(x', { regex: true }))).toThrow(/./);
  });

  it('reports character ranges and cuts long lines around the first match', () => {
    expect(makeMatch(buildRegExp(req('é')), 1, 'café et thé')?.ranges).toEqual([
      [3, 4],
      [10, 11],
    ]);
    const long = makeMatch(
      buildRegExp(req('needle')),
      1,
      `${'a'.repeat(2000)}needle${'b'.repeat(2000)}`,
    );
    expect(Array.from(long?.text ?? '')).toHaveLength(MAX_CHARS);
  });

  it('filters with VS Code globs', () => {
    const paths = ['docs/a.md', 'docs/drafts/b.md', 'notes/c.md', 'x/docs/d.md'];
    // A pattern without an inner slash matches at any depth, like VS Code.
    expect(filterFiles(paths, req('x', { include: 'docs/' }))).toEqual([
      'docs/a.md',
      'docs/drafts/b.md',
      'x/docs/d.md',
    ]);
    expect(filterFiles(paths, req('x', { include: './docs/drafts' }))).toEqual([
      'docs/drafts/b.md',
    ]);
    expect(filterFiles(paths, req('x', { include: 'docs', exclude: 'drafts' }))).toEqual([
      'docs/a.md',
      'x/docs/d.md',
    ]);
  });
});

const MAX_CHARS = 500;

describe('mock text search events', () => {
  async function collect(r: TextSearchRequest, cancelAfterStart = false) {
    const b = createMockBackend();
    await b.openRoot(FIXTURE_ROOT);
    await vi.waitFor(() => {
      expect(b.controls.state.index).not.toBeNull();
    });
    const events: SearchResultsEvent[] = [];
    await b.listen('search://results', (e) => events.push(e));
    const id = await b.searchText(r);
    if (cancelAfterStart) await b.cancelSearch(id);
    await vi.waitFor(() => {
      expect(events.at(-1)?.done).toBe(true);
    });
    return events;
  }

  it('streams matches by file and ends with done', async () => {
    const events = await collect(req('markdown'));
    const files = events.flatMap((e) => e.files.map((f) => f.relPath));
    expect(files).toContain('README.md');
    expect(events.at(-1)).toMatchObject({ cancelled: false, truncated: false });
  });

  it('can be cancelled', async () => {
    const events = await collect(req('markdown'), true);
    expect(events.at(-1)).toMatchObject({ done: true, cancelled: true });
  });

  it('stops at the result cap', async () => {
    const events = await collect(req('e', { maxResults: 3 }));
    expect(events.at(-1)?.truncated).toBe(true);
  });
});
