import { describe, expect, it, vi } from 'vitest';
import { createMockBackend } from '.';
import type { Session } from '../types';

const session: Session = {
  version: 1,
  tabs: [{ relPath: 'README.md', pinned: true, scrollTop: 10 }],
  activeTab: 'README.md',
  expandedDirs: [],
  sidebar: { visible: true, widthPx: 260 },
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

  it('normalizes settings like the Rust backend', async () => {
    const b = createMockBackend();
    const s = await b.updateSettings({ fontSize: 3, ignorePatterns: [' a ', '', '# c'] });
    expect(s.fontSize).toBe(12);
    expect(s.ignorePatterns).toEqual(['a']);
  });
});
