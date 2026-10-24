// Document graph data the UI shows: build status and broken count (status bar, activity badge),
// link statuses of the open documents (preview flags), backlinks of the active document, and the
// broken links report. Everything is fetched lazily and refreshed on `graph://changed` for the
// affected documents only.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import type {
  Backlink,
  BrokenLinksReport,
  GraphChangedEvent,
  GraphReadyEvent,
  LinkInfo,
} from '../ipc/types';
import { useWorkspace } from './workspace';

export interface GraphStatusState {
  ready: boolean;
  parsedDocs: number;
  totalDocs: number;
  brokenCount: number;
}

const INITIAL: GraphStatusState = { ready: false, parsedDocs: 0, totalDocs: 0, brokenCount: 0 };

interface GraphState {
  status: GraphStatusState;
  /** Links of the documents shown in tabs, keyed by path then by `href` as written. */
  linksByDoc: Record<string, Record<string, LinkInfo>>;
  backlinks: Record<string, Backlink[]>;
  broken: BrokenLinksReport | null;
  /** Bumped on every graph change, so views showing derived data know to refresh. */
  version: number;

  loadStatus: () => Promise<void>;
  /** Fetches (or re-fetches) the links of a document. */
  refreshDoc: (relPath: string) => Promise<void>;
  /** Forgets the links of documents no tab shows anymore. */
  retainDocs: (keep: Set<string>) => void;
  refreshBacklinks: (relPath: string) => Promise<void>;
  loadBroken: () => Promise<void>;
  onProgress: (generation: number, parsedDocs: number, totalDocs: number) => void;
  onReady: (event: GraphReadyEvent) => void;
  onChanged: (event: GraphChangedEvent) => void;
  reset: () => void;
}

const currentGeneration = () => useWorkspace.getState().index.generation;

/** Maps links by href; with duplicates, the first problem wins so the flag is never hidden. */
export function byHref(links: LinkInfo[]): Record<string, LinkInfo> {
  const map: Record<string, LinkInfo> = {};
  for (const link of links) {
    const existing = map[link.href];
    if (!existing || (existing.status.kind === 'ok' && link.status.kind !== 'ok')) {
      map[link.href] = link;
    }
  }
  return map;
}

export const useGraph = create<GraphState>()((set, get) => ({
  status: INITIAL,
  linksByDoc: {},
  backlinks: {},
  broken: null,
  version: 0,

  async loadStatus() {
    const generation = currentGeneration();
    try {
      const s = await backend.getGraphStatus();
      if (s.generation !== generation) return;
      set({
        status: {
          ready: s.ready,
          parsedDocs: s.parsedDocs,
          totalDocs: s.totalDocs,
          brokenCount: s.brokenCount,
        },
      });
    } catch {
      // No folder open (anymore).
    }
  },

  async refreshDoc(relPath) {
    try {
      const doc = await backend.getDocLinks(relPath);
      set((s) => ({ linksByDoc: { ...s.linksByDoc, [relPath]: byHref(doc.links) } }));
    } catch {
      // No folder open: the preview simply shows no flags.
    }
  },

  retainDocs(keep) {
    const current = get().linksByDoc;
    if (Object.keys(current).every((k) => keep.has(k))) return;
    set({ linksByDoc: Object.fromEntries(Object.entries(current).filter(([k]) => keep.has(k))) });
  },

  async refreshBacklinks(relPath) {
    try {
      const result = await backend.getBacklinks(relPath);
      set((s) => ({ backlinks: { ...s.backlinks, [relPath]: result.items } }));
    } catch {
      // No folder open.
    }
  },

  async loadBroken() {
    const generation = currentGeneration();
    try {
      const report = await backend.listBrokenLinks();
      if (report.generation !== generation) return;
      set({ broken: report });
    } catch {
      // No folder open.
    }
  },

  onProgress(generation, parsedDocs, totalDocs) {
    if (generation !== currentGeneration()) return;
    set((s) => ({ status: { ...s.status, parsedDocs, totalDocs } }));
  },

  onReady(event) {
    if (event.generation !== currentGeneration()) return;
    set((s) => ({
      status: {
        ready: true,
        parsedDocs: event.docs,
        totalDocs: event.docs,
        brokenCount: event.brokenCount,
      },
      version: s.version + 1,
    }));
    for (const path of Object.keys(get().linksByDoc)) void get().refreshDoc(path);
    for (const path of Object.keys(get().backlinks)) void get().refreshBacklinks(path);
    if (get().broken) void get().loadBroken();
  },

  onChanged(event) {
    if (event.generation !== currentGeneration()) return;
    set((s) => ({
      status: { ...s.status, brokenCount: event.brokenCount },
      version: s.version + 1,
    }));
    const touched = new Set([...event.docs, ...event.removed]);
    for (const path of Object.keys(get().linksByDoc)) {
      if (touched.has(path)) void get().refreshDoc(path);
    }
    // Any change can add or remove a backlink of the active document.
    for (const path of Object.keys(get().backlinks)) void get().refreshBacklinks(path);
    if (get().broken) void get().loadBroken();
  },

  reset() {
    set({ status: INITIAL, linksByDoc: {}, backlinks: {}, broken: null, version: 0 });
  },
}));
