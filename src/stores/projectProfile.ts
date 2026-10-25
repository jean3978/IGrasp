// The project profile of the open folder (local detection, no AI) and the user's corrections.
// Shared by the quiz and, later, the tutorials. Loading it is free: one walk of the folder in the
// backend, cached until the disk changes.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { ProfileCorrections, ProjectProfile } from '../ipc/types';
import { errorMessage } from './aiProvider';

interface ProjectProfileState {
  profile: ProjectProfile | null;
  loading: boolean;
  error: string | null;
  /** The root the profile belongs to; another root drops it. */
  root: string | null;

  /** Loads the profile of `root` (once per root unless `force`). */
  load: (root: string, force?: boolean) => Promise<void>;
  /** Saves the corrections and shows the corrected profile. */
  saveCorrections: (corrections: ProfileCorrections) => Promise<void>;
  /** Forgets the profile (folder closed). */
  clear: () => void;
}

export const useProjectProfile = create<ProjectProfileState>()((set, get) => ({
  profile: null,
  loading: false,
  error: null,
  root: null,

  async load(root, force = false) {
    if (!force && get().root === root && (get().profile !== null || get().loading)) return;
    set({ loading: true, error: null, root, ...(get().root === root ? {} : { profile: null }) });
    try {
      const profile = await backend.getProjectProfile(force);
      if (get().root === root) set({ profile, loading: false });
    } catch (err) {
      if (get().root === root) set({ error: errorMessage(err), loading: false });
    }
  },

  async saveCorrections(corrections) {
    const profile = await backend.setProfileCorrections(corrections);
    set({ profile, error: null });
  },

  clear() {
    set({ profile: null, loading: false, error: null, root: null });
  },
}));
