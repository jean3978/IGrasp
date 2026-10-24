// Markdown index of the mock project, following the same rules as the Rust scanner closely
// enough for UI work and tests (simplified gitignore matching).

import type { DirEntry, FileEntry } from '../types';

export interface MockScanOptions {
  showDotfiles: boolean;
  showIgnored: boolean;
  ignorePatterns: string[];
}

const ALWAYS_SKIPPED = new Set(['.git', 'node_modules']);
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export const isMarkdown = (name: string) => /.\.(md|markdown)$/i.test(name);

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/** Simplified gitignore: `name/` matches a folder at any depth, other globs match base names. */
function matches(patterns: string[], rel: string): boolean {
  const parts = rel.split('/');
  return patterns.some((p) => {
    if (p.endsWith('/')) {
      const dir = p.slice(0, -1);
      if (dir.includes('/')) return rel.startsWith(`${dir}/`);
      return parts.slice(0, -1).includes(dir);
    }
    const re = globToRegExp(p);
    return re.test(parts[parts.length - 1] ?? '') || re.test(rel);
  });
}

function gitignorePatterns(files: Map<string, string>): string[] {
  return (files.get('.gitignore') ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

const isDotted = (rel: string) => rel.split('/').some((s) => s.startsWith('.'));

export function scanFixture(
  files: Map<string, string>,
  opts: MockScanOptions,
  now = 0,
): Map<string, FileEntry> {
  const ignored = gitignorePatterns(files);
  const out = new Map<string, FileEntry>();
  for (const [rel, content] of files) {
    const parts = rel.split('/');
    const name = parts[parts.length - 1] ?? rel;
    if (!isMarkdown(name)) continue;
    if (parts.some((p) => ALWAYS_SKIPPED.has(p))) continue;
    if (matches(opts.ignorePatterns, rel)) continue;
    const dotted = isDotted(rel);
    if (dotted && !opts.showDotfiles) continue;
    const isIgnored = matches(ignored, rel);
    if (isIgnored && !opts.showIgnored) continue;
    out.set(rel, {
      name,
      relPath: rel,
      size: content.length,
      modifiedMs: now,
      hidden: dotted || isIgnored,
    });
  }
  return out;
}

export function listFixtureDir(
  index: Map<string, FileEntry>,
  dir: string,
  ignored: string[] = [],
): { dirs: DirEntry[]; files: FileEntry[] } | null {
  const prefix = dir === '' ? '' : `${dir}/`;
  const dirs = new Map<string, DirEntry>();
  const files: FileEntry[] = [];
  for (const [rel, entry] of index) {
    if (!rel.startsWith(prefix)) continue;
    const rest = rel.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash < 0) {
      files.push(entry);
      continue;
    }
    const name = rest.slice(0, slash);
    const relPath = `${prefix}${name}`;
    const existing = dirs.get(name);
    if (existing) existing.mdCount += 1;
    else
      dirs.set(name, {
        name,
        relPath,
        mdCount: 1,
        hidden: isDotted(relPath) || matches(ignored, `${relPath}/x`),
      });
  }
  if (dir !== '' && dirs.size === 0 && files.length === 0) return null;
  const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name);
  return { dirs: [...dirs.values()].sort(byName), files: files.sort(byName) };
}

export { gitignorePatterns };
