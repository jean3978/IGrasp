import { create } from 'zustand';

export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 170;

interface SidebarState {
  visible: boolean;
  widthPx: number;
}

interface WorkspaceState {
  sidebar: SidebarState;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarWidth: (widthPx: number) => void;
}

export const useWorkspace = create<WorkspaceState>()((set) => ({
  sidebar: { visible: true, widthPx: DEFAULT_SIDEBAR_WIDTH },

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
