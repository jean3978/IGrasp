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
  /**
   * A new scan of the same folder started: the graph is rebuilt, so status and flags are
   * cleared, but the documents shown keep their entries so `onReady` fetches them again.
   */
  beginRebuild: () => void;
  reset: () => void;
}

const currentGeneration = () => useWorkspace.getState().index.generation;

/** Latest request per path: a response is applied only if no newer request was sent since. */
const docRequests = new Map<string, number>();
const backlinkRequests = new Map<string, number>();
let requestSeq = 0;

/** Starts a request for a path; the returned check says whether its response is still wanted. */
function track(requests: Map<string, number>, relPath: string): () => boolean {
  const seq = ++requestSeq;
  const generation = currentGeneration();
  requests.set(relPath, seq);
  return () => requests.get(relPath) === seq && currentGeneration() === generation;
}

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
    const current = track(docRequests, relPath);
    try {
      const doc = await backend.getDocLinks(relPath);
      // A newer request for this document, or a rescan, happened meanwhile.
      if (!current()) return;
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
    const current = track(backlinkRequests, relPath);
    try {
      const result = await backend.getBacklinks(relPath);
      if (!current()) return;
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

  beginRebuild() {
    docRequests.clear();
    backlinkRequests.clear();
    set((s) => ({
      status: INITIAL,
      // No flags until the new graph says so (the app never guesses); backlinks stay shown
      // until they are fetched again.
      linksByDoc: Object.fromEntries(Object.keys(s.linksByDoc).map((k) => [k, {}])),
      broken: s.broken ? { ...s.broken, docs: [], graphReady: false } : null,
      version: 0,
    }));
  },

  reset() {
    docRequests.clear();
    backlinkRequests.clear();
    set({ status: INITIAL, linksByDoc: {}, backlinks: {}, broken: null, version: 0 });
  },
}));
