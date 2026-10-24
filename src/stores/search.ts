// Search in files (Ctrl+Shift+F): the query and its options, the streamed results and the
// selected match (F4 / Shift+F4).

import { create } from 'zustand';
import { backend } from '../ipc/client';
import { BackendError } from '../ipc/types';
import type {
  FileMatches,
  FsChangesEvent,
  SearchResultsEvent,
  SearchStats,
  TextMatch,
} from '../ipc/types';
import { useTabs } from './tabs';
import { useWorkspace } from './workspace';

export const RUN_DEBOUNCE_MS = 200;
const MAX_HISTORY = 20;

export type SearchStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

export interface MatchRef {
  path: string;
  index: number;
}

interface SearchState {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string;
  exclude: string;
  /** The include/exclude rows are shown. */
  detailsOpen: boolean;
  status: SearchStatus;
  error: string | null;
  searchId: number | null;
  /** Sorted by path; a file's matches are in line order. */
  results: FileMatches[];
  collapsed: Set<string>;
  /** Files modified on disk since the search ran. */
  changed: Set<string>;
  stats: SearchStats | null;
  truncated: boolean;
  selected: MatchRef | null;
  history: string[];

  setQuery: (query: string) => void;
  setOption: (option: 'matchCase' | 'wholeWord' | 'regex', value: boolean) => void;
  setGlobs: (patterns: { include?: string; exclude?: string }) => void;
  setDetailsOpen: (open: boolean) => void;
  /** Runs after a pause in typing. */
  scheduleRun: () => void;
  run: () => Promise<void>;
  cancel: () => void;
  clear: () => void;
  onResults: (event: SearchResultsEvent) => void;
  onDiskChanges: (event: FsChangesEvent) => void;
  toggleFile: (path: string) => void;
  setAllCollapsed: (collapsed: boolean) => void;
  dismissFile: (path: string) => void;
  dismissMatch: (ref: MatchRef) => void;
  select: (ref: MatchRef | null) => void;
  openMatch: (ref: MatchRef, options?: { pin?: boolean }) => void;
  /** F4 / Shift+F4: the next or previous match, opened in the preview tab. */
  step: (delta: 1 | -1) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** The matched substrings of a match line, to highlight them in the preview. */
export function matchedTexts(match: TextMatch): string[] {
  const chars = Array.from(match.text);
  return [...new Set(match.ranges.map(([s, e]) => chars.slice(s, e).join('')))];
}

/** Merges a batch into results sorted by path (a file may come in several batches). */
export function mergeResults(results: FileMatches[], batch: FileMatches[]): FileMatches[] {
  if (batch.length === 0) return results;
  const byPath = new Map(results.map((f) => [f.relPath, f]));
  for (const file of batch) {
    const existing = byPath.get(file.relPath);
    byPath.set(
      file.relPath,
      existing ? { ...existing, matches: [...existing.matches, ...file.matches] } : file,
    );
  }
  return [...byPath.values()].sort((a, b) =>
    a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
  );
}

function flatRefs(results: FileMatches[]): MatchRef[] {
  return results.flatMap((f) => f.matches.map((_, index) => ({ path: f.relPath, index })));
}

export const useSearch = create<SearchState>()((set, get) => ({
  query: '',
  matchCase: false,
  wholeWord: false,
  regex: false,
  include: '',
  exclude: '',
  detailsOpen: false,
  status: 'idle',
  error: null,
  searchId: null,
  results: [],
  collapsed: new Set(),
  changed: new Set(),
  stats: null,
  truncated: false,
  selected: null,
  history: [],

  setQuery(query) {
    set({ query });
    get().scheduleRun();
  },

  setOption(option, value) {
    set({ [option]: value } as Pick<SearchState, typeof option>);
    if (get().query !== '') void get().run();
  },

  setGlobs(patterns) {
    set(patterns);
    if (get().query !== '') get().scheduleRun();
  },

  setDetailsOpen(open) {
    set({ detailsOpen: open });
  },

  scheduleRun() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void get().run();
    }, RUN_DEBOUNCE_MS);
  },

  async run() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const { query, matchCase, wholeWord, regex, include, exclude, searchId, status } = get();
    if (searchId !== null && status === 'running') void backend.cancelSearch(searchId);
    if (query === '') {
      get().clear();
      return;
    }
    set({
      status: 'running',
      error: null,
      results: [],
      changed: new Set(),
      stats: null,
      truncated: false,
      selected: null,
      searchId: null,
      history: [query, ...get().history.filter((h) => h !== query)].slice(0, MAX_HISTORY),
    });
    try {
      const id = await backend.searchText({ query, matchCase, wholeWord, regex, include, exclude });
      // Typing again while the command was in flight started another search.
      if (get().query !== query || get().status !== 'running') {
        void backend.cancelSearch(id);
        return;
      }
      set({ searchId: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        status: 'error',
        error: err instanceof BackendError && err.code === 'IndexNotReady' ? null : message,
      });
    }
  },

  cancel() {
    const { searchId, status } = get();
    if (searchId !== null && status === 'running') void backend.cancelSearch(searchId);
  },

  clear() {
    get().cancel();
    set({
      status: 'idle',
      error: null,
      searchId: null,
      results: [],
      changed: new Set(),
      stats: null,
      truncated: false,
      selected: null,
    });
  },

  onResults(event) {
    // Batches of another search or another folder generation are stale.
    if (event.searchId !== get().searchId) return;
    if (event.generation !== useWorkspace.getState().index.generation) return;
    set((s) => ({
      results: mergeResults(s.results, event.files),
      stats: event.stats,
      truncated: event.truncated,
      ...(event.done ? { status: event.cancelled ? 'cancelled' : 'done' } : {}),
    }));
  },

  onDiskChanges(event) {
    if (get().results.length === 0) return;
    const removed = new Set(event.removed);
    const changed = new Set(get().changed);
    for (const f of event.modified) changed.add(f.relPath);
    for (const r of event.renamed) changed.add(r.from);
    set((s) => ({
      results: s.results.filter((f) => !removed.has(f.relPath)),
      changed,
    }));
  },

  toggleFile(path) {
    const collapsed = new Set(get().collapsed);
    if (collapsed.has(path)) collapsed.delete(path);
    else collapsed.add(path);
    set({ collapsed });
  },

  setAllCollapsed(collapsed) {
    set({ collapsed: collapsed ? new Set(get().results.map((f) => f.relPath)) : new Set() });
  },

  dismissFile(path) {
    set((s) => ({ results: s.results.filter((f) => f.relPath !== path) }));
  },

  dismissMatch({ path, index }) {
    set((s) => ({
      results: s.results
        .map((f) =>
          f.relPath === path ? { ...f, matches: f.matches.filter((_, i) => i !== index) } : f,
        )
        .filter((f) => f.matches.length > 0),
    }));
  },

  select(ref) {
    set({ selected: ref });
  },

  openMatch(ref, options = {}) {
    const file = get().results.find((f) => f.relPath === ref.path);
    const match = file?.matches[ref.index];
    if (!match) return;
    set({ selected: ref });
    useTabs.getState().openDocument(ref.path, {
      pin: options.pin ?? false,
      scroll: { line: match.line, highlight: matchedTexts(match) },
    });
  },

  step(delta) {
    const refs = flatRefs(get().results);
    if (refs.length === 0) return;
    const { selected } = get();
    const at = selected
      ? refs.findIndex((r) => r.path === selected.path && r.index === selected.index)
      : -1;
    const next =
      at < 0 ? (delta > 0 ? 0 : refs.length - 1) : (at + delta + refs.length) % refs.length;
    const ref = refs[next];
    if (!ref) return;
    // Show the file of the match expanded.
    if (get().collapsed.has(ref.path)) get().toggleFile(ref.path);
    get().openMatch(ref);
  },
}));
