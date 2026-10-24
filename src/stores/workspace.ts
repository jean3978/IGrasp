import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { IndexReadyEvent, RootInfo } from '../ipc/types';
import { useRecent } from './recent';
import { useTree } from './tree';

export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 170;

interface SidebarState {
  visible: boolean;
  widthPx: number;
}

export interface IndexStatus {
  state: 'idle' | 'scanning' | 'ready' | 'error';
  generation: number;
  scannedEntries: number;
  markdownFiles: number;
  dirs: number;
  skipped: number;
  message: string | null;
}

const IDLE: IndexStatus = {
  state: 'idle',
  generation: 0,
  scannedEntries: 0,
  markdownFiles: 0,
  dirs: 0,
  skipped: 0,
  message: null,
};

interface WorkspaceState {
  root: RootInfo | null;
  /** Message of the last failed open, shown on the welcome screen. */
  openError: string | null;
  opening: boolean;
  index: IndexStatus;
  /** The last `index://ready`, which can arrive before the call that started the scan returns. */
  lastReady: IndexReadyEvent | null;
  sidebar: SidebarState;

  openRoot: (path: string) => Promise<void>;
  /** Shows the folder picker and opens the chosen folder. */
  openFolderDialog: () => Promise<void>;
  closeRoot: () => Promise<void>;
  /** Starts tracking a new scan generation (after open or rescan). */
  beginScan: (generation: number) => void;
  setIndexProgress: (generation: number, scannedEntries: number, markdownFiles: number) => void;
  setIndexReady: (event: IndexReadyEvent) => void;
  setIndexError: (generation: number, message: string) => void;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarWidth: (widthPx: number) => void;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  root: null,
  openError: null,
  opening: false,
  index: IDLE,
  lastReady: null,
  sidebar: { visible: true, widthPx: DEFAULT_SIDEBAR_WIDTH },

  async openRoot(path) {
    set({ opening: true, openError: null });
    try {
      const root = await backend.openRoot(path);
      useTree.setState({ expanded: new Set(), focused: null });
      set({ root, opening: false });
      useTree.getState().reset(root.generation, {
        showDotfiles: root.showDotfiles,
        showIgnored: root.showIgnored,
      });
    } catch (err) {
      set({ opening: false, openError: message(err) });
    } finally {
      void useRecent.getState().refresh();
    }
  },

  async openFolderDialog() {
    const path = await backend.pickFolder();
    if (path) await get().openRoot(path);
  },

  async closeRoot() {
    if (!get().root) return;
    await backend.closeRoot();
    set({ root: null, index: IDLE });
    useTree.getState().reset(0, { showDotfiles: false, showIgnored: false });
    void useRecent.getState().refresh();
  },

  beginScan(generation) {
    set({ index: { ...IDLE, state: 'scanning', generation } });
    const early = get().lastReady;
    if (early?.generation === generation) get().setIndexReady(early);
  },

  setIndexProgress(generation, scannedEntries, markdownFiles) {
    const { index } = get();
    if (generation !== index.generation || index.state !== 'scanning') return;
    set({ index: { ...index, scannedEntries, markdownFiles } });
  },

  setIndexReady(event) {
    set({ lastReady: event });
    if (event.generation !== get().index.generation) return;
    set({
      index: {
        ...get().index,
        state: 'ready',
        markdownFiles: event.markdownFiles,
        dirs: event.dirs,
        skipped: event.skipped,
      },
    });
  },

  setIndexError(generation, msg) {
    if (generation !== get().index.generation) return;
    set({ index: { ...get().index, state: 'error', message: msg } });
  },

  toggleSidebar() {
    set((s) => ({ sidebar: { ...s.sidebar, visible: !s.sidebar.visible } }));
  },

  setSidebarVisible(visible) {
    set((s) => ({ sidebar: { ...s.sidebar, visible } }));
  },

  setSidebarWidth(widthPx) {
    const width = Math.max(MIN_SIDEBAR_WIDTH, Math.round(widthPx));
    set((s) => (s.sidebar.widthPx === width ? s : { sidebar: { ...s.sidebar, widthPx: width } }));
  },
}));
