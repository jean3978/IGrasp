// Shareable quiz files (ADR 0024): a quiz the AI wrote, saved as markdown so anyone can replay it
// without the AI. A front matter (`igrasp: quiz`, the subject, the starting level, every cited
// range with a SHA-256 of its lines), then per question a `## n. question` heading and an
// `igrasp-quiz` YAML block. Reading tolerates hand edits: a block that does not parse is skipped
// and counted. The citations are checked locally when the quiz loads: a changed range or a
// missing file is flagged on the reveal, the question stays playable.

import { parse, stringify } from 'yaml';
import type {
  QuestionKind,
  QuizQuestion,
  QuizRecord,
  QuizSource,
  QuizSourceKind,
  SourceScope,
} from '../../ipc/types';
import { sha256Hex } from '../../lib/sha256';
import { slug } from './quizMarkdown';

/** A file's text as the backend returns it (`truncated`: the end is missing). */
export interface SourceText {
  content: string;
  truncated: boolean;
}

/** Reads a root-relative file; null when it does not exist or is not text. */
export type ReadSource = (relPath: string) => Promise<SourceText | null>;

/** What a cited source looks like now, compared with the quiz file. */
export interface SourceNote {
  path: string;
  state: 'changed' | 'missing';
}

export interface ParsedQuizFile {
  id: string;
  title: string;
  project: string;
  subject: string | null;
  scope: SourceScope;
  level: number;
  generated: string | null;
  provider: string;
  model: string;
  questions: QuizQuestion[];
  /** SHA-256 of each cited range when the quiz was written, by `rangeKey`. */
  hashes: Map<string, string>;
  /** Question blocks that did not parse (hand edits). */
  skipped: number;
}

const FENCE = 'igrasp-quiz';

/** `"120-141"`, `"7"`, or null without lines. */
function linesOf(s: Pick<QuizSource, 'firstLine' | 'lastLine'>): string | null {
  if (s.firstLine === null) return null;
  const last = s.lastLine ?? s.firstLine;
  return last === s.firstLine ? String(s.firstLine) : `${String(s.firstLine)}-${String(last)}`;
}

export const rangeKey = (path: string, lines: string | null) => `${path}#${lines ?? ''}`;

/** The cited lines, `\n`-joined; null when the range is past the end of the file. */
function citedText(text: SourceText, first: number | null, last: number | null): string | null {
  const lines = text.content.split(/\r?\n/);
  if (first === null) return lines.join('\n');
  const end = last ?? first;
  if (first < 1 || end < first || end > lines.length) return null;
  return lines.slice(first - 1, end).join('\n');
}

/** The SHA-256 of every cited range that can be read now, by `rangeKey`. */
export async function hashSources(
  questions: QuizQuestion[],
  read: ReadSource,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  const texts = new Map<string, Promise<SourceText | null>>();
  for (const q of questions) {
    for (const s of q.sources) {
      if (s.kind === 'binary') continue;
      const key = rangeKey(s.path, linesOf(s));
      if (hashes.has(key)) continue;
      if (!texts.has(s.path))
        texts.set(
          s.path,
          read(s.path).catch(() => null),
        );
      const text = await texts.get(s.path);
      const cited = text ? citedText(text, s.firstLine, s.lastLine) : null;
      if (cited !== null) hashes.set(key, sha256Hex(cited));
    }
  }
  return hashes;
}

/** `quiz-<subject-slug>.md`. */
export const quizFileName = (record: QuizRecord) => `quiz-${slug(record.subjectTitle)}.md`;

function scopeName(scope: SourceScope): string {
  return scope.type;
}

/** The quiz file of `record` (`hashes` from `hashSources`). */
export function quizFileMarkdown(
  record: QuizRecord,
  project: string,
  hashes: Map<string, string>,
): string {
  const ranges = new Map<string, { path: string; lines?: string; sha256?: string }>();
  for (const q of record.questions) {
    for (const s of q.sources) {
      const lines = linesOf(s);
      const key = rangeKey(s.path, lines);
      if (ranges.has(key)) continue;
      const sha = hashes.get(key);
      ranges.set(key, {
        path: s.path,
        ...(lines === null ? {} : { lines }),
        ...(sha === undefined ? {} : { sha256: sha }),
      });
    }
  }
  const front = {
    igrasp: 'quiz',
    id: record.id,
    title: `${project} — ${record.subjectTitle}`,
    project,
    subject: record.subjectTitle,
    scope: scopeName(record.scope),
    level: record.startLevel,
    generated: new Date(record.startedMs).toISOString(),
    provider: record.providerId,
    model: record.model,
    sources: [...ranges.values()],
  };
  const sections = record.questions.map((q, i) => {
    const block = {
      id: q.id,
      kind: q.kind,
      difficulty: q.difficulty,
      choices: q.choices,
      answer: q.answer,
      hint: q.hint,
      explanation: q.explanation,
      sources: q.sources.map((s) => {
        const lines = linesOf(s);
        return {
          path: s.path,
          ...(lines === null ? {} : { lines }),
          ...(s.why ? { why: s.why } : {}),
          kind: s.kind,
        };
      }),
    };
    const question = q.question.replace(/\s*\n\s*/g, ' ').trim();
    const yamlText = stringify(block, { lineWidth: 96 });
    // Longer than any backtick run inside, so an explanation quoting a fence cannot close it.
    const longest = Math.max(0, ...Array.from(yamlText.matchAll(/`+/g), (m) => m[0].length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `## ${String(i + 1)}. ${question}\n\n${fence}${FENCE}\n${yamlText}${fence}`;
  });
  return `---\n${stringify(front, { lineWidth: 0 })}---\n\n# ${record.subjectTitle}\n\nA quiz about ${project} written by Hoot, with ${String(
    record.questions.length,
  )} questions. Open this file in IGrasp to play it; the answers are below each question.\n\n${sections.join('\n\n')}\n`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;

function sourceKind(path: string, kind: unknown): QuizSourceKind {
  if (kind === 'markdown' || kind === 'code' || kind === 'binary') return kind;
  return /\.(md|markdown)$/i.test(path) ? 'markdown' : 'code';
}

function parseLines(v: unknown): { firstLine: number | null; lastLine: number | null } {
  const text = str(v);
  const m = text ? /^\s*(\d+)\s*(?:-\s*L?(\d+))?\s*$/.exec(text.replace(/^L/, '')) : null;
  if (!m) return { firstLine: null, lastLine: null };
  const first = Number(m[1]);
  const last = m[2] === undefined ? first : Number(m[2]);
  return last >= first ? { firstLine: first, lastLine: last } : { firstLine: null, lastLine: null };
}

function parseSource(v: unknown): QuizSource | null {
  if (!isRecord(v)) return null;
  const path = str(v.path)?.trim().replace(/^\/+/, '');
  if (!path) return null;
  return {
    path,
    ...parseLines(v.lines),
    why: str(v.why),
    kind: sourceKind(path, v.kind),
  };
}

/** One question block; null when it cannot be played. */
function parseQuestion(heading: string, yamlText: string, n: number): QuizQuestion | null {
  let data: unknown;
  try {
    data = parse(yamlText);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const question = str(data.question) ?? heading;
  const choices = Array.isArray(data.choices) ? data.choices.map(str) : [];
  if (question.trim() === '' || choices.length < 2 || choices.some((c) => c === null)) return null;
  const answer = typeof data.answer === 'number' ? data.answer : Number(str(data.answer));
  if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) return null;
  const kind: QuestionKind =
    data.kind === 'trueFalse' || data.kind === 'multipleChoice'
      ? data.kind
      : choices.length === 2
        ? 'trueFalse'
        : 'multipleChoice';
  const difficulty = Number(data.difficulty);
  const sources = (Array.isArray(data.sources) ? data.sources : [])
    .map(parseSource)
    .filter((s): s is QuizSource => s !== null);
  return {
    id: str(data.id)?.trim() || `q${String(n)}`,
    kind,
    question: question.trim(),
    choices: choices as string[],
    answer,
    hint: str(data.hint)?.trim() ?? '',
    explanation: str(data.explanation)?.trim() ?? '',
    sources,
    difficulty: Number.isInteger(difficulty) ? Math.min(5, Math.max(1, difficulty)) : 3,
  };
}

/** The front matter text, or null (same rule as Rust `learning/quiz/file.rs`). */
function frontMatterText(text: string): { yaml: string; body: string } | null {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const m = /^---\r?\n([\s\S]*?)\r?\n?^---[ \t]*(?:\r?\n|$)/m.exec(source);
  if (m?.index !== 0) return null;
  return { yaml: m[1] ?? '', body: source.slice(m[0].length) };
}

/** Reads a quiz file; throws when it has no `igrasp: quiz` front matter or no playable question. */
export function parseQuizFile(text: string): ParsedQuizFile {
  const fm = frontMatterText(text);
  let data: unknown;
  try {
    data = fm ? parse(fm.yaml) : null;
  } catch {
    data = null;
  }
  if (!fm || !isRecord(data) || data.igrasp !== 'quiz')
    throw new Error('This file is not a quiz (no `igrasp: quiz` front matter).');

  const hashes = new Map<string, string>();
  for (const s of Array.isArray(data.sources) ? data.sources : []) {
    if (!isRecord(s)) continue;
    const path = str(s.path)?.trim().replace(/^\/+/, '');
    const sha = str(s.sha256)?.trim().toLowerCase();
    if (!path || !sha) continue;
    hashes.set(rangeKey(path, linesOf(parseLines(s.lines))), sha);
  }

  const questions: QuizQuestion[] = [];
  let skipped = 0;
  let heading = '';
  const lines = fm.body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const h = /^#{2,6}\s+(?:\d+[.)]\s*)?(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      heading = h[1] ?? '';
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})\s*igrasp-quiz\b/.exec(line);
    if (!open) continue;
    const fence = open[1] ?? '```';
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !(lines[j] ?? '').trim().startsWith(fence))
      body.push(lines[j++] ?? '');
    i = j;
    const q = parseQuestion(heading, body.join('\n'), questions.length + skipped + 1);
    if (q) {
      // Ids stay unique, whatever the hand edits did.
      let id = q.id;
      for (let k = 2; questions.some((x) => x.id === id); k++) id = `${q.id}-${String(k)}`;
      questions.push({ ...q, id });
    } else skipped++;
    heading = '';
  }
  if (questions.length === 0) throw new Error('This quiz file has no question that can be played.');

  const level = Number(data.level);
  const scope: SourceScope =
    data.scope === 'documentationOnly' ? { type: 'documentationOnly' } : { type: 'wholeProject' };
  return {
    id: str(data.id) ?? '',
    title: str(data.title) ?? str(data.subject) ?? 'Quiz',
    project: str(data.project) ?? '',
    subject: str(data.subject),
    scope,
    level: Number.isInteger(level) ? Math.min(5, Math.max(1, level)) : 2,
    generated: str(data.generated),
    provider: str(data.provider) ?? '',
    model: str(data.model) ?? '',
    questions,
    hashes,
    skipped,
  };
}

/**
 * Compares each cited source with the folder now: the notes of each question (by id), empty
 * when everything matches. A missing file is `missing`; lines past its end or a different hash
 * are `changed`. A range without a hash in the file is only checked for existence.
 */
export async function checkSources(
  file: Pick<ParsedQuizFile, 'questions' | 'hashes'>,
  read: ReadSource,
): Promise<Record<string, SourceNote[]>> {
  const texts = new Map<string, Promise<SourceText | null>>();
  const notes: Record<string, SourceNote[]> = {};
  for (const q of file.questions) {
    const list: SourceNote[] = [];
    for (const s of q.sources) {
      if (!texts.has(s.path))
        texts.set(
          s.path,
          read(s.path).catch(() => null),
        );
      const text = await texts.get(s.path);
      if (!text) {
        // A binary file is not read as text: it is missing only when the folder has nothing.
        if (s.kind !== 'binary') list.push({ path: s.path, state: 'missing' });
        continue;
      }
      if (s.kind === 'binary') continue;
      const cited = citedText(text, s.firstLine, s.lastLine);
      if (cited === null) {
        if (!text.truncated) list.push({ path: s.path, state: 'changed' });
        continue;
      }
      const expected = file.hashes.get(rangeKey(s.path, linesOf(s)));
      if (expected !== undefined && expected !== sha256Hex(cited))
        list.push({ path: s.path, state: 'changed' });
    }
    if (list.length > 0) notes[q.id] = list;
  }
  return notes;
}

/** A record to play from a quiz file (no AI: usage zero, origin `file`). */
export function recordFromFile(file: ParsedQuizFile, path: string): QuizRecord {
  return {
    id: file.id || 'quiz-file',
    startedMs: Date.now(),
    finishedMs: null,
    providerId: file.provider,
    model: file.model,
    subject: null,
    subjectTitle: file.subject ?? file.title,
    mode: 'fixed',
    scope: file.scope,
    origin: { type: 'file', path },
    count: file.questions.length,
    questions: file.questions,
    answers: [],
    startLevel: file.level,
    level: file.level,
    score: 0,
    bestStreak: 0,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
    durationMs: 0,
    attempts: 0,
    rounds: 1,
    resumeId: null,
    materialNote:
      file.skipped > 0
        ? `${String(file.skipped)} question${file.skipped > 1 ? 's' : ''} of this file could not be read and ${
            file.skipped > 1 ? 'were' : 'was'
          } skipped.`
        : null,
    suggestedSubjects: [],
  };
}
