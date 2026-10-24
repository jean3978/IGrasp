import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import type { DirListing } from '../ipc/types';
import { startEventBridge } from './eventBridge';
import { flattenTree, useTree } from './tree';
import { useWorkspace } from './workspace';

const listing = (relPath: string, dirs: string[], files: string[]): DirListing => ({
  relPath,
  generation: 1,
  dirs: dirs.map((name) => ({
    name,
    relPath: relPath ? `${relPath}/${name}` : name,
    mdCount: 1,
    hidden: false,
  })),
  files: files.map((name) => ({
    name,
    relPath: relPath ? `${relPath}/${name}` : name,
    size: 1,
    modifiedMs: 1,
    hidden: false,
  })),
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('flattenTree', () => {
  const listings = {
    '': listing('', ['docs', 'notes'], ['README.md']),
    docs: listing('docs', ['guide'], ['a.md']),
    'docs/guide': listing('docs/guide', [], ['b.md']),
  };

  it('shows only top-level rows when nothing is expanded', () => {
    const rows = flattenTree(listings, new Set());
    expect(rows.map((r) => r.path)).toEqual(['docs', 'notes', 'README.md']);
    expect(rows[2]).toMatchObject({ posInSet: 3, setSize: 3, level: 1 });
  });

  it('nests expanded folders depth first', () => {
    const rows = flattenTree(listings, new Set(['docs', 'docs/guide']));
    expect(rows.map((r) => `${r.level}:${r.path}`)).toEqual([
      '1:docs',
      '2:docs/guide',
      '3:docs/guide/b.md',
      '2:docs/a.md',
      '1:notes',
      '1:README.md',
    ]);
  });

  it('shows a loading row for an expanded folder that is not loaded yet', () => {
    const rows = flattenTree(listings, new Set(['notes']), { notes: true });
    expect(rows[2]).toMatchObject({ kind: 'loading', parent: 'notes', level: 2 });
  });
});

describe('tree store with the mock backend', () => {
  let stopBridge: (() => void) | undefined;
  beforeAll(async () => {
    stopBridge = await startEventBridge();
  });
  afterAll(() => {
    stopBridge?.();
  });

  beforeEach(() => {
    window.__igraspMock?.reset();
    useTree.setState({ listings: {}, loading: {}, expanded: new Set(), focused: null });
    useWorkspace.setState({ root: null, lastReady: null });
  });

  it('loads the root listing when the index is ready', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    expect(useWorkspace.getState().index.state).toBe('scanning');
    await flush();
    await flush();
    expect(useWorkspace.getState().index.state).toBe('ready');
    const root = useTree.getState().listings[''];
    expect(root?.dirs.map((d) => d.name)).toEqual(['docs', 'notes']);
  });

  it('expands folders lazily and keeps them expanded across a rescan', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await flush();
    useTree.getState().expand('docs');
    await flush();
    expect(useTree.getState().listings.docs?.files.map((f) => f.name)).toEqual([
      'AGENTS.md',
      'architecture.md',
    ]);
    await useTree.getState().setShowDotfiles(true);
    expect(useTree.getState().listings).toEqual({});
    await flush();
    await flush();
    expect(useTree.getState().expanded.has('docs')).toBe(true);
    expect(useTree.getState().listings.docs).toBeDefined();
    expect(useTree.getState().listings['']?.dirs.map((d) => d.name)).toContain('.github');
  });

  it('drops an expanded folder that no longer exists', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await flush();
    useTree.getState().setExpanded(['gone']);
    await flush();
    expect(useTree.getState().expanded.has('gone')).toBe(false);
  });
});
