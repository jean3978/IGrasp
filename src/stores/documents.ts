import { create } from 'zustand';
import { backend } from '../ipc/client';
import { BackendError } from '../ipc/types';

export interface DocumentState {
  status: 'loading' | 'ready' | 'error';
  content: string;
  size: number;
  modifiedMs: number;
  error: string | null;
  /** Incremented on every successful (re)load, so views can tell an external change. */
  revision: number;
}

interface DocumentsState {
  byPath: Record<string, DocumentState>;
  /** Loads a document unless it is already loaded or loading. */
  load: (relPath: string) => Promise<void>;
  /** Re-reads a document from disk (after an external change), keeping the old content meanwhile. */
  reload: (relPath: string) => Promise<void>;
  /** Moves a cached document to its new path after a rename on disk. */
  rename: (from: string, to: string) => void;
  /** Forgets every document not in `keep`. */
  retain: (keep: Set<string>) => void;
  clear: () => void;
}

const EMPTY: DocumentState = {
  status: 'loading',
  content: '',
  size: 0,
  modifiedMs: 0,
  error: null,
  revision: 0,
};

export const useDocuments = create<DocumentsState>()((set, get) => {
  const read = async (relPath: string) => {
    try {
      const file = await backend.readMarkdown(relPath);
      set((s) => {
        const prev = s.byPath[relPath];
        if (!prev) return s; // evicted while loading
        return {
          byPath: {
            ...s.byPath,
            [relPath]: {
              status: 'ready',
              content: file.content,
              size: file.size,
              modifiedMs: file.modifiedMs,
              error: null,
              revision: prev.revision + 1,
            },
          },
        };
      });
    } catch (err) {
      const message =
        err instanceof BackendError && err.code === 'TooLarge'
          ? 'This file is too large to open (over 20 MB).'
          : err instanceof Error
            ? err.message
            : String(err);
      set((s) => {
        const prev = s.byPath[relPath];
        if (!prev) return s;
        // A failed reload (file being rewritten, briefly locked or gone) keeps the last good
        // content on screen; the deleted banner or the next change takes over from there.
        if (prev.status === 'ready') {
          console.warn(`Cannot reload ${relPath}: ${message}`);
          return s;
        }
        return { byPath: { ...s.byPath, [relPath]: { ...prev, status: 'error', error: message } } };
      });
    }
  };

  return {
    byPath: {},

    async load(relPath) {
      if (get().byPath[relPath]) return;
      set((s) => ({ byPath: { ...s.byPath, [relPath]: EMPTY } }));
      await read(relPath);
    },

    async reload(relPath) {
      if (!get().byPath[relPath]) return;
      await read(relPath);
    },

    rename(from, to) {
      const doc = get().byPath[from];
      if (!doc) return;
      const rest = Object.fromEntries(Object.entries(get().byPath).filter(([k]) => k !== from));
      set({ byPath: { ...rest, [to]: doc } });
    },

    retain(keep) {
      const byPath = get().byPath;
      const kept = Object.fromEntries(Object.entries(byPath).filter(([path]) => keep.has(path)));
      if (Object.keys(kept).length !== Object.keys(byPath).length) set({ byPath: kept });
    },

    clear() {
      set({ byPath: {} });
    },
  };
});
