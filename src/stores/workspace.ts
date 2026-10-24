import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { RootInfo } from '../ipc/types';
import { useRecent } from './recent';

export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 170;

interface SidebarState {
  visible: boolean;
  widthPx: number;
}

interface WorkspaceState {
  root: RootInfo | null;
  /** Message of the last failed open, shown on the welcome screen. */
  openError: string | null;
  opening: boolean;
  sidebar: SidebarState;

  openRoot: (path: string) => Promise<void>;
  /** Shows the folder picker and opens the chosen folder. */
  openFolderDialog: () => Promise<void>;
  closeRoot: () => Promise<void>;
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
  sidebar: { visible: true, widthPx: DEFAULT_SIDEBAR_WIDTH },

  async openRoot(path) {
    set({ opening: true, openError: null });
    try {
      const root = await backend.openRoot(path);
      set({ root, opening: false });
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
    set({ root: null });
    void useRecent.getState().refresh();
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
