import { describe, expect, it } from 'vitest';
import {
  dirname,
  fragmentOf,
  hasScheme,
  isMarkdownPath,
  resolveRelative,
  toAbsolute,
} from './paths';

describe('paths', () => {
  it('resolves paths relative to the document folder', () => {
    expect(resolveRelative('docs/guide/a.md', 'img/x.png')).toBe('docs/guide/img/x.png');
    expect(resolveRelative('docs/guide/a.md', './x.png')).toBe('docs/guide/x.png');
    expect(resolveRelative('docs/guide/a.md', '../b.md')).toBe('docs/b.md');
    expect(resolveRelative('README.md', 'docs/a.md')).toBe('docs/a.md');
  });

  it('treats a leading slash as the root', () => {
    expect(resolveRelative('docs/guide/a.md', '/assets/x.png')).toBe('assets/x.png');
  });

  it('refuses to climb above the root', () => {
    expect(resolveRelative('docs/a.md', '../../secret.md')).toBeNull();
    expect(resolveRelative('a.md', '../x')).toBeNull();
    expect(resolveRelative('a.md', '/')).toBeNull();
  });

  it('ignores URLs with a scheme and protocol-relative URLs', () => {
    expect(resolveRelative('a.md', 'https://example.com/x.png')).toBeNull();
    expect(resolveRelative('a.md', 'file:///etc/passwd')).toBeNull();
    expect(resolveRelative('a.md', '//example.com/x')).toBeNull();
    expect(hasScheme('mailto:a@b.c')).toBe(true);
    expect(hasScheme('docs/a.md')).toBe(false);
  });

  it('drops query and fragment and decodes escapes', () => {
    expect(resolveRelative('a.md', 'my%20file.md#part')).toBe('my file.md');
    expect(resolveRelative('a.md', 'b.md?x=1')).toBe('b.md');
    expect(resolveRelative('a.md', '#only-anchor')).toBeNull();
    expect(resolveRelative('a.md', 'docs\\b.md')).toBe('docs/b.md');
  });

  it('reads fragments', () => {
    expect(fragmentOf('#install')).toBe('install');
    expect(fragmentOf('b.md#caf%C3%A9')).toBe('café');
    expect(fragmentOf('b.md')).toBeNull();
    expect(fragmentOf('b.md#')).toBeNull();
  });

  it('joins absolute paths with the root separator', () => {
    expect(toAbsolute('C:\\proj', 'docs/a.md')).toBe('C:\\proj\\docs\\a.md');
    expect(toAbsolute('/home/u/proj/', 'a.md')).toBe('/home/u/proj/a.md');
    expect(dirname('a/b/c.md')).toBe('a/b');
    expect(isMarkdownPath('X.MARKDOWN')).toBe(true);
    expect(isMarkdownPath('x.mdx')).toBe(false);
  });
});
