import type { AiSettings, LearningSettings, Settings, SettingsPatch } from './types';

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

/** Mirrors `LearningSettings::default()` in Rust. */
export const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
  quizQuestions: 10,
  quizMode: 'fixed',
  quizScope: 'wholeProject',
  effects: true,
  quizResultsFolder: 'quiz-results',
  quizzesFolder: 'quizzes',
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
  learning: DEFAULT_LEARNING_SETTINGS,
};

export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 24;
export const MIN_HISTORY_LIMIT = 10;
export const MAX_HISTORY_LIMIT = 1000;
export const MIN_QUIZ_QUESTIONS = 5;
export const MAX_QUIZ_QUESTIONS = 30;

/**
 * `settings` with `patch` applied like `SettingsPatch::apply` in Rust: absent fields are left
 * unchanged, also inside `ai`, `ai.permissions` and `learning`. No normalization.
 */
export function applySettingsPatch(settings: Settings, patch: SettingsPatch): Settings {
  const { ai, learning, ...rest } = patch;
  const next: Settings = { ...settings, ...rest };
  if (ai) {
    const { permissions, ...aiRest } = ai;
    next.ai = {
      ...settings.ai,
      ...aiRest,
      permissions: { ...settings.ai.permissions, ...permissions },
    };
  }
  if (learning) next.learning = { ...settings.learning, ...learning };
  return next;
}

/** Like `relative_folder` in Rust: a plain relative folder, else `fallback`. */
export function relativeFolder(value: string, fallback: string): string {
  const v = value.trim().replace(/\\/g, '/');
  if (v.startsWith('/')) return fallback;
  const trimmed = v.replace(/\/+$/, '');
  const ok =
    trimmed !== '' &&
    !trimmed.includes(':') &&
    trimmed
      .split('/')
      .every((s) => s !== '' && s !== '.' && s !== '..' && /^[\p{L}\p{N} ._-]+$/u.test(s));
  return ok ? trimmed : fallback;
}
