import { createContext, useContext } from 'react';
import { backend } from '../../ipc/client';
import { resolveRelative } from '../../lib/paths';

export interface PreviewContextValue {
  /** Root-relative path of the document being shown. */
  relPath: string;
  /** Absolute path of the open folder. */
  rootPath: string;
  /** The scrolling element of the preview (anchor links scroll it). */
  getScrollContainer: () => HTMLElement | null;
}

export const PreviewContext = createContext<PreviewContextValue>({
  relPath: '',
  rootPath: '',
  getScrollContainer: () => null,
});

export const usePreview = () => useContext(PreviewContext);

export type MediaSource =
  { kind: 'url'; url: string; relPath: string | null } | { kind: 'invalid'; reason: string };

/** Resolves an image or video `src`: https URLs as-is, relative paths through the asset protocol. */
export function resolveMedia(ctx: PreviewContextValue, src: string | undefined): MediaSource {
  if (!src) return { kind: 'invalid', reason: 'No source' };
  if (/^https:\/\//i.test(src)) return { kind: 'url', url: src, relPath: null };
  const rel = resolveRelative(ctx.relPath, src);
  if (rel === null) return { kind: 'invalid', reason: `${src} is outside the opened folder` };
  return { kind: 'url', url: backend.assetUrl(ctx.rootPath, rel), relPath: rel };
}
