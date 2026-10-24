// "Search everything" of the mock backend: a simple subsequence scorer with the same query rules
// as `src-tauri/src/search/symbols.rs` (`#` for headings only, `/` matches paths, smart case,
// recent files first).

import type { SymbolHit, SymbolSearchRequest, SymbolSearchResult } from '../types';
import type { MockDoc } from './mockGraph';

const RECENT_BONUS = 60;

/** Score and matched code point positions of `needle` as a subsequence of `haystack`. */
export function subsequence(
  needle: string,
  haystack: string,
): { score: number; matched: number[] } | null {
  const smart = needle === needle.toLowerCase();
  const hay = Array.from(smart ? haystack.toLowerCase() : haystack);
  const ned = Array.from(needle.replace(/\s+/g, ''));
  const matched: number[] = [];
  let score = 0;
  let at = 0;
  for (const ch of ned) {
    while (at < hay.length && hay[at] !== ch) at += 1;
    if (at >= hay.length) return null;
    const previous = matched[matched.length - 1];
    score += 16;
    if (previous !== undefined && previous === at - 1) score += 12;
    if (at === 0 || /[\s/_.-]/.test(hay[at - 1] ?? '')) score += 8;
    matched.push(at);
    at += 1;
  }
  return { score, matched };
}

const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

export function searchSymbols(
  request: SymbolSearchRequest,
  files: string[],
  graph: Map<string, MockDoc> | null,
  generation: number,
): SymbolSearchResult {
  const limit = request.limit ?? 50;
  const recent = request.recent.slice(0, 50);
  const bonus = (rel: string) => {
    const i = recent.indexOf(rel);
    return i < 0 ? 0 : Math.max(0, RECENT_BONUS - i);
  };
  const trimmed = request.query.trim();
  const headingsOnly = trimmed.startsWith('#') || (request.headingsOnly ?? false);
  const query = trimmed.startsWith('#') ? trimmed.slice(1).trim() : trimmed;
  const result: SymbolSearchResult = {
    requestId: request.requestId,
    generation,
    graphReady: graph !== null,
    files: [],
    headings: [],
  };
  const file = (rel: string, score: number, matched: number[], matchedIn: 'name' | 'path') =>
    ({
      kind: 'file',
      relPath: rel,
      name: nameOf(rel),
      line: null,
      slug: null,
      level: null,
      score,
      matched,
      matchedIn,
    }) satisfies SymbolHit;
  if (query === '') {
    if (!headingsOnly) {
      result.files = recent
        .filter((r) => files.includes(r))
        .slice(0, limit)
        .map((r) => file(r, 0, [], 'name'));
    }
    return result;
  }
  const order = (a: SymbolHit, b: SymbolHit) =>
    b.score - a.score ||
    a.relPath.length - b.relPath.length ||
    (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0) ||
    (a.line ?? 0) - (b.line ?? 0);
  if (!headingsOnly) {
    for (const rel of files) {
      if (query.includes('/')) {
        const m = subsequence(query, rel);
        if (m) result.files.push(file(rel, m.score + bonus(rel), m.matched, 'path'));
        continue;
      }
      const byName = subsequence(query, nameOf(rel));
      const byPath = byName ? null : subsequence(query, rel);
      if (byName) result.files.push(file(rel, byName.score + bonus(rel), byName.matched, 'name'));
      else if (byPath)
        result.files.push(file(rel, byPath.score / 2 + bonus(rel), byPath.matched, 'path'));
    }
    result.files = result.files.sort(order).slice(0, limit);
  }
  for (const [rel, doc] of graph ?? []) {
    for (const h of doc.headings) {
      const m = subsequence(query, h.text);
      if (!m) continue;
      result.headings.push({
        kind: 'heading',
        relPath: rel,
        name: h.text,
        line: h.line,
        slug: h.slug,
        level: h.level,
        score: m.score + bonus(rel) / 2,
        matched: m.matched,
        matchedIn: 'name',
      });
    }
  }
  result.headings = result.headings.sort(order).slice(0, limit);
  return result;
}
