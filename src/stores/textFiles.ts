// Contents of the non-markdown files shown in code viewer tabs.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import { BackendError } from '../ipc/types';
import type { ErrorCode } from '../ipc/types';

export interface TextFileState {
  status: 'loading' | 'ready' | 'error';
  content: string;
  size: number;
  modifiedMs: number;
  truncated: boolean;
  error: string | null;
  errorCode: ErrorCode | null;
  /** The file changed on disk since it was loaded (detected when the tab regains focus). */
  stale: boolean;
}

interface TextFilesState {
  byPath: Record<string, TextFileState>;
  load: (relPath: string) => Promise<void>;
  /** Re-reads the file (the "Reload" of the changed-on-disk banner). */
  reload: (relPath: string) => Promise<void>;
  /**
   * Checks whether the file changed on disk. Non-markdown files are not watched, so the viewer
   * calls this when it is shown again; it never replaces the content by itself.
   */
  checkStale: (relPath: string) => Promise<void>;
  retain: (keep: Set<string>) => void;
  clear: () => void;
}

const LOADING: TextFileState = {
  status: 'loading',
  content: '',
  size: 0,
  modifiedMs: 0,
  truncated: false,
  error: null,
  errorCode: null,
  stale: false,
};

export const useTextFiles = create<TextFilesState>()((set, get) => {
  const patch = (relPath: string, value: Partial<TextFileState>) => {
    set((s) => {
      const prev = s.byPath[relPath];
      if (!prev) return s; // evicted meanwhile
      return { byPath: { ...s.byPath, [relPath]: { ...prev, ...value } } };
    });
  };

  const read = async (relPath: string) => {
    try {
      const file = await backend.readTextFile(relPath);
      patch(relPath, {
        status: 'ready',
        content: file.content,
        size: file.size,
        modifiedMs: file.modifiedMs,
        truncated: file.truncated,
        error: null,
        errorCode: null,
        stale: false,
      });
    } catch (err) {
      const code = err instanceof BackendError ? err.code : null;
      const size = code === 'TooLarge' ? Number(/\((\d+) bytes\)/.exec(String(err))?.[1] ?? 0) : 0;
      patch(relPath, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        errorCode: code,
        size,
      });
    }
  };

  return {
    byPath: {},

    async load(relPath) {
      if (get().byPath[relPath]) return;
      set((s) => ({ byPath: { ...s.byPath, [relPath]: LOADING } }));
      await read(relPath);
    },

    async reload(relPath) {
      if (!get().byPath[relPath]) return;
      await read(relPath);
    },

    async checkStale(relPath) {
      const current = get().byPath[relPath];
      if (current?.status !== 'ready') return;
      try {
        const file = await backend.readTextFile(relPath);
        if (file.modifiedMs !== current.modifiedMs || file.size !== current.size) {
          patch(relPath, { stale: true });
        }
      } catch {
        patch(relPath, { stale: true });
      }
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
