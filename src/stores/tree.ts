import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { DirListing, FsChangesEvent } from '../ipc/types';
import { restorePending } from './session';
import { useWorkspace } from './workspace';

export interface TreeRow {
  kind: 'dir' | 'file' | 'loading';
  /** Root-relative path (for a loading row: the folder being loaded). */
  path: string;
  name: string;
  /** 1 for top-level entries. */
  level: number;
  hidden: boolean;
  expanded: boolean;
  /** Position among siblings (1-based) and number of siblings, for aria-posinset/setsize. */
  posInSet: number;
  setSize: number;
  parent: string;
}

interface TreeState {
  generation: number;
  listings: Record<string, DirListing>;
  loading: Record<string, true>;
  expanded: Set<string>;
  focused: string | null;
  showDotfiles: boolean;
  showIgnored: boolean;

  /** Called when a folder is opened (or rescanned): forget listings of older generations. */
  reset: (generation: number, flags: { showDotfiles: boolean; showIgnored: boolean }) => void;
  /** Called on `index://ready`: reload the root and every expanded folder. */
  onIndexReady: (generation: number) => Promise<void>;
  ensureLoaded: (dir: string) => Promise<void>;
  toggle: (dir: string) => void;
  expand: (dir: string) => void;
  collapse: (dir: string) => void;
  collapseAll: () => void;
  setExpanded: (dirs: string[]) => void;
  setFocused: (path: string | null) => void;
  /** Re-fetches the loaded listings of folders a disk change touched. */
  applyChanges: (changes: FsChangesEvent) => Promise<void>;
  setShowDotfiles: (show: boolean) => Promise<void>;
  setShowIgnored: (show: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

export const parentOf = (path: string) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

/** Flattens the loaded listings into visible rows, depth first, folders before files. */
export function flattenTree(
  listings: Record<string, DirListing>,
  expanded: Set<string>,
  loading: Record<string, true> = {},
): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (dir: string, level: number) => {
    const listing = listings[dir];
    if (!listing) {
      if (loading[dir] && dir !== '') {
        rows.push({
          kind: 'loading',
          path: dir,
          name: 'Loading…',
          level,
          hidden: false,
          expanded: false,
          posInSet: 1,
          setSize: 1,
          parent: dir,
        });
      }
      return;
    }
    const setSize = listing.dirs.length + listing.files.length;
    let pos = 0;
    for (const d of listing.dirs) {
      pos += 1;
      const isOpen = expanded.has(d.relPath);
      rows.push({
        kind: 'dir',
        path: d.relPath,
        name: d.name,
        level,
        hidden: d.hidden,
        expanded: isOpen,
        posInSet: pos,
        setSize,
        parent: dir,
      });
      if (isOpen) visit(d.relPath, level + 1);
    }
    for (const f of listing.files) {
      pos += 1;
      rows.push({
        kind: 'file',
        path: f.relPath,
        name: f.name,
        level,
        hidden: f.hidden,
        expanded: false,
        posInSet: pos,
        setSize,
        parent: dir,
      });
    }
  };
  visit('', 1);
  return rows;
}

export const useTree = create<TreeState>()((set, get) => ({
  generation: 0,
  listings: {},
  loading: {},
  expanded: new Set(),
  focused: null,
  showDotfiles: false,
  showIgnored: false,

  reset(generation, flags) {
    set({ generation, listings: {}, loading: {}, ...flags });
    if (generation === 0) return;
    const workspace = useWorkspace.getState();
    workspace.beginScan(generation);
    // The scan may already have finished before the call that started it returned.
    if (workspace.lastReady?.generation === generation) void get().onIndexReady(generation);
  },

  async onIndexReady(generation) {
    if (generation !== get().generation) return;
    set({ listings: {}, loading: {} });
    await get().ensureLoaded('');
    // Reload expanded folders in parallel; drop the ones that no longer exist.
    const dirs = [...get().expanded];
    await Promise.all(dirs.map((d) => get().ensureLoaded(d)));
    // First index of a freshly opened folder: bring back its tabs and expanded folders.
    await restorePending(generation);
  },

  async ensureLoaded(dir) {
    const { listings, loading, generation } = get();
    if (listings[dir] || loading[dir]) return;
    set({ loading: { ...loading, [dir]: true } });
    try {
      const listing = await backend.listDir(dir);
      if (get().generation !== generation) return;
      set((s) => ({ listings: { ...s.listings, [dir]: listing } }));
    } catch {
      // The folder vanished (or the index is being rebuilt): stop showing it as expanded.
      set((s) => {
        const expanded = new Set(s.expanded);
        expanded.delete(dir);
        return { expanded };
      });
    } finally {
      set((s) => ({
        loading: Object.fromEntries(Object.entries(s.loading).filter(([k]) => k !== dir)),
      }));
    }
  },

  toggle(dir) {
    if (get().expanded.has(dir)) get().collapse(dir);
    else get().expand(dir);
  },

  expand(dir) {
    set((s) => ({ expanded: new Set(s.expanded).add(dir) }));
    void get().ensureLoaded(dir);
  },

  collapse(dir) {
    set((s) => {
      const expanded = new Set(s.expanded);
      expanded.delete(dir);
      return { expanded };
    });
  },

  collapseAll() {
    set({ expanded: new Set() });
  },

  setExpanded(dirs) {
    set({ expanded: new Set(dirs) });
    for (const d of dirs) void get().ensureLoaded(d);
  },

  setFocused(path) {
    set({ focused: path });
  },

  async applyChanges(changes) {
    const { generation, listings } = get();
    if (changes.generation !== generation) return;
    const dirs = changes.dirsChanged.filter((d) => listings[d] !== undefined);
    await Promise.all(
      dirs.map(async (dir) => {
        try {
          const listing = await backend.listDir(dir);
          if (get().generation !== generation) return;
          set((s) => ({ listings: { ...s.listings, [dir]: listing } }));
        } catch {
          // The folder no longer holds markdown: forget it.
          set((s) => {
            const expanded = new Set(s.expanded);
            expanded.delete(dir);
            return {
              expanded,
              listings: Object.fromEntries(Object.entries(s.listings).filter(([k]) => k !== dir)),
            };
          });
        }
      }),
    );
  },

  async setShowDotfiles(show) {
    const generation = await backend.rescan({ showDotfiles: show });
    get().reset(generation, { showDotfiles: show, showIgnored: get().showIgnored });
  },

  async setShowIgnored(show) {
    const generation = await backend.rescan({ showIgnored: show });
    get().reset(generation, { showDotfiles: get().showDotfiles, showIgnored: show });
  },

  async refresh() {
    const generation = await backend.rescan({});
    get().reset(generation, { showDotfiles: get().showDotfiles, showIgnored: get().showIgnored });
  },
}));
