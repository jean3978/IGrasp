import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import { useDocuments } from './documents';
import { startEventBridge } from './eventBridge';
import { useTabs } from './tabs';
import { useTree } from './tree';
import { useWorkspace } from './workspace';

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('mock backend missing');
  return m;
};

let stop: (() => void) | undefined;
beforeAll(async () => {
  stop = await startEventBridge();
});
afterAll(() => stop?.());

beforeEach(async () => {
  mock().reset();
  useTabs.setState({ tabs: [], activeId: null });
  useDocuments.getState().clear();
  useWorkspace.setState({ root: null, lastReady: null });
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await flush();
});

describe('disk changes', () => {
  it('adds new files to loaded folders, including new folders', async () => {
    useTree.getState().expand('docs');
    await flush();
    mock().writeFiles({ 'docs/new.md': '# New', 'fresh/deep/x.md': '# X' });
    await flush();
    const tree = useTree.getState();
    expect(tree.listings.docs?.files.map((f) => f.name)).toContain('new.md');
    expect(tree.listings['']?.dirs.map((d) => d.name)).toContain('fresh');
  });

  it('removes folders that lost their last markdown file', async () => {
    useTree.getState().expand('notes');
    await flush();
    mock().deleteFiles(['notes/TODO.MD']);
    await flush();
    const tree = useTree.getState();
    expect(tree.listings['']?.dirs.map((d) => d.name)).not.toContain('notes');
    expect(tree.listings.notes).toBeUndefined();
    expect(tree.expanded.has('notes')).toBe(false);
  });

  it('live-reloads an open document', async () => {
    useTabs.getState().openDocument('README.md', { pin: true });
    await flush();
    mock().writeFiles({ 'README.md': '# Changed' });
    await flush();
    expect(useDocuments.getState().byPath['README.md']?.content).toBe('# Changed');
  });

  it('flags a deleted open file, and clears the flag when it comes back', async () => {
    useTabs.getState().openDocument('CHANGELOG.md', { pin: true });
    await flush();
    mock().deleteFiles(['CHANGELOG.md']);
    await flush();
    expect(useTabs.getState().tabs[0]?.deleted).toBe(true);
    // The last content stays available.
    expect(useDocuments.getState().byPath['CHANGELOG.md']?.status).toBe('ready');
    mock().writeFiles({ 'CHANGELOG.md': '# Back' });
    await flush();
    expect(useTabs.getState().tabs[0]?.deleted).toBe(false);
    expect(useDocuments.getState().byPath['CHANGELOG.md']?.content).toBe('# Back');
  });

  it('reloads a file removed and added in the same batch, never flags it deleted', async () => {
    // A file saved through a temporary file renamed over it (an accepted AI edit).
    useTabs.getState().openDocument('README.md', { pin: true });
    await flush();
    mock().state.files.set('README.md', '# Edited by the AI');
    const entry = {
      name: 'README.md',
      relPath: 'README.md',
      size: 18,
      modifiedMs: Date.now(),
      hidden: false,
    };
    mock().emit('fs://changes', {
      generation: useTree.getState().generation,
      added: [entry],
      modified: [],
      removed: ['README.md'],
      renamed: [],
      dirsChanged: [''],
    });
    await flush();
    expect(useTabs.getState().tabs[0]?.deleted).toBe(false);
    expect(useDocuments.getState().byPath['README.md']?.content).toBe('# Edited by the AI');
  });

  it('carries a tab over a rename', async () => {
    useTabs.getState().openDocument('README.md', { pin: true });
    await flush();
    mock().renameFile('README.md', 'INTRO.md');
    await flush();
    const [tab] = useTabs.getState().tabs;
    expect(tab).toMatchObject({ relPath: 'INTRO.md', deleted: false });
    expect(useDocuments.getState().byPath['INTRO.md']?.status).toBe('ready');
  });

  it('ignores changes of an older generation', async () => {
    useTree.getState().expand('docs');
    await flush();
    const before = useTree.getState().listings.docs;
    mock().emit('fs://changes', {
      generation: 999,
      added: [],
      modified: [],
      removed: ['docs/architecture.md'],
      renamed: [],
      dirsChanged: ['docs'],
    });
    await flush();
    expect(useTree.getState().listings.docs).toBe(before);
  });
});
