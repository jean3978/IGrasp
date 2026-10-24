import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import { useRecent } from './recent';
import { useWorkspace } from './workspace';

beforeEach(() => {
  window.__igraspMock?.reset();
  useWorkspace.setState({ root: null, openError: null, opening: false });
  useRecent.setState({ folders: [] });
});

describe('workspace store', () => {
  it('opens a folder chosen in the dialog and records it as recent', async () => {
    await useWorkspace.getState().openFolderDialog();
    expect(useWorkspace.getState().root?.path).toBe(FIXTURE_ROOT);
    await useRecent.getState().refresh();
    expect(useRecent.getState().folders.map((f) => f.path)).toEqual([FIXTURE_ROOT]);
  });

  it('does nothing when the dialog is cancelled', async () => {
    const mock = window.__igraspMock;
    if (mock) mock.state.pickFolderResult = null;
    await useWorkspace.getState().openFolderDialog();
    expect(useWorkspace.getState().root).toBeNull();
  });

  it('reports a missing folder', async () => {
    await useWorkspace.getState().openRoot('/nowhere');
    expect(useWorkspace.getState().root).toBeNull();
    expect(useWorkspace.getState().openError).toContain('/nowhere');
  });

  it('closes the folder', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await useWorkspace.getState().closeRoot();
    expect(useWorkspace.getState().root).toBeNull();
  });

  it('switches sidebar views and hides the sidebar when the active view is clicked', () => {
    useWorkspace.setState({ sidebar: { visible: false, widthPx: 280, view: 'explorer' } });
    const ws = useWorkspace.getState;
    ws().toggleSidebarView('search');
    expect(ws().sidebar).toMatchObject({ visible: true, view: 'search' });
    ws().toggleSidebarView('search');
    expect(ws().sidebar).toMatchObject({ visible: false, view: 'search' });
    ws().setSidebarView('recent');
    expect(ws().sidebar).toMatchObject({ visible: true, view: 'recent' });
  });

  it('flags recent folders that no longer exist', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    window.__igraspMock?.state.folders.delete(FIXTURE_ROOT);
    await useRecent.getState().refresh();
    expect(useRecent.getState().folders[0]?.exists).toBe(false);
  });
});
