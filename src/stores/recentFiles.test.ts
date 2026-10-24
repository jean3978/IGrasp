import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../ipc/types';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import {
  REFRESH_DEBOUNCE_MS,
  dayGroup,
  groupRows,
  isChangedInSession,
  relativeTime,
  useRecentFiles,
} from './recentFiles';
import { startEventBridge } from './eventBridge';
import { useWorkspace } from './workspace';

const NOW = new Date(2026, 9, 24, 15, 0).getTime();
const HOUR = 3_600_000;
const file = (relPath: string, modifiedMs: number): FileEntry => ({
  name: relPath.split('/').pop() ?? relPath,
  relPath,
  size: 1,
  modifiedMs,
  hidden: false,
});

describe('recent files helpers', () => {
  it('groups by local day', () => {
    expect(dayGroup(NOW - HOUR, NOW)).toBe('Today');
    expect(dayGroup(NOW - 20 * HOUR, NOW)).toBe('Yesterday');
    expect(dayGroup(NOW - 4 * 24 * HOUR, NOW)).toBe('This week');
    expect(dayGroup(NOW - 30 * 24 * HOUR, NOW)).toBe('Earlier');
  });

  it('inserts a header with a count before each group', () => {
    const rows = groupRows(
      [file('a.md', NOW - HOUR), file('b.md', NOW - 2 * HOUR), file('c.md', NOW - 40 * 24 * HOUR)],
      NOW,
    );
    expect(
      rows.map((r) => (r.kind === 'header' ? `${r.group}:${String(r.count)}` : r.file.relPath)),
    ).toEqual(['Today:2', 'a.md', 'b.md', 'Earlier:1', 'c.md']);
  });

  it('formats relative times', () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 4 * 60_000, NOW)).toBe('4 minutes ago');
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe('3 hours ago');
    expect(relativeTime(NOW - 24 * HOUR, NOW)).toBe('yesterday');
  });

  it('marks files modified after the session start or reported by the watcher', () => {
    const s = { sessionStartMs: NOW, changed: new Set(['b.md']) };
    expect(isChangedInSession(file('a.md', NOW + 1), s)).toBe(true);
    expect(isChangedInSession(file('b.md', 0), s)).toBe(true);
    expect(isChangedInSession(file('c.md', NOW - 1), s)).toBe(false);
  });
});

describe('recent files store', () => {
  let stop: () => void = () => undefined;

  beforeEach(async () => {
    window.__igraspMock?.reset();
    stop = await startEventBridge();
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await vi.waitFor(() => {
      expect(useWorkspace.getState().index.state).toBe('ready');
    });
  });

  afterEach(async () => {
    stop();
    vi.useRealTimers();
    await useWorkspace.getState().closeRoot();
  });

  it('loads newest first and moves a rewritten file to the top with a marker', async () => {
    await useRecentFiles.getState().load();
    expect(useRecentFiles.getState().files[0]?.relPath).toBe('docs/guide/getting-started.md');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.__igraspMock?.writeFiles({ 'notes/TODO.MD': '# TODO\n\nUpdated.\n' });
    expect(useRecentFiles.getState().changed.has('notes/TODO.MD')).toBe(true);
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    vi.useRealTimers();
    await vi.waitFor(() => {
      expect(useRecentFiles.getState().files[0]?.relPath).toBe('notes/TODO.MD');
    });
    useRecentFiles.getState().clearMarkers();
    expect(useRecentFiles.getState().changed.size).toBe(0);
  });

  it('is reset when another folder is opened', async () => {
    await useRecentFiles.getState().load();
    await useWorkspace.getState().closeRoot();
    expect(useRecentFiles.getState().files).toEqual([]);
    expect(useRecentFiles.getState().status).toBe('idle');
  });
});
