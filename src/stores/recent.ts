import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { RecentFolder } from '../ipc/types';

interface RecentState {
  folders: RecentFolder[];
  refresh: () => Promise<void>;
  remove: (path: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const useRecent = create<RecentState>()((set) => ({
  folders: [],

  async refresh() {
    set({ folders: await backend.getRecentFolders() });
  },

  async remove(path) {
    set({ folders: await backend.removeRecentFolder(path) });
  },

  async clear() {
    set({ folders: await backend.clearRecentFolders() });
  },
}));
