// Mermaid rendering. The library is the largest dependency, so it is imported on the first
// diagram. Renders are serialized (Mermaid keeps global configuration) and cached per
// (source, theme). `securityLevel: 'strict'` makes Mermaid sanitize labels and disables click
// handlers, so the returned SVG can be inserted as-is.

import type { Mermaid, MermaidConfig } from 'mermaid';
import type { EffectiveTheme } from '../../stores/settings';

export type MermaidResult = { kind: 'svg'; svg: string } | { kind: 'error'; message: string };

let mermaidPromise: Promise<Mermaid> | null = null;
let configuredTheme: EffectiveTheme | null = null;
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;
const cache = new Map<string, MermaidResult>();
const CACHE_SIZE = 50;

const HIGH_CONTRAST_VARIABLES = {
  background: '#000000',
  mainBkg: '#000000',
  primaryColor: '#000000',
  primaryTextColor: '#ffffff',
  primaryBorderColor: '#ffffff',
  secondaryColor: '#000000',
  secondaryTextColor: '#ffffff',
  secondaryBorderColor: '#ffff00',
  tertiaryColor: '#000000',
  tertiaryTextColor: '#ffffff',
  tertiaryBorderColor: '#ffffff',
  lineColor: '#ffff00',
  textColor: '#ffffff',
  nodeBorder: '#ffffff',
  clusterBkg: '#000000',
  clusterBorder: '#ffffff',
  edgeLabelBackground: '#000000',
  titleColor: '#ffffff',
};

export function mermaidConfig(theme: EffectiveTheme, fontFamily: string): MermaidConfig {
  const base: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    look: 'neo',
    fontFamily,
  };
  if (theme === 'high-contrast') {
    return { ...base, look: 'classic', theme: 'base', themeVariables: HIGH_CONTRAST_VARIABLES };
  }
  return { ...base, theme: theme === 'dark' ? 'redux-dark-color' : 'redux-color' };
}

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  return mermaidPromise;
}

function remember(key: string, result: MermaidResult) {
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'str' in err && typeof err.str === 'string') {
    return err.str;
  }
  return String(err);
}

// Theme names contain no colon, so the first colon separates the two parts.
const cacheKey = (source: string, theme: EffectiveTheme) => `${theme}:${source}`;

export function cachedMermaid(source: string, theme: EffectiveTheme): MermaidResult | undefined {
  return cache.get(cacheKey(source, theme));
}

export function renderMermaid(source: string, theme: EffectiveTheme): Promise<MermaidResult> {
  const key = cacheKey(source, theme);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  const task = queue.then(async (): Promise<MermaidResult> => {
    const again = cache.get(key);
    if (again) return again;
    const mermaid = await loadMermaid();
    if (configuredTheme !== theme) {
      const font = getComputedStyle(document.documentElement).getPropertyValue('--font-ui');
      mermaid.initialize(mermaidConfig(theme, font.trim() || 'sans-serif'));
      configuredTheme = theme;
    }
    let result: MermaidResult;
    try {
      await mermaid.parse(source);
      counter += 1;
      const { svg } = await mermaid.render(`igrasp-mermaid-${String(counter)}`, source);
      result = { kind: 'svg', svg };
    } catch (err) {
      result = { kind: 'error', message: errorMessage(err) };
    }
    remember(key, result);
    return result;
  });
  queue = task.catch(() => undefined);
  return task;
}
