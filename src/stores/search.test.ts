import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '../ipc/client';
import type { FileMatches, SearchResultsEvent } from '../ipc/types';
import { useSearch } from './search';
import { useWorkspace } from './workspace';

const s = () => useSearch.getState();

const file = (relPath: string, line = 1): FileMatches => ({
  relPath,
  matches: [{ line, text: 'the agent', ranges: [[4, 9]] }],
});

const batch = (searchId: number, files: FileMatches[], done = false): SearchResultsEvent => ({
  searchId,
  generation: useWorkspace.getState().index.generation,
  files,
  done,
  cancelled: false,
  truncated: false,
  stats: {
    filesSearched: 1,
    filesMatched: files.length,
    matches: files.length,
    skipped: 0,
    elapsedMs: 1,
  },
});

/** A `searchText` call that resolves only when the test says so. */
function deferredIds() {
  const resolvers: ((id: number) => void)[] = [];
  vi.spyOn(backend, 'searchText').mockImplementation(
    () =>
      new Promise<number>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  const cancel = vi.spyOn(backend, 'cancelSearch').mockResolvedValue(undefined);
  return { resolvers, cancel };
}

beforeEach(() => {
  s().clear();
  useSearch.setState({ query: '', matchCase: false, results: [], collapsed: new Set() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('search store', () => {
  it('keeps batches that arrive before searchText returns, including the final one', async () => {
    const { resolvers } = deferredIds();
    useSearch.setState({ query: 'agent' });
    const run = s().run();
    // Rust emits the whole search before the invoke reply reaches the webview.
    s().onResults(batch(7, [file('a.md')]));
    s().onResults(batch(7, [file('b.md')], true));
    resolvers[0]?.(7);
    await run;
    expect(s().results.map((f) => f.relPath)).toEqual(['a.md', 'b.md']);
    expect(s().status).toBe('done');
  });

  it('abandons and cancels an older run that resolves after a newer one started', async () => {
    const { resolvers, cancel } = deferredIds();
    useSearch.setState({ query: 'agent' });
    const first = s().run();
    // Same query, an option toggled while the first call is in flight.
    s().setOption('matchCase', true);
    resolvers[0]?.(1);
    await first;
    expect(cancel).toHaveBeenCalledWith(1);
    expect(s().searchId).toBeNull();
    s().onResults(batch(1, [file('old.md')]));
    resolvers[1]?.(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(s().searchId).toBe(2);
    s().onResults(batch(2, [file('new.md')], true));
    expect(s().results.map((f) => f.relPath)).toEqual(['new.md']);
  });

  it('follows renamed files and drops removed ones', () => {
    useSearch.setState({
      results: [file('gone.md'), file('notes.md'), file('z.md')],
      selected: { path: 'notes.md', index: 0 },
      collapsed: new Set(['notes.md']),
    });
    s().onDiskChanges({
      generation: 1,
      added: [],
      modified: [],
      removed: ['gone.md', 'notes.md'],
      renamed: [{ from: 'notes.md', to: 'a/notes-v2.md' }],
      dirsChanged: [],
    });
    expect(s().results.map((f) => f.relPath)).toEqual(['a/notes-v2.md', 'z.md']);
    expect(s().selected?.path).toBe('a/notes-v2.md');
    expect([...s().collapsed]).toEqual(['a/notes-v2.md']);
    expect(s().changed.has('a/notes-v2.md')).toBe(true);
  });
});
