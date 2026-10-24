// Rule 1 of the AI integration principles: no token without a user action. Opening a folder,
// changing files, opening every view and every document must not start an AI operation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import type { SidebarView } from '../../ipc/types';
import { useAi } from '../../stores/ai';
import { startEventBridge } from '../../stores/eventBridge';
import { useGraph } from '../../stores/graph';
import { useQuickOpen } from '../../stores/quickOpen';
import { useSearch } from '../../stores/search';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';

let stop: () => void = () => undefined;

beforeEach(async () => {
  window.__igraspMock?.reset();
  stop = await startEventBridge();
});

afterEach(async () => {
  stop();
  await useWorkspace.getState().closeRoot();
});

describe('no token without a user action', () => {
  it('never starts an AI operation while browsing the project', async () => {
    const starts = () => window.__igraspMock?.state.ai.starts ?? [];
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await vi.waitFor(() => {
      expect(useGraph.getState().status.ready).toBe(true);
    });

    // Every sidebar view, the right panel and the AI panel itself.
    const views: SidebarView[] = ['explorer', 'search', 'recent', 'broken'];
    for (const view of views) useWorkspace.getState().setSidebarView(view);
    useWorkspace.getState().setRightPanelVisible(true);
    useAi.getState().setOpen(true);
    await useAi.getState().checkStatus();

    // Documents, searches and quick open.
    useTabs.getState().openDocument('README.md');
    useTabs.getState().openDocument('getting-started.md');
    useSearch.getState().setQuery('agent');
    await useSearch.getState().run();
    useQuickOpen.getState().setQuery('install');

    // Files changing on disk, as an agent would.
    window.__igraspMock?.writeFiles({ 'notes/new.md': '# New\n', 'README.md': '# Changed\n' });
    window.__igraspMock?.deleteFiles(['notes/new.md']);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(starts()).toEqual([]);

    // Only a message sent by the user starts one.
    await useAi.getState().send('hello');
    expect(starts()).toEqual(['chatMessage']);
  });
});
