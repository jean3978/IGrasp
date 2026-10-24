// Outlines of the open documents (published by the preview once rendered) and the outline
// view's own state. Nothing here is saved.

import { create } from 'zustand';
import type { OutlineItem } from '../features/outline/outline';

interface OutlineState {
  byPath: Record<string, OutlineItem[]>;
  /** Collapsed heading ids, per document, while it is open. */
  collapsed: Record<string, string[]>;
  filter: string;
  /** Highlight the heading of the section at the top of the viewport. */
  follow: boolean;

  setOutline: (relPath: string, items: OutlineItem[]) => void;
  toggle: (relPath: string, id: string) => void;
  setCollapsed: (relPath: string, id: string, collapsed: boolean) => void;
  setFilter: (filter: string) => void;
  setFollow: (follow: boolean) => void;
  retain: (keep: Set<string>) => void;
}

const keepOnly = <T>(record: Record<string, T>, keep: Set<string>) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => keep.has(k)));

export const useOutline = create<OutlineState>()((set, get) => ({
  byPath: {},
  collapsed: {},
  filter: '',
  follow: true,

  setOutline(relPath, items) {
    set((s) => ({ byPath: { ...s.byPath, [relPath]: items } }));
  },

  toggle(relPath, id) {
    const current = get().collapsed[relPath] ?? [];
    get().setCollapsed(relPath, id, !current.includes(id));
  },

  setCollapsed(relPath, id, collapsed) {
    set((s) => {
      const current = s.collapsed[relPath] ?? [];
      const next = collapsed ? [...new Set([...current, id])] : current.filter((c) => c !== id);
      return { collapsed: { ...s.collapsed, [relPath]: next } };
    });
  },

  setFilter(filter) {
    set({ filter });
  },

  setFollow(follow) {
    set({ follow });
  },

  retain(keep) {
    set((s) => ({ byPath: keepOnly(s.byPath, keep), collapsed: keepOnly(s.collapsed, keep) }));
  },
}));
