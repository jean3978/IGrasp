import { describe, expect, it } from 'vitest';
import { FIXTURE_FILES } from './fixture';
import { listFixtureDir, scanFixture } from './mockIndex';

const files = new Map(Object.entries(FIXTURE_FILES));
const base = { showDotfiles: false, showIgnored: false, ignorePatterns: [] };

describe('mock index', () => {
  it('keeps only visible markdown files', () => {
    const paths = [...scanFixture(files, base).keys()].sort();
    expect(paths).toEqual([
      'AGENTS.md',
      'CHANGELOG.md',
      'README.md',
      'docs/AGENTS.md',
      'docs/architecture.md',
      'docs/decisions/0001-use-git-cli.md',
      'docs/guide/advanced/deep-dive.markdown',
      'docs/guide/getting-started.md',
      'notes/TODO.MD',
    ]);
  });

  it('shows dotfiles and ignored files on request, flagged as hidden', () => {
    const index = scanFixture(files, { ...base, showDotfiles: true, showIgnored: true });
    expect(index.get('.github/CONTRIBUTING.md')?.hidden).toBe(true);
    expect(index.get('build/output.md')?.hidden).toBe(true);
    expect(index.has('node_modules/some-pkg/README.md')).toBe(false);
  });

  it('applies extra ignore patterns', () => {
    const index = scanFixture(files, { ...base, ignorePatterns: ['docs/guide/', '*.MD'] });
    expect(index.has('docs/guide/getting-started.md')).toBe(false);
    expect(index.has('notes/TODO.MD')).toBe(false);
    expect(index.has('docs/architecture.md')).toBe(true);
  });

  it('lists folders first, in natural order, hiding folders without markdown', () => {
    const listing = listFixtureDir(scanFixture(files, base), '');
    expect(listing?.dirs.map((d) => d.name)).toEqual(['docs', 'notes']);
    expect(listing?.dirs[0]?.mdCount).toBe(5);
    expect(listing?.files.map((f) => f.name)).toEqual(['AGENTS.md', 'CHANGELOG.md', 'README.md']);
    expect(listFixtureDir(scanFixture(files, base), 'src')).toBeNull();
  });
});
