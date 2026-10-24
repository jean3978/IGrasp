import { create } from 'zustand';

interface UiState {
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
}

/** Transient UI state that is not saved anywhere. */
export const useUi = create<UiState>()((set) => ({
  aboutOpen: false,
  setAboutOpen(open) {
    set({ aboutOpen: open });
  },
}));
