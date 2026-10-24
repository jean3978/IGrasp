// Full-text search of the mock backend, with the same option semantics, glob rules, caps and
// batched `search://results` events as `src-tauri/src/search/` (JavaScript RegExp instead of the
// Rust regex engine).

import { BackendError } from '../types';
import type { FileMatches, TextMatch, TextSearchRequest } from '../types';

export const MAX_LINE_CHARS = 500;
const BOM = String.fromCharCode(0xfeff);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildRegExp(req: TextSearchRequest): RegExp {
  if (req.query === '') throw new BackendError('InvalidPattern', 'The search is empty.');
  let source = req.regex ? req.query : escapeRegExp(req.query);
  if (req.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return new RegExp(source, req.matchCase ? 'gu' : 'giu');
  } catch (err) {
    throw new BackendError('InvalidPattern', err instanceof Error ? err.message : String(err));
  }
}

function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? '';
    if (c === '*' && glob[i + 1] === '*') {
      out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += escapeRegExp(c);
  }
  return new RegExp(`^${out}$`);
}

/** Comma-separated VS Code-style globs (Rust `globs::compile`); null when empty. */
export function compileGlobs(patterns: string): RegExp[] | null {
  const list = patterns
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (list.length === 0) return null;
  const out: RegExp[] = [];
  for (const raw of list) {
    let p = raw.replace(/^\.\//, '').replace(/^\//, '');
    p = p.replace(/\/$/, '').replace(/\/\*\*$/, '');
    if (p === '') continue;
    if (/\[[^\]]*$/.test(p)) throw new BackendError('InvalidPattern', `${raw}: unclosed class`);
    const variants = p.includes('/') ? [p, `${p}/**`] : [p, `**/${p}`, `${p}/**`, `**/${p}/**`];
    out.push(...variants.map(globToRegExp));
  }
  return out;
}

export function makeMatch(re: RegExp, line: number, raw: string): TextMatch | null {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  const spans: [number, number][] = [];
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    if (m[0] === '') continue;
    const start = Array.from(text.slice(0, m.index)).length;
    spans.push([start, start + Array.from(m[0]).length]);
  }
  if (spans.length === 0) return null;
  const chars = Array.from(text);
  let from = 0;
  if (chars.length > MAX_LINE_CHARS) {
    from = Math.max(0, (spans[0]?.[0] ?? 0) - MAX_LINE_CHARS / 5);
  }
  const to = Math.min(chars.length, from + MAX_LINE_CHARS);
  return {
    line,
    text: chars.slice(from, to).join(''),
    ranges: spans
      .filter(([s, e]) => s >= from && e <= to)
      .map(([s, e]): [number, number] => [s - from, e - from]),
  };
}

export function searchContent(re: RegExp, content: string, limit: number): TextMatch[] {
  const matches: TextMatch[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length && matches.length < limit; i++) {
    const m = makeMatch(re, i + 1, lines[i] ?? '');
    if (m) matches.push(m);
  }
  return matches;
}

export function filterFiles(paths: string[], req: TextSearchRequest): string[] {
  const include = compileGlobs(req.include);
  const exclude = compileGlobs(req.exclude);
  return paths
    .filter((p) => (include ? include.some((g) => g.test(p)) : true))
    .filter((p) => !(exclude?.some((g) => g.test(p)) ?? false))
    .sort();
}

export type { FileMatches };
