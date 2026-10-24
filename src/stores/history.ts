// Back / forward through the documents the user read (Alt+Left / Alt+Right). Every change of
// the active document tab is recorded, whatever caused it (tree, tab bar, link, search result,
// Ctrl+Tab); moving back or forward does not record. Kept in memory only.

import { create } from 'zustand';
import type { FsChangesEvent } from '../ipc/types';
import { selectActiveTab, useTabs } from './tabs';
import type { Tab } from './tabs';
import { useWorkspace } from './workspace';

export const MAX_HISTORY = 100;

export interface HistoryEntry {
  relPath: string;
  kind: 'document' | 'code';
}

interface HistoryState {
  entries: HistoryEntry[];
  /** Index of the current entry, -1 when empty. */
  position: number;

  /** Adds an entry after the current one, dropping the forward stack. */
  record: (entry: HistoryEntry) => void;
  back: () => void;
  forward: () => void;
  /** Forgets files removed on disk and follows renamed ones. */
  applyChanges: (changes: FsChangesEvent) => void;
  clear: () => void;
}

/** True while back/forward activates a tab, so that activation is not recorded. */
let navigating = false;

const same = (a: HistoryEntry | undefined, b: HistoryEntry) =>
  a?.relPath === b.relPath && a.kind === b.kind;

function show(entry: HistoryEntry) {
  navigating = true;
  try {
    const tabs = useTabs.getState();
    const tab = tabs.tabs.find((t) => t.kind === entry.kind && t.relPath === entry.relPath);
    if (tab) tabs.activate(tab.id);
    else if (entry.kind === 'code') tabs.openCode(entry.relPath);
    else tabs.openDocument(entry.relPath);
  } finally {
    navigating = false;
  }
}

export const useHistory = create<HistoryState>()((set, get) => ({
  entries: [],
  position: -1,

  record(entry) {
    const { entries, position } = get();
    if (same(entries[position], entry)) return;
    const next = [...entries.slice(0, position + 1), entry].slice(-MAX_HISTORY);
    set({ entries: next, position: next.length - 1 });
  },

  back() {
    const { entries, position } = get();
    const entry = entries[position - 1];
    if (!entry) return;
    set({ position: position - 1 });
    show(entry);
  },

  forward() {
    const { entries, position } = get();
    const entry = entries[position + 1];
    if (!entry) return;
    set({ position: position + 1 });
    show(entry);
  },

  applyChanges(changes) {
    const renamed = new Map(changes.renamed.map((r) => [r.from, r.to]));
    const removed = new Set(changes.removed.filter((p) => !renamed.has(p)));
    if (removed.size === 0 && renamed.size === 0) return;
    const { entries, position } = get();
    const next: HistoryEntry[] = [];
    let nextPosition = -1;
    entries.forEach((e, i) => {
      if (removed.has(e.relPath)) return;
      const entry = { ...e, relPath: renamed.get(e.relPath) ?? e.relPath };
      // Removing an entry can make two neighbors identical: keep one.
      if (!same(next[next.length - 1], entry)) next.push(entry);
      if (i <= position) nextPosition = next.length - 1;
    });
    set({ entries: next, position: nextPosition });
  },

  clear() {
    set({ entries: [], position: -1 });
  },
}));

export const selectCanGoBack = (s: HistoryState) => s.position > 0;
export const selectCanGoForward = (s: HistoryState) => s.position < s.entries.length - 1;

function entryOf(tab: Tab | undefined): HistoryEntry | null {
  if (!tab?.relPath || (tab.kind !== 'document' && tab.kind !== 'code')) return null;
  return { relPath: tab.relPath, kind: tab.kind };
}

/** Records active-tab changes and clears the history when the folder changes. */
export function startHistorySync(): () => void {
  const offs = [
    useTabs.subscribe((s, prev) => {
      if (navigating || s.activeId === prev.activeId) return;
      const entry = entryOf(selectActiveTab(s));
      if (entry) useHistory.getState().record(entry);
    }),
    useWorkspace.subscribe((s, prev) => {
      if (s.root?.path !== prev.root?.path) useHistory.getState().clear();
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
