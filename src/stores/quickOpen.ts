// "Search everything" (Ctrl+T): a quick-open dialog over file names and headings, matched in Rust.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { SymbolHit } from '../ipc/types';
import { useHistory } from './history';
import { useTabs } from './tabs';

export const QUERY_DEBOUNCE_MS = 40;
const MAX_RECENT = 20;

interface QuickOpenState {
  open: boolean;
  query: string;
  files: SymbolHit[];
  headings: SymbolHit[];
  graphReady: boolean;
  /** Index in `files` then `headings`. */
  selected: number;

  openDialog: (prefill?: string) => void;
  close: () => void;
  setQuery: (query: string) => void;
  /** Runs the search now (the debounced path calls this). */
  search: () => Promise<void>;
  move: (delta: number) => void;
  select: (index: number) => void;
  /** Opens the selected hit; `keepOpen` leaves the dialog up for quick scanning. */
  confirm: (options?: { pin?: boolean; keepOpen?: boolean }) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastRequest = 0;

/** Files the user moved to, most recent first, without duplicates. */
export function recentFiles(): string[] {
  const { entries, position } = useHistory.getState();
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = Math.min(position, entries.length - 1); i >= 0 && out.length < MAX_RECENT; i--) {
    const entry = entries[i];
    if (entry?.kind !== 'document' || seen.has(entry.relPath)) continue;
    seen.add(entry.relPath);
    out.push(entry.relPath);
  }
  return out;
}

export const useQuickOpen = create<QuickOpenState>()((set, get) => ({
  open: false,
  query: '',
  files: [],
  headings: [],
  graphReady: true,
  selected: 0,

  openDialog(prefill = '') {
    set({ open: true, query: prefill, selected: 0 });
    void get().search();
  },

  close() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    set({ open: false });
  },

  setQuery(query) {
    set({ query });
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void get().search();
    }, QUERY_DEBOUNCE_MS);
  },

  async search() {
    const requestId = ++lastRequest;
    try {
      const result = await backend.searchSymbols({
        query: get().query,
        recent: recentFiles(),
        requestId,
      });
      // A newer keystroke already asked again: drop this answer.
      if (result.requestId !== lastRequest) return;
      set({
        files: result.files,
        headings: result.headings,
        graphReady: result.graphReady,
        selected: 0,
      });
    } catch {
      if (requestId === lastRequest) set({ files: [], headings: [] });
    }
  },

  move(delta) {
    const count = get().files.length + get().headings.length;
    if (count === 0) return;
    set({ selected: Math.max(0, Math.min(count - 1, get().selected + delta)) });
  },

  select(index) {
    set({ selected: index });
  },

  confirm(options = {}) {
    const { files, headings, selected } = get();
    const hit = selected < files.length ? files[selected] : headings[selected - files.length];
    if (!hit) return;
    const pin = options.pin ?? false;
    if (hit.kind === 'heading' && hit.slug !== null) {
      useTabs.getState().openDocument(hit.relPath, { pin, scroll: { anchor: hit.slug } });
    } else {
      useTabs.getState().openDocument(hit.relPath, { pin });
    }
    if (!options.keepOpen) get().close();
  },
}));
