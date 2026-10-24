import type { Settings } from './types';

/** Mirrors `Settings::default()` in Rust; used until the real settings are loaded. */
export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: 'system',
  fontSize: 16,
  readingWidth: 'medium',
  toastsMuted: false,
  ignorePatterns: [],
  showDotfiles: false,
  showIgnored: false,
  windowFrame: 'custom',
};

export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 24;
