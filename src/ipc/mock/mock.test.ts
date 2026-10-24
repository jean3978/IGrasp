import { describe, expect, it, vi } from 'vitest';
import { createMockBackend } from '.';
import type { Session } from '../types';
import { FIXTURE_ROOT } from './fixture';

const session: Session = {
  version: 1,
  tabs: [{ relPath: 'README.md', pinned: true, scrollTop: 10 }],
  activeTab: 'README.md',
  expandedDirs: [],
  sidebar: { visible: true, widthPx: 260 },
  sidebarView: 'explorer',
  rightPanel: { visible: false, widthPx: 260 },
  showDotfiles: false,
  showIgnored: false,
  savedAtMs: 0,
};

describe('mock backend', () => {
  it('stores sessions per root', async () => {
    const b = createMockBackend();
    await b.saveSession('/a', session);
    expect((await b.getSession('/a'))?.tabs[0]?.relPath).toBe('README.md');
    expect(await b.getSession('/b')).toBeNull();
  });

  it('delivers emitted events until unsubscribed', async () => {
    const b = createMockBackend();
    const handler = vi.fn();
    const off = await b.listen('appdata://recovered', handler);
    b.controls.emit('appdata://recovered', { file: 'settings.json' });
    off();
    b.controls.emit('appdata://recovered', { file: 'x.json' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ file: 'settings.json' });
  });

  it('lists recent files newest first, paged', async () => {
    const b = createMockBackend();
    await b.openRoot(FIXTURE_ROOT);
    await new Promise((r) => setTimeout(r, 5));
    b.controls.writeFiles({ 'notes/TODO.MD': '# TODO\n' });
    b.controls.writeFiles({ 'docs/architecture.md': '# Architecture\n' });
    const first = await b.listRecentFiles(0, 2);
    expect(first.files.map((f) => f.relPath)).toEqual(['docs/architecture.md', 'notes/TODO.MD']);
    expect(first.total).toBe(7);
    const rest = await b.listRecentFiles(2, 100);
    expect(rest.files).toHaveLength(5);
    expect(rest.files[0]?.relPath).toBe('docs/guide/getting-started.md');
    const times = rest.files.map((f) => f.modifiedMs);
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  it('normalizes settings like the Rust backend', async () => {
    const b = createMockBackend();
    const s = await b.updateSettings({ fontSize: 3, ignorePatterns: [' a ', '', '# c'] });
    expect(s.fontSize).toBe(12);
    expect(s.ignorePatterns).toEqual(['a']);
  });
});
