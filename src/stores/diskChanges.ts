// What happens in the UI when files change on disk (from the app or anything else).

import type { FsChangesEvent } from '../ipc/types';
import { useDocuments } from './documents';
import { useTabs } from './tabs';
import { useTree } from './tree';

export function applyDiskChanges(changes: FsChangesEvent): void {
  if (changes.generation !== useTree.getState().generation) return;
  void useTree.getState().applyChanges(changes);

  const tabs = useTabs.getState();
  const docs = useDocuments.getState();
  const movedFrom = new Set(changes.renamed.map((r) => r.from));
  const movedTo = new Set(changes.renamed.map((r) => r.to));

  // A renamed file keeps its tab (and scroll position) under the new path.
  for (const { from, to } of changes.renamed) {
    docs.rename(from, to);
    tabs.renamePath(from, to);
  }
  // Removals first: a file removed and created again in the same batch (replaced in place) ends
  // up live and reloaded, never "deleted".
  for (const rel of changes.removed) {
    if (!movedFrom.has(rel)) tabs.markDeleted(rel, true);
  }
  // Open files refresh live; the previous render stays on screen until the new one is ready.
  // A modified file exists: a tab marked deleted by an earlier batch gets its content back.
  for (const file of changes.modified) {
    if (useTabs.getState().tabs.some((t) => t.relPath === file.relPath && t.deleted)) {
      tabs.markDeleted(file.relPath, false);
    }
    void docs.reload(file.relPath);
  }
  // A deleted file that reappears loses its "deleted" banner; a tab opened before its file
  // existed (a new file under review) shows it once it is created.
  for (const file of changes.added) {
    if (movedTo.has(file.relPath)) continue;
    const tab = useTabs.getState().tabs.find((t) => t.relPath === file.relPath);
    if (tab?.deleted) {
      tabs.markDeleted(file.relPath, false);
      void docs.reload(file.relPath);
    } else if (docs.byPath[file.relPath]?.status === 'error') {
      void docs.reload(file.relPath);
    }
  }
}
