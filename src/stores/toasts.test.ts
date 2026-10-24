import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsChangesEvent } from '../ipc/types';
import { DEFAULT_SETTINGS } from '../ipc/defaults';
import { useSettings } from './settings';
import { QUIET_WINDOW_MS, describeBatch, mergeBatches, resetToasts, useToasts } from './toasts';

const entry = (relPath: string) => ({
  name: relPath,
  relPath,
  size: 1,
  modifiedMs: 1,
  hidden: false,
});

function changes(p: Partial<Record<'added' | 'modified' | 'removed', string[]>>): FsChangesEvent {
  return {
    generation: 1,
    added: (p.added ?? []).map(entry),
    modified: (p.modified ?? []).map(entry),
    removed: p.removed ?? [],
    renamed: [],
    dirsChanged: [],
  };
}

const t = () => useToasts.getState();

beforeEach(() => {
  vi.useFakeTimers();
  resetToasts();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toast batching', () => {
  it('waits for the quiet window, then shows up to 3 individual toasts', () => {
    t().ingestChanges(changes({ added: ['a.md'], modified: ['b.md'], removed: ['c.md'] }));
    expect(t().toasts).toEqual([]);
    vi.advanceTimersByTime(QUIET_WINDOW_MS);
    expect(
      t().toasts.map((x) => (x.type === 'change' ? `${x.kind}:${x.relPath}` : x.type)),
    ).toEqual(['added:a.md', 'modified:b.md', 'deleted:c.md']);
  });

  it('restarts the quiet window while changes keep arriving', () => {
    t().ingestChanges(changes({ modified: ['a.md'] }));
    vi.advanceTimersByTime(QUIET_WINDOW_MS - 100);
    t().ingestChanges(changes({ modified: ['b.md'] }));
    vi.advanceTimersByTime(QUIET_WINDOW_MS - 100);
    expect(t().toasts).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(t().toasts).toHaveLength(2);
  });

  it('groups more than 3 changes into one toast that updates in place', () => {
    const many = Array.from({ length: 12 }, (_, i) => `f${String(i)}.md`);
    t().ingestChanges(changes({ modified: many, added: ['n1.md', 'n2.md', 'n3.md'] }));
    vi.advanceTimersByTime(QUIET_WINDOW_MS);
    const [grouped] = t().toasts;
    expect(t().toasts).toHaveLength(1);
    expect(grouped?.type === 'grouped' && describeBatch(grouped.batch)).toBe(
      '12 files modified · 3 added',
    );
    // The burst continues: the same toast is updated.
    t().ingestChanges(changes({ removed: ['gone.md'] }));
    vi.advanceTimersByTime(QUIET_WINDOW_MS);
    expect(t().toasts).toHaveLength(1);
    const [updated] = t().toasts;
    expect(updated?.id).toBe(grouped?.id);
    expect(updated?.type === 'grouped' && describeBatch(updated.batch)).toBe(
      '12 files modified · 3 added · 1 deleted',
    );
  });

  it('keeps at most 4 toasts by folding the oldest into a grouped one', () => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      t().ingestChanges(changes({ modified: [`${name}.md`] }));
      vi.advanceTimersByTime(QUIET_WINDOW_MS);
    }
    expect(t().toasts.length).toBeLessThanOrEqual(4);
    const grouped = t().toasts.find((x) => x.type === 'grouped');
    expect(grouped?.type === 'grouped' && grouped.batch.modified).toContain('a.md');
  });

  it('only counts changes while muted', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, toastsMuted: true } });
    t().ingestChanges(changes({ modified: ['a.md', 'b.md'], added: ['c.md'] }));
    vi.advanceTimersByTime(QUIET_WINDOW_MS);
    expect(t().toasts).toEqual([]);
    expect(t().mutedCount).toBe(3);
    t().resetMutedCount();
    expect(t().mutedCount).toBe(0);
  });

  it('merges batches by keeping the latest kind of each file', () => {
    expect(
      mergeBatches(
        { added: ['a.md'], modified: [], deleted: ['b.md'] },
        { added: ['b.md'], modified: ['a.md'], deleted: [] },
      ),
    ).toEqual({ added: ['a.md'], modified: ['b.md'], deleted: [] });
  });

  it('reports a rename once', () => {
    t().ingestChanges({
      ...changes({ added: ['new.md'], removed: ['old.md'] }),
      renamed: [{ from: 'old.md', to: 'new.md' }],
    });
    vi.advanceTimersByTime(QUIET_WINDOW_MS);
    expect(t().toasts).toHaveLength(1);
    expect(t().toasts[0]).toMatchObject({ kind: 'modified', relPath: 'new.md' });
  });
});
