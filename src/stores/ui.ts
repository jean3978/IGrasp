import { create } from 'zustand';

interface UiState {
  aboutOpen: boolean;
  /** Target of the link under the pointer, shown in the status bar (like a browser). */
  hoveredLink: string | null;
  setAboutOpen: (open: boolean) => void;
  setHoveredLink: (target: string | null) => void;
}

/** Transient UI state that is not saved anywhere. */
export const useUi = create<UiState>()((set) => ({
  aboutOpen: false,
  hoveredLink: null,
  setAboutOpen(open) {
    set({ aboutOpen: open });
  },
  setHoveredLink(target) {
    set({ hoveredLink: target });
  },
}));
