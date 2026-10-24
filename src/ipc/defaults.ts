import type { AiSettings, Settings, SettingsPatch } from './types';

/** Mirrors `AiSettings::default()` in Rust. */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'claude-cli',
  model: '',
  permissions: {
    markdownEdits: 'ask',
    fileEdits: 'ask',
    commands: 'ask',
    web: 'ask',
    other: 'ask',
  },
  confirmFrom: 'large',
  historyLimit: 100,
};

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
  ai: DEFAULT_AI_SETTINGS,
};

export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 24;
export const MIN_HISTORY_LIMIT = 10;
export const MAX_HISTORY_LIMIT = 1000;

/**
 * `settings` with `patch` applied like `SettingsPatch::apply` in Rust: absent fields are left
 * unchanged, also inside `ai` and `ai.permissions`. No normalization.
 */
export function applySettingsPatch(settings: Settings, patch: SettingsPatch): Settings {
  const { ai, ...rest } = patch;
  const next: Settings = { ...settings, ...rest };
  if (ai) {
    const { permissions, ...aiRest } = ai;
    next.ai = {
      ...settings.ai,
      ...aiRest,
      permissions: { ...settings.ai.permissions, ...permissions },
    };
  }
  return next;
}
