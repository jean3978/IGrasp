import { describe, expect, it, vi } from 'vitest';
import { createMockBackend } from '.';
import { FIXTURE_ROOT } from './fixture';
import { subsequence } from './mockSymbols';

describe('mock symbol search', () => {
  it('scores subsequences with smart case', () => {
    expect(subsequence('arch', 'architecture.md')?.matched).toEqual([0, 1, 2, 3]);
    expect(subsequence('ARCH', 'architecture.md')).toBeNull();
    expect(subsequence('gs', 'getting-started.md')).not.toBeNull();
  });

  it('searches files and headings of the fixture like Rust', async () => {
    const b = createMockBackend();
    await b.openRoot(FIXTURE_ROOT);
    await vi.waitFor(async () => {
      expect((await b.getGraphStatus()).ready).toBe(true);
    });
    const r = await b.searchSymbols({ query: 'arch', recent: [], requestId: 7 });
    expect(r.requestId).toBe(7);
    expect(r.files[0]?.relPath).toBe('docs/architecture.md');
    expect(r.headings[0]).toMatchObject({ name: 'Architecture', slug: 'architecture', level: 1 });

    const headingsOnly = await b.searchSymbols({ query: '#install', recent: [], requestId: 8 });
    expect(headingsOnly.files).toEqual([]);
    expect(headingsOnly.headings.map((h) => h.relPath)).toEqual(['docs/guide/getting-started.md']);

    const recent = await b.searchSymbols({
      query: '',
      recent: ['notes/TODO.MD', 'gone.md', 'README.md'],
      requestId: 9,
    });
    expect(recent.files.map((f) => f.relPath)).toEqual(['notes/TODO.MD', 'README.md']);
  });
});
