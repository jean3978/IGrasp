// Syntax highlighting with Shiki (trusted generator, runs after sanitization).
//
// The highlighter is created on the first code block, uses the JavaScript regex engine (no
// WASM) and loads languages on demand. All three themes are emitted at once as CSS variables
// (`--shiki-light`, `--shiki-dark`, `--shiki-hc`), so switching the app theme never re-renders.

import type { Element, Root } from 'hast';
import type { HighlighterCore } from 'shiki/core';
import { visit } from 'unist-util-visit';
import { textContent } from './hastText';

// GitHub's current (Primer) palettes: the older github-light/github-dark themes have tokens
// below the WCAG AA contrast ratio on the code background.
export const SHIKI_THEMES = {
  light: 'github-light-default',
  dark: 'github-dark-default',
  hc: 'github-dark-high-contrast',
} as const;

/** Code languages rendered by other components instead of being highlighted. */
const NOT_HIGHLIGHTED = new Set(['mermaid', 'math', 'igrasp-quiz']);

let highlighter: Promise<HighlighterCore> | null = null;
const unavailable = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [
        import('@shikijs/themes/github-light-default'),
        import('@shikijs/themes/github-dark-default'),
        import('@shikijs/themes/github-dark-high-contrast'),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

/** Loads a language (or alias) if Shiki knows it. Returns false for unknown languages. */
async function ensureLanguage(h: HighlighterCore, lang: string): Promise<boolean> {
  if (h.getLoadedLanguages().includes(lang)) return true;
  if (unavailable.has(lang)) return false;
  const { bundledLanguages } = await import('shiki/langs');
  const loader = (bundledLanguages as Record<string, (typeof bundledLanguages)['ts'] | undefined>)[
    lang
  ];
  if (!loader) {
    unavailable.add(lang);
    return false;
  }
  try {
    await h.loadLanguage(loader);
    return true;
  } catch {
    unavailable.add(lang);
    return false;
  }
}

/** A token with its colors for every theme as CSS variables (`--shiki-light`, …). */
export interface ThemedToken {
  content: string;
  style: Record<string, string>;
}

/**
 * Tokenizes a whole file for the code viewer, one array of tokens per line. Resolves to null when
 * the language is unknown (the caller shows plain text).
 */
export async function tokenizeCode(code: string, lang: string): Promise<ThemedToken[][] | null> {
  const h = await getHighlighter();
  if (!(await ensureLanguage(h, lang))) return null;
  const lines = h.codeToTokensWithThemes(code, { lang, themes: SHIKI_THEMES });
  return lines.map((line) =>
    line.map((token) => {
      const style: Record<string, string> = {};
      for (const [theme, variant] of Object.entries(token.variants)) {
        if (variant.color) style[`--shiki-${theme}`] = variant.color;
        // Font style bit 1 = italic, 2 = bold (Shiki's FontStyle flags).
        if (variant.fontStyle && variant.fontStyle & 1)
          style[`--shiki-${theme}-font-style`] = 'italic';
        if (variant.fontStyle && variant.fontStyle & 2)
          style[`--shiki-${theme}-font-weight`] = 'bold';
      }
      return { content: token.content, style };
    }),
  );
}

export { textContent };

/** The language of a `pre > code.language-x` block, or null. */
export function codeLanguage(pre: Element): string | null {
  const code = pre.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
  const classes = code?.properties.className;
  if (!Array.isArray(classes)) return null;
  for (const c of classes) {
    const match = typeof c === 'string' ? /^language-(.+)$/.exec(c) : null;
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

export async function highlightCode(tree: Root): Promise<void> {
  const blocks: { pre: Element; parent: Root | Element; index: number; lang: string }[] = [];
  visit(tree, 'element', (node, index, parent) => {
    if (node.tagName !== 'pre' || parent === undefined || index === undefined) return;
    const lang = codeLanguage(node);
    // The tree comes from markdown, never MDX, so a parent is always a root or an element.
    const container = parent as Root | Element;
    if (lang && !NOT_HIGHLIGHTED.has(lang))
      blocks.push({ pre: node, parent: container, index, lang });
  });
  if (blocks.length === 0) return;

  const h = await getHighlighter();
  for (const { pre, parent, index, lang } of blocks) {
    if (!(await ensureLanguage(h, lang))) {
      pre.properties.dataLanguage = lang;
      continue;
    }
    const highlighted = h.codeToHast(textContent(pre).replace(/\n$/, ''), {
      lang,
      themes: SHIKI_THEMES,
      defaultColor: false,
    });
    const newPre = highlighted.children.find(
      (c): c is Element => c.type === 'element' && c.tagName === 'pre',
    );
    if (!newPre) continue;
    newPre.properties.dataLanguage = lang;
    if (pre.properties.dataLine !== undefined) newPre.properties.dataLine = pre.properties.dataLine;
    parent.children[index] = newPre;
  }
}
