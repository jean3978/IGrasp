import { useEffect, useState } from 'react';
import type { RenderedMarkdown } from './pipeline/processor';

// The pipeline (unified, parse5, yaml…) is loaded with the first document, not at startup.
const renderMarkdown = async (content: string) =>
  (await import('./pipeline/processor')).renderMarkdown(content);

/** Files above this size are shown as plain text: processing them would freeze the UI. */
export const MAX_RENDERED_CHARS = 2_000_000;

const CACHE_SIZE = 20;

/**
 * Which cache a render goes to: the open documents, or the AI chat's answers (which must not push
 * the documents out, and are many and small).
 */
export type MarkdownScope = 'document' | 'chat';

const caches: Record<MarkdownScope, Map<string, RenderedMarkdown>> = {
  document: new Map(),
  chat: new Map(),
};

function remember(cache: Map<string, RenderedMarkdown>, key: string, value: RenderedMarkdown) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

interface MarkdownResult {
  rendered: RenderedMarkdown | null;
  error: string | null;
}

interface Latest extends MarkdownResult {
  content: string;
}

/**
 * Renders markdown off the React render path. Only the latest content's result is kept, so a
 * slow render of an old version never overwrites a newer one. While a new version renders, the
 * previous one stays on screen (no flash on live reload).
 */
export function useMarkdown(content: string, scope: MarkdownScope = 'document'): MarkdownResult {
  const [latest, setLatest] = useState<Latest | null>(null);
  const cache = caches[scope];
  const cached = cache.get(content);
  // A render shown from the cache is the previous one too: the next version (an accepted edit,
  // a live reload) must not blank the document, which would drop its scroll position.
  if (cached && latest?.rendered !== cached) setLatest({ rendered: cached, error: null, content });

  useEffect(() => {
    if (content.length > MAX_RENDERED_CHARS || cache.has(content)) return;
    let cancelled = false;
    renderMarkdown(content)
      .then((rendered) => {
        remember(cache, content, rendered);
        if (!cancelled) setLatest({ rendered, error: null, content });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLatest({
            rendered: null,
            error: err instanceof Error ? err.message : String(err),
            content,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [content, cache]);

  if (cached) return { rendered: cached, error: null };
  return {
    rendered: latest?.rendered ?? null,
    error: latest?.content === content ? latest.error : null,
  };
}
