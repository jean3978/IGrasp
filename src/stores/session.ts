// Per-folder session: open tabs (with scroll positions), the active tab, expanded folders,
// sidebar layout and the Explorer toggles. Saved in app data (debounced), restored when the
// folder is opened again.

import { backend } from '../ipc/client';
import type { Session } from '../ipc/types';
import { dirname } from '../lib/paths';
import { newTabId, useTabs } from './tabs';
import type { Tab } from './tabs';
import { useTree } from './tree';
import { useWorkspace } from './workspace';

export const SAVE_DEBOUNCE_MS = 750;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** True while a session is being applied, so the half-restored state is not saved over it. */
let restoring = false;

export function buildSession(): Session {
  const { tabs, activeId } = useTabs.getState();
  const tree = useTree.getState();
  const { sidebar } = useWorkspace.getState();
  const documents = tabs.filter((t) => t.kind === 'document' && t.relPath !== null);
  return {
    version: 1,
    tabs: documents.map((t) => ({
      relPath: t.relPath ?? '',
      pinned: t.pinned,
      scrollTop: t.scrollTop,
    })),
    activeTab: tabs.find((t) => t.id === activeId)?.relPath ?? null,
    expandedDirs: [...tree.expanded].sort(),
    sidebar: { visible: sidebar.visible, widthPx: sidebar.widthPx },
    showDotfiles: tree.showDotfiles,
    showIgnored: tree.showIgnored,
    savedAtMs: Date.now(),
  };
}

/** Saves the current session now (and cancels a pending debounced save). */
export async function flushSession(): Promise<void> {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  const root = useWorkspace.getState().root;
  if (!root || restoring) return;
  try {
    await backend.saveSession(root.path, buildSession());
  } catch (err) {
    console.warn('Cannot save the session', err);
  }
}

function scheduleSave() {
  if (restoring || !useWorkspace.getState().root) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushSession();
  }, SAVE_DEBOUNCE_MS);
}

/** Applies the layout part of a session before the workspace is shown. */
export function applySessionLayout(session: Session | null): void {
  if (!session) return;
  useWorkspace.getState().setSidebarVisible(session.sidebar.visible);
  useWorkspace.getState().setSidebarWidth(session.sidebar.widthPx);
}

async function existingFiles(paths: string[]): Promise<Set<string>> {
  const dirs = [...new Set(paths.map(dirname))];
  const found = new Set<string>();
  await Promise.all(
    dirs.map(async (dir) => {
      try {
        const listing = await backend.listDir(dir);
        for (const f of listing.files) found.add(f.relPath);
      } catch {
        // The folder is gone (or holds no markdown anymore): its files are dropped.
      }
    }),
  );
  return found;
}

/** Recreates tabs and expanded folders once the index is ready. Missing files are dropped. */
export async function restoreSession(session: Session): Promise<void> {
  restoring = true;
  try {
    useTree.getState().setExpanded(session.expandedDirs);
    const exists = await existingFiles(session.tabs.map((t) => t.relPath));
    const tabs: Tab[] = session.tabs
      .filter((t) => exists.has(t.relPath))
      .map((t) => ({
        id: newTabId(),
        kind: 'document',
        relPath: t.relPath,
        pinned: t.pinned,
        scrollTop: t.scrollTop,
        deleted: false,
      }));
    const active = tabs.find((t) => t.relPath === session.activeTab) ?? tabs[0];
    useTabs.getState().restore(tabs, active?.id ?? null);
  } finally {
    restoring = false;
  }
}

let pending: { generation: number; session: Session } | null = null;

/** Stops saving while a folder is being switched (its state is half old, half new). */
export function suspendSaving(): void {
  restoring = true;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
}

/**
 * Remembers the session to restore once the index of `generation` is ready. Saving resumes
 * after that restore, or right away when there is nothing to restore.
 */
export function setPendingRestore(generation: number, session: Session | null): void {
  pending = session ? { generation, session } : null;
  if (!session) restoring = false;
}

/** Restores the pending session if it belongs to this index generation. */
export async function restorePending(generation: number): Promise<void> {
  if (pending?.generation !== generation) return;
  const { session } = pending;
  pending = null;
  await restoreSession(session);
}

/** Forgets any pending restore and resumes saving (folder closed). */
export function clearPendingRestore(): void {
  pending = null;
  restoring = false;
}

/** Saves the session whenever the parts it is made of change. Returns an unsubscribe function. */
export function startSessionSync(): () => void {
  const offs = [
    useTabs.subscribe((s, prev) => {
      if (s.tabs !== prev.tabs || s.activeId !== prev.activeId) scheduleSave();
    }),
    useTree.subscribe((s, prev) => {
      if (
        s.expanded !== prev.expanded ||
        s.showDotfiles !== prev.showDotfiles ||
        s.showIgnored !== prev.showIgnored
      ) {
        scheduleSave();
      }
    }),
    useWorkspace.subscribe((s, prev) => {
      if (s.sidebar !== prev.sidebar) scheduleSave();
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
