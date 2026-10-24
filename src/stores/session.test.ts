import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import { backend } from '../ipc/client';
import { useAiPanel } from './aiPanel';
import { useDocuments } from './documents';
import { startEventBridge } from './eventBridge';
import { SAVE_DEBOUNCE_MS, buildSession, flushSession, startSessionSync } from './session';
import { useTabs } from './tabs';
import { useTree } from './tree';
import { useWorkspace } from './workspace';

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

let stops: (() => void)[] = [];
beforeAll(async () => {
  stops = [await startEventBridge(), startSessionSync()];
});
afterAll(() => {
  for (const s of stops) s();
});

beforeEach(async () => {
  window.__igraspMock?.reset();
  useTabs.setState({ tabs: [], activeId: null });
  useDocuments.getState().clear();
  useTree.setState({ expanded: new Set() });
  useWorkspace.setState({ root: null, lastReady: null });
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await flush();
});

describe('session', () => {
  it('captures tabs, scroll, active tab, expanded folders and layout', () => {
    useTabs.getState().openDocument('README.md', { pin: true });
    useTabs.getState().openDocument('docs/architecture.md');
    const first = useTabs.getState().tabs[0];
    if (!first) throw new Error('no tab');
    useTabs.getState().setScroll(first.id, 420);
    useTree.getState().expand('docs');
    useWorkspace.getState().setSidebarWidth(333);
    const s = buildSession();
    expect(s.tabs).toEqual([
      { relPath: 'README.md', pinned: true, scrollTop: 420, kind: 'document' },
      { relPath: 'docs/architecture.md', pinned: false, scrollTop: 0, kind: 'document' },
    ]);
    expect(s.activeTab).toBe('docs/architecture.md');
    expect(s.expandedDirs).toEqual(['docs']);
    expect(s.sidebar.widthPx).toBe(333);
  });

  it('saves after changes, debounced', () => {
    vi.useFakeTimers();
    try {
      const save = vi.spyOn(backend, 'saveSession');
      useTabs.getState().openDocument('README.md', { pin: true });
      useTree.getState().expand('docs');
      expect(save).not.toHaveBeenCalled();
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]?.[0]).toBe(FIXTURE_ROOT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the session when the folder is opened again, dropping missing files', async () => {
    useTabs.getState().openDocument('README.md', { pin: true });
    useTabs.getState().openDocument('CHANGELOG.md', { pin: true });
    const readme = useTabs.getState().tabs[0];
    if (!readme) throw new Error('no tab');
    useTabs.getState().setScroll(readme.id, 250);
    useTabs.getState().activate(readme.id);
    useTree.getState().expand('docs');
    useWorkspace.getState().setSidebarWidth(321);
    useWorkspace.getState().setSidebarView('recent');
    await useWorkspace.getState().closeRoot();
    useWorkspace.getState().setSidebarView('explorer');
    expect(useTabs.getState().tabs).toEqual([]);

    window.__igraspMock?.state.files.delete('CHANGELOG.md');
    useWorkspace.getState().setSidebarWidth(200);
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await flush();

    const tabs = useTabs.getState().tabs;
    expect(tabs.map((t) => t.relPath)).toEqual(['README.md']);
    expect(tabs[0]).toMatchObject({ pinned: true, scrollTop: 250 });
    expect(useTabs.getState().activeId).toBe(tabs[0]?.id);
    expect(useTree.getState().expanded.has('docs')).toBe(true);
    expect(useTree.getState().listings.docs).toBeDefined();
    expect(useWorkspace.getState().sidebar.widthPx).toBe(321);
    expect(useWorkspace.getState().sidebar.view).toBe('recent');
  });

  it('remembers the AI panel, open and placed, per folder', async () => {
    useAiPanel.getState().setOpen(true);
    useAiPanel.getState().setRect({ x: 30, y: 40, width: 500, height: 400 });
    expect(buildSession().aiPanel).toEqual({
      open: true,
      rect: { x: 30, y: 40, width: 500, height: 400 },
    });
    await useWorkspace.getState().closeRoot();
    expect(useAiPanel.getState()).toMatchObject({ open: false, rect: null });

    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await flush();
    expect(useAiPanel.getState()).toMatchObject({
      open: true,
      rect: { x: 30, y: 40, width: 500, height: 400 },
    });
    useAiPanel.getState().restore(null);
    await flushSession();
  });

  it('does not write while switching folders', async () => {
    await flushSession();
    const save = vi.spyOn(backend, 'saveSession');
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 50));
    // Only the explicit flush of the folder being left.
    expect(save.mock.calls.every(([, s]) => s.tabs.length === 0)).toBe(true);
  });
});
