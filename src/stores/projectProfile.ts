// The project profile of the open folder (local detection, no AI), the user's corrections and
// the subject proposals derived from them. Shared by the quiz and, later, the tutorials. Loading
// is free: one walk of the folder in the backend, cached until the disk changes.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { ProfileCorrections, ProjectProfile, Subject } from '../ipc/types';
import { errorMessage } from './aiProvider';

interface ProjectProfileState {
  profile: ProjectProfile | null;
  loading: boolean;
  error: string | null;
  /** The root the profile belongs to; another root drops it. */
  root: string | null;
  /** Subject proposals of the root; null until loaded. */
  subjects: Subject[] | null;

  /** Loads the profile of `root` (once per root unless `force`). */
  load: (root: string, force?: boolean) => Promise<void>;
  /** Saves the corrections and shows the corrected profile (the subjects follow it). */
  saveCorrections: (corrections: ProfileCorrections) => Promise<void>;
  /** Loads the subject proposals (local, no AI). */
  loadSubjects: () => Promise<void>;
  /** Forgets the profile (folder closed). */
  clear: () => void;
}

export const useProjectProfile = create<ProjectProfileState>()((set, get) => ({
  profile: null,
  loading: false,
  error: null,
  root: null,
  subjects: null,

  async load(root, force = false) {
    if (!force && get().root === root && (get().profile !== null || get().loading)) return;
    const sameRoot = get().root === root;
    set({
      loading: true,
      error: null,
      root,
      ...(sameRoot ? {} : { profile: null, subjects: null }),
    });
    try {
      const profile = await backend.getProjectProfile(force);
      if (get().root === root) set({ profile, loading: false });
      if (force && get().subjects !== null) await get().loadSubjects();
    } catch (err) {
      if (get().root === root) set({ error: errorMessage(err), loading: false });
    }
  },

  async saveCorrections(corrections) {
    const profile = await backend.setProfileCorrections(corrections);
    set({ profile, error: null });
    if (get().subjects !== null) await get().loadSubjects();
  },

  async loadSubjects() {
    const root = get().root;
    try {
      const subjects = await backend.listSubjects();
      if (get().root === root) set({ subjects });
    } catch (err) {
      if (get().root === root) set({ subjects: [], error: errorMessage(err) });
    }
  },

  clear() {
    set({ profile: null, loading: false, error: null, root: null, subjects: null });
  },
}));
