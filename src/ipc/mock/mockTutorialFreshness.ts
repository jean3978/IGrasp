// The local freshness check of a tutorial in the mock, like `learning/tutorial/freshness.rs`: each
// recorded range is hashed again against the fake disk; the same lines found elsewhere in the
// file are "moved" (relocated), other differences "changed", a gone file "missing". No token.

import type {
  Badge,
  Citation,
  FreshnessReport,
  SourceCheck,
  SourceState,
  Step,
  StepRef,
  Tutorial,
} from '../types';
import { citationLines, hashLines, stepCitations } from '../../lib/tutorial';

/** Rust's `str::lines`: no trailing empty line after a final newline, `\r\n` handled. */
function linesOf(text: string): string[] {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function range(lines: string | undefined): [number, number] | null {
  if (lines === undefined) return null;
  const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(lines);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return a >= 1 && a <= b ? [a, b] : null;
}

/** The nearest other window of `file` whose lines hash to `sha256`. */
function findMoved(file: string[], len: number, sha256: string, except: number): number | null {
  if (len === 0 || file.length < len) return null;
  let best: number | null = null;
  for (let start = 0; start + len <= file.length; start++) {
    const first = start + 1;
    if (first === except) continue;
    if (hashLines(file.slice(start, start + len)) !== sha256) continue;
    if (best === null || Math.abs(first - except) < Math.abs(best - except)) best = first;
  }
  return best;
}

export interface MockFreshness {
  checks: SourceCheck[];
  badge: Badge;
  moved: number;
}

export function checkFreshness(
  t: Tutorial,
  read: (path: string) => string | undefined,
): MockFreshness {
  const cache = new Map<string, string[] | null>();
  const fileOf = (path: string) => {
    if (!cache.has(path)) {
      const text = read(path);
      cache.set(path, text === undefined ? null : linesOf(text));
    }
    return cache.get(path) ?? null;
  };
  const checks: SourceCheck[] = t.sources.map((s) => {
    const r = range(s.lines);
    const file = fileOf(s.path);
    let state: SourceState;
    if (s.sha256 !== undefined && r) {
      const [a, b] = r;
      if (!file) state = { state: 'missing' };
      else if (b <= file.length && hashLines(file.slice(a - 1, b)) === s.sha256)
        state = { state: 'upToDate' };
      else {
        const first = findMoved(file, b - a + 1, s.sha256, a);
        state =
          first === null
            ? { state: 'changed' }
            : { state: 'moved', firstLine: first, lastLine: first + (b - a) };
      }
    } else state = file ? { state: 'unchecked' } : { state: 'missing' };
    return { path: s.path, lines: s.lines ?? null, ...state };
  });
  const of = checks.length;
  const missing = checks.filter((c) => c.state === 'missing').length;
  const changed = checks.filter((c) => c.state === 'changed').length;
  const moved = checks.filter((c) => c.state === 'moved').length;
  const badge: Badge =
    missing > 0
      ? { badge: 'sourcesMissing', missing, of }
      : changed > 0
        ? { badge: 'maybeOutdated', changed, of }
        : { badge: 'upToDate' };
  return { checks, badge, moved };
}

function relocateStep(step: Step, path: string, from: [number, number], to: [number, number]) {
  const fix = (c: Citation) => {
    if (c.path === path && c.firstLine === from[0] && c.lastLine === from[1]) {
      c.firstLine = to[0];
      c.lastLine = to[1];
    }
  };
  switch (step.type) {
    case 'codeTour':
      for (const s of step.stops)
        if (s.path === path && s.firstLine === from[0] && s.lastLine === from[1]) {
          s.firstLine = to[0];
          s.lastLine = to[1];
        }
      break;
    case 'spotIt':
      if (step.path === path && step.firstLine === from[0] && step.lastLine === from[1]) {
        step.answerLine = step.answerLine - from[0] + to[0];
        step.firstLine = to[0];
        step.lastLine = to[1];
      }
      break;
    default:
      step.sources.forEach(fix);
  }
}

/** Applies the moves to a copy of `t` (citations and the sources table); the hashes stay. */
export function relocate(t: Tutorial, f: MockFreshness): [Tutorial, number] {
  const copy = structuredClone(t);
  let moved = 0;
  for (const c of f.checks) {
    if (c.state !== 'moved') continue;
    const from = range(c.lines ?? undefined);
    if (!from) continue;
    const to: [number, number] = [c.firstLine, c.lastLine];
    for (const chapter of copy.chapters)
      for (const step of chapter.steps) {
        moved += stepCitations(step).filter(
          (x) => x.path === c.path && x.firstLine === from[0] && x.lastLine === from[1],
        ).length;
        relocateStep(step, c.path, from, to);
      }
    const lines = citationLines({ firstLine: to[0], lastLine: to[1] }) ?? String(to[0]);
    for (const s of copy.sources) if (s.path === c.path && s.lines === c.lines) s.lines = lines;
  }
  return [copy, moved];
}

/** The steps citing a changed or missing range (or file). */
export function affectedSteps(t: Tutorial, f: MockFreshness): StepRef[] {
  const bad = f.checks.filter((c) => c.state === 'changed' || c.state === 'missing');
  const out: StepRef[] = [];
  t.chapters.forEach((chapter, ci) => {
    chapter.steps.forEach((step, si) => {
      const hit = stepCitations(step).some((c) =>
        bad.some(
          (b) => b.path === c.path && (b.lines === null || b.lines === (citationLines(c) ?? null)),
        ),
      );
      if (hit) out.push({ chapter: ci, step: si });
    });
  });
  return out;
}

/** Rust's `freshness::report`: `save` keeps a private copy's relocation and returns true. */
export function freshnessReport(
  t: Tutorial,
  read: (path: string) => string | undefined,
  save: (relocated: Tutorial) => boolean,
): FreshnessReport {
  const f = checkFreshness(t, read);
  let relocatedSaved = 0;
  let relocated: Tutorial | null = null;
  if (f.moved > 0) {
    const [copy, n] = relocate(t, f);
    if (save(copy)) relocatedSaved = n;
    else relocated = copy;
  }
  return {
    badge: f.badge,
    checks: f.checks,
    affected: affectedSteps(t, f),
    relocatedSaved,
    relocated,
  };
}
