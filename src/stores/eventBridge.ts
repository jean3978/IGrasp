// Routes backend events to the stores. Started once at app startup.

import { backend } from '../ipc/client';
import type { Unsubscribe } from '../ipc/types';
import { applyDiskChanges } from './diskChanges';
import { useGraph } from './graph';
import { useHistory } from './history';
import { useRecentFiles } from './recentFiles';
import { useSearch } from './search';
import { useToasts } from './toasts';
import { useTree } from './tree';
import { useWorkspace } from './workspace';

export async function startEventBridge(): Promise<Unsubscribe> {
  const offs = await Promise.all([
    backend.listen('index://progress', (e) => {
      useWorkspace.getState().setIndexProgress(e.generation, e.scannedEntries, e.markdownFiles);
    }),
    backend.listen('index://ready', (e) => {
      useWorkspace.getState().setIndexReady(e);
      void useTree.getState().onIndexReady(e.generation);
      void useGraph.getState().loadStatus();
    }),
    backend.listen('index://error', (e) => {
      useWorkspace.getState().setIndexError(e.generation, e.message);
    }),
    backend.listen('fs://changes', (e) => {
      if (e.generation !== useTree.getState().generation) return;
      applyDiskChanges(e);
      useHistory.getState().applyChanges(e);
      useRecentFiles.getState().onChanges(e);
      useSearch.getState().onDiskChanges(e);
      useWorkspace.getState().adjustFileCount(e.added.length - e.removed.length);
      useToasts.getState().ingestChanges(e);
    }),
    backend.listen('graph://progress', (e) => {
      useGraph.getState().onProgress(e.generation, e.parsedDocs, e.totalDocs);
    }),
    backend.listen('graph://ready', (e) => {
      useGraph.getState().onReady(e);
    }),
    backend.listen('graph://changed', (e) => {
      useGraph.getState().onChanged(e);
    }),
    backend.listen('search://results', (e) => {
      useSearch.getState().onResults(e);
    }),
    backend.listen('fs://watch-status', (e) => {
      useWorkspace.getState().setWatchStatus(e.mode, e.reason);
    }),
    backend.listen('appdata://recovered', (e) => {
      useToasts
        .getState()
        .notify('error', `${e.file} was unreadable and has been reset to defaults.`);
    }),
  ]);
  return () => {
    for (const off of offs) off();
  };
}
