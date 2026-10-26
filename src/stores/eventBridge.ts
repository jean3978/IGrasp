// Routes backend events to the stores. Started once at app startup.

import { backend } from '../ipc/client';
import type { Unsubscribe } from '../ipc/types';
import { useAiConversation } from './aiConversation';
import { applyDiskChanges } from './diskChanges';
import { useGraph } from './graph';
import { useHistory } from './history';
import { useQuiz } from './quiz';
import { useAcademy } from './academy';
import { useRecentFiles } from './recentFiles';
import { useSearch } from './search';
import { useTabs } from './tabs';
import { useToasts } from './toasts';
import { useTree } from './tree';
import { useWorkspace } from './workspace';

/**
 * While the Academy is open (or once it was), its library follows the folder: a shared tutorial
 * pulled in, and the shared tutorials themselves once the graph is ready. The tab's own first
 * listing may have run before the graph, and its subjects may still be loading.
 */
function refreshAcademyLibrary() {
  const open = useTabs.getState().tabs.some((t) => t.id === ACADEMY_TAB);
  if (open || useAcademy.getState().subjects !== null) void useAcademy.getState().refreshLibrary();
}

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
      void useQuiz.getState().refreshQuizFiles();
      refreshAcademyLibrary();
    }),
    backend.listen('graph://changed', (e) => {
      useGraph.getState().onChanged(e);
      void useQuiz.getState().refreshQuizFiles();
      refreshAcademyLibrary();
    }),
    backend.listen('search://results', (e) => {
      useSearch.getState().onResults(e);
    }),
    backend.listen('fs://watch-status', (e) => {
      useWorkspace.getState().setWatchStatus(e.mode, e.reason);
    }),
    backend.listen('ai://event', (e) => {
      // An operation belongs to the quiz, the Academy or the chat (one runs at a time).
      if (useQuiz.getState().owns(e.operationId)) useQuiz.getState().onEvent(e);
      else if (useAcademy.getState().owns(e.operationId)) useAcademy.getState().onEvent(e);
      else useAiConversation.getState().onEvent(e);
    }),
    backend.listen('appdata://recovered', (e) => {
      useToasts
        .getState()
        .notify('error', `${e.file} was unreadable and has been reset to defaults.`);
    }),
  ]);
  const offTabs = useTabs.subscribe(watchAcademyTab);
  return () => {
    for (const off of offs) off();
    offTabs();
  };
}

const ACADEMY_TAB = 'tab-academy';

/**
 * The Academy tab opened (it was not open): Hoot's welcome plays when it shows. Switching back to
 * an open Academy tab does not replay it.
 */
function watchAcademyTab(s: { tabs: { id: string }[] }, prev: { tabs: { id: string }[] }) {
  const open = s.tabs.some((t) => t.id === ACADEMY_TAB);
  const wasOpen = prev.tabs.some((t) => t.id === ACADEMY_TAB);
  if (open && !wasOpen) useAcademy.setState({ welcome: true });
  else if (!open && wasOpen) useAcademy.setState({ welcome: false });
}
