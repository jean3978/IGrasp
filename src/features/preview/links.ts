// The single place where a link of the preview is resolved and followed. The document graph
// (Rust) knows the precise target and whether it exists; until it has parsed the document, the
// link is classified from its text and nothing is flagged.

import { backend } from '../../ipc/client';
import type { LinkInfo, LinkStatus, LinkTarget } from '../../ipc/types';
import { classifyHref, isMediaPath } from '../../lib/linkTargets';
import { dirname, isMarkdownPath } from '../../lib/paths';
import { useTabs } from '../../stores/tabs';
import { useToasts } from '../../stores/toasts';
import { useTree } from '../../stores/tree';
import { useWorkspace } from '../../stores/workspace';
import { parseLineFragment } from '../code/codeLines';
import { findAnchor, flash } from './reveal';
import type { PreviewContextValue } from './previewContext';

export interface ResolvedLink {
  target: LinkTarget;
  status: LinkStatus;
}

/** The target and status of a link, from the graph when it knows the link. */
export function resolveLink(
  fromDoc: string,
  href: string | undefined,
  info: LinkInfo | undefined,
): ResolvedLink {
  if (info) return { target: info.target, status: info.status };
  const target = classifyHref(fromDoc, href);
  if (target.kind === 'outside') return { target, status: { kind: 'outsideRoot' } };
  if (target.kind === 'file' && isMarkdownPath(target.relPath)) {
    return {
      target: { kind: 'document', relPath: target.relPath, fragment: target.fragment },
      status: { kind: 'notChecked' },
    };
  }
  return { target, status: { kind: 'notChecked' } };
}

/** `data-status` of a link: `broken`, `warning` or nothing. */
export function statusFlag(status: LinkStatus): 'broken' | 'warning' | undefined {
  switch (status.kind) {
    case 'missingFile':
    case 'missingAnchor':
    case 'outsideRoot':
      return 'broken';
    case 'caseMismatch':
      return 'warning';
    default:
      return undefined;
  }
}

const targetPath = (target: LinkTarget) =>
  'relPath' in target ? target.relPath : target.kind === 'external' ? target.url : '';

/** Why a link is flagged, for its tooltip and the Broken links view; null when it is fine. */
export function linkProblem({ target, status }: ResolvedLink): string | null {
  const fragment = 'fragment' in target ? target.fragment : null;
  switch (status.kind) {
    case 'missingFile':
      return `File not found: ${targetPath(target)}`;
    case 'missingAnchor':
      return target.kind === 'anchor'
        ? `Heading not found: #${target.fragment}`
        : `Heading not found: #${fragment ?? ''} in ${targetPath(target)}`;
    case 'caseMismatch':
      return `Wrong case: the file is ${status.actual} (works on Windows, breaks on Linux)`;
    case 'outsideRoot':
      return 'Outside the opened folder';
    default:
      return null;
  }
}

/** Scrolls the preview to the element of an anchor (`#x` targets `user-content-x`). */
export function scrollToAnchor(ctx: PreviewContextValue, id: string): boolean {
  const container = ctx.getScrollContainer();
  const target = container ? findAnchor(container, id) : null;
  if (!target) return false;
  target.scrollIntoView({ block: 'start' });
  flash(target);
  return true;
}

function warn(text: string) {
  useToasts.getState().notify('error', text);
}

function report(err: unknown) {
  warn(err instanceof Error ? err.message : String(err));
}

/** Shows a folder in the Explorer (expanded) and opens its README when it has one. */
export function revealFolder(relPath: string, readme: string | null, pin: boolean) {
  const tree = useTree.getState();
  if (relPath !== '') {
    tree.reveal(relPath);
    tree.expand(relPath);
  }
  useWorkspace.getState().setSidebarView('explorer');
  if (readme) useTabs.getState().openDocument(readme, { pin });
}

/** Whether the index knows a markdown file (hidden and ignored files are not indexed). */
async function documentExists(relPath: string): Promise<boolean> {
  try {
    const listing = await backend.listDir(dirname(relPath));
    return listing.files.some((f) => f.relPath === relPath);
  } catch {
    return false;
  }
}

/** What a click on a link does. */
export function followLink(
  ctx: PreviewContextValue,
  resolved: ResolvedLink,
  options: { pin: boolean },
): void {
  const { target, status } = resolved;
  const problem = linkProblem(resolved);
  const { pin } = options;
  switch (target.kind) {
    case 'anchor':
      if (!scrollToAnchor(ctx, target.fragment)) warn(`Heading not found: #${target.fragment}`);
      return;
    case 'external':
      backend.openUrl(target.url).catch(report);
      return;
    case 'outside':
      warn('This link points outside the opened folder, so IGrasp does not open it.');
      return;
    case 'unsupported':
      return;
    case 'folder':
      revealFolder(target.relPath, target.readme, pin);
      return;
    case 'document':
      if (status.kind === 'missingFile') {
        warn(problem ?? `File not found: ${target.relPath}`);
        return;
      }
      {
        // A missing heading still opens the document; the tooltip already says why.
        const open = () => {
          useTabs.getState().openDocument(target.relPath, {
            pin,
            ...(target.fragment ? { scroll: { anchor: target.fragment } } : {}),
          });
        };
        if (status.kind !== 'notChecked') {
          open();
          return;
        }
        // The graph does not know this link yet: check that the file exists first.
        void documentExists(target.relPath).then((exists) => {
          if (exists) open();
          else warn(`File not found: ${target.relPath}`);
        });
      }
      return;
    case 'file': {
      if (status.kind === 'missingFile') {
        warn(problem ?? `File not found: ${target.relPath}`);
        return;
      }
      if (isMediaPath(target.relPath)) {
        backend.openExternal(target.relPath).catch(report);
        return;
      }
      const range = parseLineFragment(target.fragment);
      useTabs.getState().openCode(target.relPath, {
        pin,
        ...(range ? { scroll: { line: range.start, endLine: range.end } } : {}),
      });
      return;
    }
  }
}

/** What the status bar shows while a link is hovered. */
export function hoverText(fromDoc: string, href: string | undefined, resolved: ResolvedLink) {
  const { target } = resolved;
  switch (target.kind) {
    case 'external':
      return target.url;
    case 'anchor':
      return `${fromDoc}#${target.fragment}`;
    case 'document':
    case 'file':
      return target.fragment ? `${target.relPath}#${target.fragment}` : target.relPath;
    case 'folder':
      return `${target.relPath || '.'}/`;
    default:
      return href ?? null;
  }
}
