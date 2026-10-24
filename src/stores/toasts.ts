// Change notifications. The Rust watcher already coalesces events in 200 ms windows; here,
// changes arriving within a 1.5 s quiet window are batched: up to 3 become individual toasts,
// more become one grouped toast ("12 files modified · 3 added") that keeps updating in place
// while the burst continues.

import { create } from 'zustand';
import type { FsChangesEvent } from '../ipc/types';
import { useSettings } from './settings';

export const QUIET_WINDOW_MS = 1500;
export const SINGLE_TOAST_MS = 5000;
export const GROUPED_TOAST_MS = 8000;
export const MAX_INDIVIDUAL = 3;
export const MAX_VISIBLE = 4;

export type ChangeKind = 'added' | 'modified' | 'deleted';

export interface ChangeBatch {
  added: string[];
  modified: string[];
  deleted: string[];
}

export type Toast =
  | { id: string; type: 'change'; kind: ChangeKind; relPath: string; duration: number }
  | { id: string; type: 'grouped'; batch: ChangeBatch; duration: number; version: number }
  | { id: string; type: 'message'; level: 'info' | 'error'; text: string; duration: number };

interface ToastsState {
  toasts: Toast[];
  /** Changes not shown yet (inside the quiet window). */
  pending: ChangeBatch | null;
  /** Changes that happened while toasts were muted. */
  mutedCount: number;
  /** Id of the grouped toast whose details are open. */
  detailsId: string | null;

  ingestChanges: (changes: FsChangesEvent) => void;
  /** Shows a plain message (errors, recovered settings…). */
  notify: (level: 'info' | 'error', text: string) => void;
  dismiss: (id: string) => void;
  openDetails: (id: string | null) => void;
  resetMutedCount: () => void;
}

let nextId = 1;
const newId = () => `toast-${String(nextId++)}`;
let quietTimer: ReturnType<typeof setTimeout> | null = null;

const EMPTY: ChangeBatch = { added: [], modified: [], deleted: [] };

export const batchSize = (b: ChangeBatch) => b.added.length + b.modified.length + b.deleted.length;

/** Merges two batches; a path keeps only its latest kind. */
export function mergeBatches(a: ChangeBatch, b: ChangeBatch): ChangeBatch {
  const latest = new Map<string, ChangeKind>();
  for (const batch of [a, b]) {
    for (const kind of ['added', 'modified', 'deleted'] as const) {
      for (const path of batch[kind]) {
        const before = latest.get(path);
        // Added then modified is still "added"; deleted then added is "modified".
        if (before === 'added' && kind === 'modified') continue;
        latest.set(path, before === 'deleted' && kind === 'added' ? 'modified' : kind);
      }
    }
  }
  const out: ChangeBatch = { added: [], modified: [], deleted: [] };
  for (const [path, kind] of latest) out[kind].push(path);
  return out;
}

export function batchFromChanges(changes: FsChangesEvent): ChangeBatch {
  const movedFrom = new Set(changes.renamed.map((r) => r.from));
  const movedTo = new Set(changes.renamed.map((r) => r.to));
  return {
    added: changes.added.map((f) => f.relPath).filter((p) => !movedTo.has(p)),
    // A rename is reported once, as a change of the new path.
    modified: [...changes.modified.map((f) => f.relPath), ...movedTo],
    deleted: changes.removed.filter((p) => !movedFrom.has(p)),
  };
}

/** "12 files modified · 3 added · 1 deleted" */
export function describeBatch(b: ChangeBatch): string {
  const parts: string[] = [];
  const files = (n: number) => (n === 1 ? '1 file' : `${String(n)} files`);
  const first = (n: number, word: string) => `${files(n)} ${word}`;
  const counts: [number, string][] = [
    [b.modified.length, 'modified'],
    [b.added.length, 'added'],
    [b.deleted.length, 'deleted'],
  ];
  for (const [n, word] of counts) {
    if (n === 0) continue;
    parts.push(parts.length === 0 ? first(n, word) : `${String(n)} ${word}`);
  }
  return parts.join(' · ');
}

export const useToasts = create<ToastsState>()((set, get) => {
  const flush = () => {
    quietTimer = null;
    const batch = get().pending;
    set({ pending: null });
    if (!batch || batchSize(batch) === 0) return;

    let toasts = [...get().toasts];
    const grouped = toasts.find((t) => t.type === 'grouped');
    if (grouped) {
      // The burst continues: update the visible grouped toast in place.
      toasts = toasts.map((t) =>
        t.id === grouped.id
          ? { ...grouped, batch: mergeBatches(grouped.batch, batch), version: grouped.version + 1 }
          : t,
      );
    } else if (batchSize(batch) <= MAX_INDIVIDUAL) {
      for (const kind of ['added', 'modified', 'deleted'] as const) {
        for (const relPath of batch[kind]) {
          toasts.push({ id: newId(), type: 'change', kind, relPath, duration: SINGLE_TOAST_MS });
        }
      }
    } else {
      toasts.push({ id: newId(), type: 'grouped', batch, duration: GROUPED_TOAST_MS, version: 1 });
    }

    // Too many on screen: fold the oldest change toasts into the grouped one.
    const changes = toasts.filter((t) => t.type === 'change');
    if (toasts.length > MAX_VISIBLE && changes.length > 0) {
      const overflow = new Set(changes.slice(0, toasts.length - MAX_VISIBLE + 1).map((t) => t.id));
      const folded: ChangeBatch = { added: [], modified: [], deleted: [] };
      for (const t of changes) if (overflow.has(t.id)) folded[t.kind].push(t.relPath);
      toasts = toasts.filter((t) => !overflow.has(t.id));
      const existing = toasts.find((t) => t.type === 'grouped');
      if (existing) {
        toasts = toasts.map((t) =>
          t.id === existing.id
            ? {
                ...existing,
                batch: mergeBatches(existing.batch, folded),
                version: existing.version + 1,
              }
            : t,
        );
      } else {
        toasts.unshift({
          id: newId(),
          type: 'grouped',
          batch: folded,
          duration: GROUPED_TOAST_MS,
          version: 1,
        });
      }
    }
    set({ toasts });
  };

  return {
    toasts: [],
    pending: null,
    mutedCount: 0,
    detailsId: null,

    ingestChanges(changes) {
      const batch = batchFromChanges(changes);
      const n = batchSize(batch);
      if (n === 0) return;
      if (useSettings.getState().settings.toastsMuted) {
        set((s) => ({ mutedCount: s.mutedCount + n }));
        return;
      }
      set((s) => ({ pending: mergeBatches(s.pending ?? EMPTY, batch) }));
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(flush, QUIET_WINDOW_MS);
    },

    notify(level, text) {
      const toast: Toast = { id: newId(), type: 'message', level, text, duration: SINGLE_TOAST_MS };
      set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_VISIBLE) }));
    },

    dismiss(id) {
      set((s) => ({
        toasts: s.toasts.filter((t) => t.id !== id),
        detailsId: s.detailsId === id ? null : s.detailsId,
      }));
    },

    openDetails(id) {
      set({ detailsId: id });
    },

    resetMutedCount() {
      set({ mutedCount: 0 });
    },
  };
});

/** Drops pending changes and the quiet timer (tests, closing a folder). */
export function resetToasts(): void {
  if (quietTimer !== null) clearTimeout(quietTimer);
  quietTimer = null;
  useToasts.setState({ toasts: [], pending: null, mutedCount: 0, detailsId: null });
}
