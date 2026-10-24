import { describe, expect, it } from 'vitest';
import { diffStats, lineDiff } from './diff';

describe('lineDiff', () => {
  it('marks changed lines and keeps the common ones', () => {
    const lines = lineDiff('# Notes\n\nHello world.\n', '# Notes\n\nHello IGrasp.\n');
    expect(lines).toEqual([
      { type: 'same', text: '# Notes' },
      { type: 'same', text: '' },
      { type: 'del', text: 'Hello world.' },
      { type: 'add', text: 'Hello IGrasp.' },
    ]);
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 });
  });

  it('handles insertions, deletions, CRLF and empty sides', () => {
    expect(lineDiff('a\nb', 'a\nx\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'x' },
      { type: 'same', text: 'b' },
    ]);
    expect(lineDiff('a\r\nb\r\n', 'b\n')).toEqual([
      { type: 'del', text: 'a' },
      { type: 'same', text: 'b' },
    ]);
    expect(lineDiff('', 'new\nfile')).toEqual([
      { type: 'add', text: 'new' },
      { type: 'add', text: 'file' },
    ]);
    expect(lineDiff('gone', '')).toEqual([{ type: 'del', text: 'gone' }]);
    expect(lineDiff('', '')).toEqual([]);
  });

  it('is identical for identical texts', () => {
    const lines = lineDiff('x\ny\n', 'x\ny\n');
    expect(lines.every((l) => l.type === 'same')).toBe(true);
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0 });
  });
});
