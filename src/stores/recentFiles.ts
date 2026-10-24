// The Recent changes view: markdown files by last modification, newest first, with markers on
// the files changed since the folder was opened in this session.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { FileEntry, FsChangesEvent } from '../ipc/types';
import { useWorkspace } from './workspace';

export const PAGE_SIZE = 200;
export const REFRESH_DEBOUNCE_MS = 300;

interface RecentFilesState {
  files: FileEntry[];
  total: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** How many files the view asked for (grows with "Show more"). */
  limit: number;
  /** When the folder was opened (or the markers cleared): newer files are marked. */
  sessionStartMs: number;
  /** Files reported changed by the watcher since then. */
  changed: Set<string>;

  load: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Marks the changed files and reloads the list (debounced) if it was loaded. */
  onChanges: (changes: FsChangesEvent) => void;
  clearMarkers: () => void;
  /** Forgets everything (another folder was opened). */
  reset: () => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let request = 0;

export const isChangedInSession = (
  file: FileEntry,
  s: Pick<RecentFilesState, 'sessionStartMs' | 'changed'>,
) => file.modifiedMs > s.sessionStartMs || s.changed.has(file.relPath);

export const useRecentFiles = create<RecentFilesState>()((set, get) => ({
  files: [],
  total: 0,
  status: 'idle',
  error: null,
  limit: PAGE_SIZE,
  sessionStartMs: Date.now(),
  changed: new Set(),

  async load() {
    const id = ++request;
    if (get().status !== 'ready') set({ status: 'loading' });
    try {
      const listing = await backend.listRecentFiles(0, get().limit);
      if (id !== request || listing.generation !== useWorkspace.getState().index.generation) return;
      set({ files: listing.files, total: listing.total, status: 'ready', error: null });
    } catch (err) {
      if (id !== request) return;
      // Still indexing: the view reloads when the index is ready.
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },

  async loadMore() {
    set((s) => ({ limit: s.limit + PAGE_SIZE }));
    await get().load();
  },

  onChanges(changes) {
    const changed = new Set(get().changed);
    for (const f of [...changes.added, ...changes.modified]) changed.add(f.relPath);
    for (const rel of changes.removed) changed.delete(rel);
    set({ changed });
    if (get().status === 'idle') return;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().load();
    }, REFRESH_DEBOUNCE_MS);
  },

  clearMarkers() {
    set({ changed: new Set(), sessionStartMs: Date.now() });
  },

  reset() {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
    request += 1;
    set({
      files: [],
      total: 0,
      status: 'idle',
      error: null,
      limit: PAGE_SIZE,
      sessionStartMs: Date.now(),
      changed: new Set(),
    });
  },
}));

export type DayGroup = 'Today' | 'Yesterday' | 'This week' | 'Earlier';

/** The day group of a modification time, relative to `now` (local time). */
export function dayGroup(modifiedMs: number, now: number): DayGroup {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (modifiedMs >= today) return 'Today';
  if (modifiedMs >= today - day) return 'Yesterday';
  if (modifiedMs >= today - 6 * day) return 'This week';
  return 'Earlier';
}

interface HeaderRow {
  kind: 'header';
  group: DayGroup;
  count: number;
}

export type RecentRow = HeaderRow | { kind: 'file'; file: FileEntry };

/** Files (already newest first) with a header before each day group. */
export function groupRows(files: FileEntry[], now: number): RecentRow[] {
  const rows: RecentRow[] = [];
  const headers: HeaderRow[] = [];
  for (const file of files) {
    const group = dayGroup(file.modifiedMs, now);
    let header = headers[headers.length - 1];
    if (header?.group !== group) {
      header = { kind: 'header', group, count: 0 };
      headers.push(header);
      rows.push(header);
    }
    header.count += 1;
    rows.push({ kind: 'file', file });
  }
  return rows;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "4 minutes ago", "3 hours ago", "yesterday", "5 days ago", or a date. */
export function relativeTime(ms: number, now: number): string {
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86400) return relative.format(Math.round(seconds / 86400), 'day');
  return new Date(ms).toLocaleDateString();
}
