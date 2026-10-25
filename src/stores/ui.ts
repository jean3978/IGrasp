import { create } from 'zustand';

interface UiState {
  aboutOpen: boolean;
  /** The project profile's edit dialog (Learn → Project Profile…, or Edit on the card). */
  profileEditorOpen: boolean;
  /** Target of the link under the pointer, shown in the status bar (like a browser). */
  hoveredLink: string | null;
  setAboutOpen: (open: boolean) => void;
  setProfileEditorOpen: (open: boolean) => void;
  setHoveredLink: (target: string | null) => void;
}

/** Transient UI state that is not saved anywhere. */
export const useUi = create<UiState>()((set) => ({
  aboutOpen: false,
  profileEditorOpen: false,
  hoveredLink: null,
  setAboutOpen(open) {
    set({ aboutOpen: open });
  },
  setProfileEditorOpen(open) {
    set({ profileEditorOpen: open });
  },
  setHoveredLink(target) {
    set({ hoveredLink: target });
  },
}));
