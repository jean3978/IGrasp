import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { IndexReadyEvent, RootInfo, SidebarView, WatchMode } from '../ipc/types';
import { useDocuments } from './documents';
import { useRecent } from './recent';
import {
  applySessionLayout,
  clearPendingRestore,
  flushSession,
  setPendingRestore,
  suspendSaving,
} from './session';
import { useTabs } from './tabs';
import { resetToasts } from './toasts';
import { useTree } from './tree';

export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 170;
export const DEFAULT_RIGHT_PANEL_WIDTH = 260;
export const MIN_RIGHT_PANEL_WIDTH = 200;

interface SidebarState {
  visible: boolean;
  widthPx: number;
  view: SidebarView;
}

interface RightPanelState {
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
  /** How the folder is watched for changes ("poll" when native watching is unavailable). */
  watch: { mode: WatchMode | null; reason: string | null };
  sidebar: SidebarState;
  /** The right panel with the Outline and Backlinks of the active document. */
  rightPanel: RightPanelState;

  openRoot: (path: string) => Promise<void>;
  /** Shows the folder picker and opens the chosen folder. */
  openFolderDialog: () => Promise<void>;
  closeRoot: () => Promise<void>;
  /** Starts tracking a new scan generation (after open or rescan). */
  beginScan: (generation: number) => void;
  setIndexProgress: (generation: number, scannedEntries: number, markdownFiles: number) => void;
  setIndexReady: (event: IndexReadyEvent) => void;
  setIndexError: (generation: number, message: string) => void;
  setWatchStatus: (mode: WatchMode, reason: string | null) => void;
  /** Keeps the markdown file count current as files appear and disappear. */
  adjustFileCount: (delta: number) => void;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarWidth: (widthPx: number) => void;
  /** Shows a view in the sidebar (and the sidebar itself). */
  setSidebarView: (view: SidebarView) => void;
  /** Activity bar click: switches to `view`, or hides the sidebar when it is already shown. */
  toggleSidebarView: (view: SidebarView) => void;
  toggleRightPanel: () => void;
  setRightPanelVisible: (visible: boolean) => void;
  setRightPanelWidth: (widthPx: number) => void;
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
  watch: { mode: null, reason: null },
  sidebar: { visible: true, widthPx: DEFAULT_SIDEBAR_WIDTH, view: 'explorer' },
  rightPanel: { visible: false, widthPx: DEFAULT_RIGHT_PANEL_WIDTH },

  async openRoot(path) {
    set({ opening: true, openError: null });
    try {
      // Keep the folder being left exactly as it was.
      await flushSession();
      const root = await backend.openRoot(path);
      const session = await backend.getSession(root.path).catch(() => null);
      suspendSaving();
      useTree.setState({ expanded: new Set(), focused: null });
      useTabs.getState().closeAll();
      useDocuments.getState().clear();
      applySessionLayout(session);
      setPendingRestore(root.generation, session);
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
    await flushSession();
    await backend.closeRoot();
    clearPendingRestore();
    set({ root: null, index: IDLE });
    useTree.getState().reset(0, { showDotfiles: false, showIgnored: false });
    useTabs.getState().closeAll();
    useDocuments.getState().clear();
    resetToasts();
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

  setWatchStatus(mode, reason) {
    set({ watch: { mode, reason } });
  },

  adjustFileCount(delta) {
    const { index } = get();
    if (index.state !== 'ready' || delta === 0) return;
    set({ index: { ...index, markdownFiles: Math.max(0, index.markdownFiles + delta) } });
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

  setSidebarView(view) {
    set((s) =>
      s.sidebar.visible && s.sidebar.view === view
        ? s
        : { sidebar: { ...s.sidebar, visible: true, view } },
    );
  },

  toggleSidebarView(view) {
    const { sidebar } = get();
    if (sidebar.visible && sidebar.view === view) get().setSidebarVisible(false);
    else get().setSidebarView(view);
  },

  toggleRightPanel() {
    get().setRightPanelVisible(!get().rightPanel.visible);
  },

  setRightPanelVisible(visible) {
    set((s) =>
      s.rightPanel.visible === visible ? s : { rightPanel: { ...s.rightPanel, visible } },
    );
  },

  setRightPanelWidth(widthPx) {
    const width = Math.max(MIN_RIGHT_PANEL_WIDTH, Math.round(widthPx));
    set((s) =>
      s.rightPanel.widthPx === width ? s : { rightPanel: { ...s.rightPanel, widthPx: width } },
    );
  },
}));
