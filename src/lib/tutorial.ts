// Pure helpers over the tutorial model (the types exported from Rust's
// `learning/tutorial/schema.rs`), shared by the Academy and the mock backend. The ones that
// mirror Rust (`citations`, `slug`, `hashLines`, `normalizeTutorial`) must behave exactly like
// it: the mock stands in for the backend in the browser and in every test.

import { sha256Hex } from './sha256';
import type { Citation, SourceHash, Step, Tutorial } from '../ipc/types';

const cite = (path: string, firstLine: number, lastLine: number): Citation => ({
  path,
  firstLine,
  lastLine,
});

/** Every citation of a step (a tour's stops and a spot-it's snippet included), like Rust. */
export function stepCitations(step: Step): Citation[] {
  switch (step.type) {
    case 'codeTour':
      return step.stops.map((s) => cite(s.path, s.firstLine, s.lastLine));
    case 'spotIt':
      return [cite(step.path, step.firstLine, step.lastLine)];
    default:
      return step.sources;
  }
}

/** The heading of a step in the markdown and the UI, like Rust's `Step::title`. */
export function stepTitle(step: Step): string {
  switch (step.type) {
    case 'quickCheck':
      return step.question;
    case 'recap':
      return 'Recap';
    default:
      return step.title;
  }
}

/** `"12-30"`, `"7"`, or undefined for a whole file. */
export function citationLines(c: Pick<Citation, 'firstLine' | 'lastLine'>): string | undefined {
  const a = c.firstLine;
  const b = c.lastLine;
  if (a !== undefined && b !== undefined) return a === b ? `${a}` : `${a}-${b}`;
  if (a !== undefined) return `${a}`;
  if (b !== undefined) return `${b}`;
  return undefined;
}

/** Every distinct citation of every written chapter, in order of appearance (no "why"). */
export function tutorialCitations(t: Tutorial): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of t.chapters)
    for (const s of c.steps)
      for (const x of stepCitations(s)) {
        const key = `${x.path}\u0000${x.firstLine ?? ''}\u0000${x.lastLine ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const { why: _why, ...rest } = x;
        out.push(rest);
      }
  return out;
}

/** `the-watcher` from `The watcher!`, like Rust's `markdown::slug`. */
export function slug(text: string): string {
  let out = '';
  let dash = true;
  for (const c of text) {
    if (/[\p{L}\p{N}]/u.test(c)) {
      out += c.toLowerCase();
      dash = false;
    } else if (!dash) {
      out += '-';
      dash = true;
    }
  }
  out = out.replace(/-+$/, '');
  return out === '' ? 'chapter' : out;
}

/** The SHA-256 (hex) of `lines` joined with `\n`, `\r` removed (the quiz files' hash). */
export function hashLines(lines: string[]): string {
  return sha256Hex(lines.map((l) => l.replace(/\r/g, '')).join('\n'));
}

const linesOf = (text: string) => text.replace(/\r\n/g, '\n').split('\n');

/**
 * The sources of `t` hashed against `read` (a file's text, or undefined when it is gone or not
 * text); a citation already recorded keeps its hash, like Rust's `merge_source_hashes`.
 */
export function mergeSourceHashes(
  t: Tutorial,
  read: (path: string) => string | undefined,
): SourceHash[] {
  const files = new Map<string, string[] | undefined>();
  return tutorialCitations(t).map((c) => {
    const lines = citationLines(c);
    const known = t.sources.find((s) => s.path === c.path && s.lines === lines);
    if (known) return known;
    let file = files.get(c.path);
    if (!files.has(c.path)) {
      const text = read(c.path);
      file = text === undefined ? undefined : linesOf(text);
      files.set(c.path, file);
    }
    const a = c.firstLine;
    const b = c.lastLine;
    const sha256 =
      file !== undefined && a !== undefined && b !== undefined && a >= 1 && b <= file.length
        ? hashLines(file.slice(a - 1, b))
        : undefined;
    return {
      path: c.path,
      ...(lines === undefined ? {} : { lines }),
      ...(sha256 === undefined ? {} : { sha256 }),
    };
  });
}

/** A step's key in the progress: `"<chapter id>:<step index>"`. */
export const stepKey = (chapterId: string, index: number) => `${chapterId}:${index}`;

/** JSON with sorted keys, without nulls, empty lists and self-checks (Rust skips them too). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(
        ([k, v]) =>
          v !== undefined &&
          v !== null &&
          !(Array.isArray(v) && v.length === 0) &&
          k !== 'selfCheck',
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The hash a step had when the reader completed it: a step whose hash differs now is "updated
 * since you read it". Line numbers are left out, so a relocation alone does not mark it.
 */
export function stepHash(step: Step): string {
  const json = canonicalJson(step).replace(/"(?:firstLine|lastLine|answerLine)":\d+,?/g, '');
  return sha256Hex(json).slice(0, 16);
}

const oneLine = (s: string) => s.split(/\s+/).filter(Boolean).join(' ');
const trimmed = (s: string) => s.replace(/\r\n/g, '\n').trim();
/** A trimmed optional text: undefined when absent or blank (the field is then dropped). */
const trimmedOpt = (v: string | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const t = trimmed(v);
  return t === '' ? undefined : t;
};
/** Sets an optional field, deleting it when undefined (exact optional properties). */
function setOpt<T extends object>(o: T, k: keyof T & string, v: string | undefined) {
  const r = o as Record<string, unknown>;
  if (v === undefined) Reflect.deleteProperty(r, k);
  else r[k] = v;
}
function why(cs: Citation[]) {
  for (const c of cs) {
    if (c.why === undefined) continue;
    const w = oneLine(c.why).replaceAll(' · ', ', ').replaceAll(' — ', ' - ');
    if (w === '') delete c.why;
    else c.why = w;
  }
}

/** Normalizes a copy of `t` like Rust's `markdown::normalize` (and drops the self-checks). */
export function normalizeTutorial(input: Tutorial): Tutorial {
  const t = structuredClone(input);
  t.title = oneLine(t.title);
  t.intro = trimmed(t.intro);
  t.subject = oneLine(t.subject);
  for (const k of ['domainGap', 'role', 'materialNote', 'docsNote'] as const)
    setOpt(t, k, trimmedOpt(t[k]));
  for (const c of t.chapters) {
    c.title = oneLine(c.title);
    c.goal = trimmed(c.goal);
    if (c.hootIntro !== undefined) c.hootIntro = oneLine(c.hootIntro);
    for (const s of c.steps) {
      delete s.selfCheck;
      // Rust omits an empty list of sources (a recap's) when it writes JSON.
      (s as { sources?: Citation[] }).sources ??= [];
      switch (s.type) {
        case 'explain':
          s.title = oneLine(s.title);
          s.body = trimmed(s.body);
          why(s.sources);
          break;
        case 'conceptBridge':
          s.title = oneLine(s.title);
          s.concept = oneLine(s.concept);
          s.applied = trimmed(s.applied);
          setOpt(s, 'docsUrl', trimmedOpt(s.docsUrl));
          why(s.sources);
          break;
        case 'codeTour':
          s.title = oneLine(s.title);
          for (const stop of s.stops) stop.annotation = trimmed(stop.annotation);
          break;
        case 'diagram':
          s.title = oneLine(s.title);
          s.mermaid = trimmed(s.mermaid);
          setOpt(s, 'caption', trimmedOpt(s.caption));
          why(s.sources);
          break;
        case 'putInOrder':
        case 'match':
          s.title = oneLine(s.title);
          s.prompt = trimmed(s.prompt);
          s.explanation = trimmed(s.explanation);
          why(s.sources);
          break;
        case 'spotIt':
          s.title = oneLine(s.title);
          s.prompt = trimmed(s.prompt);
          s.explanation = trimmed(s.explanation);
          break;
        case 'quickCheck':
          s.question = oneLine(s.question);
          s.hint = trimmed(s.hint);
          s.explanation = trimmed(s.explanation);
          why(s.sources);
          break;
        case 'tryIt':
          s.title = oneLine(s.title);
          s.instruction = trimmed(s.instruction);
          setOpt(s, 'command', trimmedOpt(s.command));
          setOpt(s, 'expected', trimmedOpt(s.expected));
          why(s.sources);
          break;
        case 'recap':
          s.takeaways = s.takeaways.map(oneLine);
          why(s.sources);
          break;
      }
    }
  }
  return t;
}

/** The id of a new tutorial, like Rust's `new_tutorial_id`. */
export function newTutorialId(subject: string, generated: string): string {
  let s = slug(subject);
  if (s.length > 40) s = s.slice(0, 40).replace(/-+$/, '');
  if (s === '' || s === 'chapter') s = 'tutorial';
  const date = generated.replace(/\D/g, '').slice(0, 8);
  const hex = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `${s}-${date}-${hex}`;
}
