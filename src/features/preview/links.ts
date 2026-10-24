import { backend } from '../../ipc/client';
import { dirname, fragmentOf, isMarkdownPath, resolveRelative } from '../../lib/paths';
import { useTabs } from '../../stores/tabs';
import { ID_PREFIX } from './pipeline/ids';
import type { PreviewContextValue } from './previewContext';

export type LinkTarget =
  | { kind: 'anchor'; id: string }
  | { kind: 'external'; url: string }
  | { kind: 'document'; relPath: string }
  | { kind: 'unsupported' };

/** What a link in `fromDoc` points to. */
export function classifyLink(fromDoc: string, href: string | undefined): LinkTarget {
  if (!href) return { kind: 'unsupported' };
  if (href.startsWith('#')) {
    const id = fragmentOf(href);
    return id ? { kind: 'anchor', id } : { kind: 'unsupported' };
  }
  if (/^(https?:|mailto:)/i.test(href)) return { kind: 'external', url: href };
  const rel = resolveRelative(fromDoc, href);
  if (rel !== null && isMarkdownPath(rel)) return { kind: 'document', relPath: rel };
  return { kind: 'unsupported' };
}

/** Scrolls the preview to the element of an anchor (`#x` targets `user-content-x`). */
export function scrollToAnchor(ctx: PreviewContextValue, id: string): boolean {
  const container = ctx.getScrollContainer();
  const target =
    container?.querySelector(`[id="${CSS.escape(ID_PREFIX + id)}"]`) ??
    container?.querySelector(`[id="${CSS.escape(id)}"]`);
  if (!target) return false;
  target.scrollIntoView({ block: 'start' });
  return true;
}

/** Opens a linked markdown file in a tab if the index knows it. */
export async function openDocumentLink(relPath: string): Promise<boolean> {
  try {
    const listing = await backend.listDir(dirname(relPath));
    if (!listing.files.some((f) => f.relPath === relPath)) return false;
    useTabs.getState().openDocument(relPath);
    return true;
  } catch {
    return false;
  }
}
