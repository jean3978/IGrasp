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
