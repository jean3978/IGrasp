import { useEffect, useState } from 'react';
import { renderMarkdown } from './pipeline/processor';
import type { RenderedMarkdown } from './pipeline/processor';

/** Files above this size are shown as plain text: processing them would freeze the UI. */
export const MAX_RENDERED_CHARS = 2_000_000;

const CACHE_SIZE = 20;
const cache = new Map<string, RenderedMarkdown>();

function remember(key: string, value: RenderedMarkdown) {
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
export function useMarkdown(content: string): MarkdownResult {
  const [latest, setLatest] = useState<Latest | null>(null);
  const cached = cache.get(content);

  useEffect(() => {
    if (content.length > MAX_RENDERED_CHARS || cache.has(content)) return;
    let cancelled = false;
    renderMarkdown(content)
      .then((rendered) => {
        remember(content, rendered);
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
  }, [content]);

  if (cached) return { rendered: cached, error: null };
  return {
    rendered: latest?.rendered ?? null,
    error: latest?.content === content ? latest.error : null,
  };
}
