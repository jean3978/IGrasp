import { beforeEach, describe, expect, it } from 'vitest';
import { selectActiveTab, tabLabel, useTabs } from './tabs';
import { useDocuments } from './documents';

const paths = () => useTabs.getState().tabs.map((t) => t.relPath ?? t.kind);
const active = () => selectActiveTab(useTabs.getState())?.relPath;
const t = () => useTabs.getState();

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  useDocuments.getState().clear();
});

describe('tabs store', () => {
  it('reuses the single preview tab for single-click opens', () => {
    t().openDocument('a.md');
    t().openDocument('b.md');
    expect(paths()).toEqual(['b.md']);
    expect(t().tabs[0]?.pinned).toBe(false);
  });

  it('keeps pinned tabs and opens new ones after the active tab', () => {
    t().openDocument('a.md', { pin: true });
    t().openDocument('b.md', { pin: true });
    t().activate(t().tabs[0]?.id ?? '');
    t().openDocument('c.md');
    expect(paths()).toEqual(['a.md', 'c.md', 'b.md']);
    expect(active()).toBe('c.md');
  });

  it('pins the preview tab on a second, pinned open of the same file', () => {
    t().openDocument('a.md');
    t().openDocument('a.md', { pin: true });
    expect(t().tabs).toHaveLength(1);
    expect(t().tabs[0]?.pinned).toBe(true);
    t().openDocument('b.md');
    expect(paths()).toEqual(['a.md', 'b.md']);
  });

  it('activates the neighbor when the active tab closes', () => {
    for (const p of ['a.md', 'b.md', 'c.md']) t().openDocument(p, { pin: true });
    t().activate(t().tabs[1]?.id ?? '');
    t().close(t().tabs[1]?.id ?? '');
    expect(active()).toBe('c.md');
    t().close(t().tabs[1]?.id ?? '');
    expect(active()).toBe('a.md');
    t().close(t().tabs[0]?.id ?? '');
    expect(t().activeId).toBeNull();
  });

  it('cycles, jumps by position and moves tabs', () => {
    for (const p of ['a.md', 'b.md', 'c.md']) t().openDocument(p, { pin: true });
    t().cycle(1);
    expect(active()).toBe('a.md');
    t().cycle(-1);
    expect(active()).toBe('c.md');
    t().activateIndex(2);
    expect(active()).toBe('b.md');
    t().activateIndex(9);
    expect(active()).toBe('c.md');
    t().move(t().activeId ?? '', -1);
    expect(paths()).toEqual(['a.md', 'c.md', 'b.md']);
  });

  it('closes others and all, evicting unused documents', () => {
    t().openDocument('a.md', { pin: true });
    t().openDocument('b.md', { pin: true });
    expect(Object.keys(useDocuments.getState().byPath).sort()).toEqual(['a.md', 'b.md']);
    t().closeOthers(t().tabs[0]?.id ?? '');
    expect(paths()).toEqual(['a.md']);
    expect(Object.keys(useDocuments.getState().byPath)).toEqual(['a.md']);
    t().closeAll();
    expect(t().tabs).toEqual([]);
  });

  it('keeps settings as a single tab', () => {
    t().openSpecial('settings');
    t().openSpecial('settings');
    expect(paths()).toEqual(['settings']);
  });

  it('adds the folder to the label when names clash', () => {
    t().openDocument('docs/README.md', { pin: true });
    t().openDocument('README.md', { pin: true });
    const [first, second] = t().tabs;
    if (!first || !second) throw new Error('tabs missing');
    expect(tabLabel(first, t().tabs)).toEqual({ title: 'README.md', description: 'docs' });
    expect(tabLabel(second, t().tabs)).toEqual({ title: 'README.md', description: '.' });
  });

  it('follows renames and deletions', () => {
    t().openDocument('a.md', { pin: true });
    t().markDeleted('a.md', true);
    expect(t().tabs[0]?.deleted).toBe(true);
    t().renamePath('a.md', 'b.md');
    expect(t().tabs[0]).toMatchObject({ relPath: 'b.md', deleted: false });
  });
});
