import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_HISTORY,
  selectCanGoBack,
  selectCanGoForward,
  startHistorySync,
  useHistory,
} from './history';
import { useDocuments } from './documents';
import { selectActiveTab, useTabs } from './tabs';

const h = () => useHistory.getState();
const active = () => selectActiveTab(useTabs.getState())?.relPath;
const paths = () => h().entries.map((e) => e.relPath);
let stop: () => void;

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  useDocuments.getState().clear();
  h().clear();
  stop = startHistorySync();
});

afterEach(() => {
  stop();
});

const changes = (removed: string[], renamed: { from: string; to: string }[] = []) => ({
  generation: 1,
  added: [],
  modified: [],
  removed,
  renamed,
  dirsChanged: [],
});

describe('history store', () => {
  it('records the documents the user moves to, back and forward do not record', () => {
    useTabs.getState().openDocument('a.md', { pin: true });
    useTabs.getState().openDocument('b.md', { pin: true });
    useTabs.getState().openDocument('c.md');
    expect(paths()).toEqual(['a.md', 'b.md', 'c.md']);
    h().back();
    h().back();
    expect(active()).toBe('a.md');
    expect(selectCanGoBack(h())).toBe(false);
    h().forward();
    expect(active()).toBe('b.md');
    expect(paths()).toEqual(['a.md', 'b.md', 'c.md']);
    expect(selectCanGoForward(h())).toBe(true);
  });

  it('drops the forward stack when a new document is opened', () => {
    useTabs.getState().openDocument('a.md', { pin: true });
    useTabs.getState().openDocument('b.md', { pin: true });
    h().back();
    useTabs.getState().openDocument('c.md', { pin: true });
    expect(paths()).toEqual(['a.md', 'c.md']);
    expect(selectCanGoForward(h())).toBe(false);
  });

  it('records switching between open tabs and collapses consecutive duplicates', () => {
    useTabs.getState().openDocument('a.md', { pin: true });
    useTabs.getState().openDocument('b.md', { pin: true });
    useTabs.getState().cycle(1);
    useTabs.getState().openDocument('a.md');
    expect(paths()).toEqual(['a.md', 'b.md', 'a.md']);
  });

  it('reopens a closed document as a preview tab', () => {
    useTabs.getState().openDocument('a.md', { pin: true });
    useTabs.getState().openDocument('b.md', { pin: true });
    const a = useTabs.getState().tabs[0];
    if (!a) throw new Error('no tab');
    useTabs.getState().close(a.id);
    h().back();
    expect(active()).toBe('a.md');
    expect(useTabs.getState().tabs.find((t) => t.relPath === 'a.md')?.pinned).toBe(false);
  });

  it('forgets removed files, follows renamed ones and merges new neighbors', () => {
    for (const p of ['a.md', 'b.md', 'a.md', 'c.md']) h().record({ relPath: p, kind: 'document' });
    h().applyChanges(changes(['b.md']));
    expect(paths()).toEqual(['a.md', 'c.md']);
    expect(h().position).toBe(1);
    h().applyChanges(changes(['c.md'], [{ from: 'c.md', to: 'd.md' }]));
    expect(paths()).toEqual(['a.md', 'd.md']);
  });

  it('keeps at most MAX_HISTORY entries', () => {
    for (let i = 0; i < MAX_HISTORY + 10; i++)
      h().record({ relPath: `${String(i)}.md`, kind: 'document' });
    expect(h().entries).toHaveLength(MAX_HISTORY);
    expect(h().position).toBe(MAX_HISTORY - 1);
  });
});
