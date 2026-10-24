import { create } from 'zustand';
import { backend } from '../ipc/client';
import { DEFAULT_SETTINGS, applySettingsPatch } from '../ipc/defaults';
import type { Settings, SettingsPatch, Theme } from '../ipc/types';

export type EffectiveTheme = Exclude<Theme, 'system'>;

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  /** Whether the OS currently prefers a dark color scheme (for `theme: 'system'`). */
  systemDark: boolean;
  // Actions are function-typed properties (not methods) so components can select them unbound.
  load: () => Promise<void>;
  /** Applies `patch` immediately, persists it, and rolls back if persisting fails. */
  update: (patch: SettingsPatch) => Promise<void>;
  setSystemDark: (dark: boolean) => void;
}

export function resolveTheme(theme: Theme, systemDark: boolean): EffectiveTheme {
  if (theme === 'system') return systemDark ? 'dark' : 'light';
  return theme;
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  systemDark: prefersDark(),

  async load() {
    const settings = await backend.getSettings();
    set({ settings, loaded: true });
  },

  async update(patch) {
    const previous = get().settings;
    const optimistic: Settings = applySettingsPatch(previous, patch);
    set({ settings: optimistic });
    try {
      const saved = await backend.updateSettings(patch);
      set({ settings: saved });
    } catch (err) {
      set({ settings: previous });
      throw err;
    }
  },

  setSystemDark(dark) {
    set({ systemDark: dark });
  },
}));

export const selectEffectiveTheme = (s: SettingsState): EffectiveTheme =>
  resolveTheme(s.settings.theme, s.systemDark);
