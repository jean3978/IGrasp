// The tutorial validator of the mock backend, like Rust's `learning/tutorial/validate.rs`: the
// grounding rules enforced on an outline and on a chapter. Both must accept and reject the same
// items for the same reasons on the shared fixtures of `src/test/fixtures/tutorial/cases/`.

import type { Chapter, Citation, Length, Step } from '../types';
import {
  MAX_RANGE_LINES,
  isAgentFile,
  isSecret,
  namesTheProject,
  validateQuiz,
  words,
} from './mockQuizValidate';
import type { QuizCorpus } from './mockQuizValidate';

export const MAX_SNIPPET_LINES = 40;
export const KEY_SOURCE_LINES = 3000;
export const MAX_CHAPTERS = 8;
export const MAX_STEPS = 12;

export type TutorialRejection =
  | 'noSource'
  | 'unknownPath'
  | 'agentFile'
  | 'secretFile'
  | 'missingRange'
  | 'badRange'
  | 'rangeTooLong'
  | 'beyondEnd'
  | 'binaryRange'
  | 'binaryOnly'
  | 'selfCheck'
  | 'generic'
  | 'quickCheck'
  | 'items'
  | 'answerLine'
  | 'docsUrl'
  | 'mermaid'
  | 'duplicate'
  | 'recap'
  | 'interactive';

const PLAIN: Record<TutorialRejection, string> = {
  noSource: 'cited nothing',
  unknownPath: 'cited a file that does not exist',
  agentFile: 'cited an agent file',
  secretFile: 'cited a secret file',
  missingRange: 'cited lines that do not check out',
  badRange: 'cited lines that do not check out',
  rangeTooLong: 'cited lines that do not check out',
  beyondEnd: 'cited lines that do not check out',
  binaryRange: 'cited lines that do not check out',
  binaryOnly: 'cited only binary files',
  selfCheck: 'was generic',
  generic: 'was generic',
  quickCheck: 'had an unusable quiz question',
  items: 'had unusable items',
  answerLine: 'pointed outside its snippet',
  docsUrl: 'linked a bad documentation URL',
  mermaid: 'had an unusable diagram',
  duplicate: 'was a repeat',
  recap: 'lacked a recap',
  interactive: 'had no interactive step',
};

export const plainOf = (r: TutorialRejection) => PLAIN[r];

/** Chapters of an outline, at least and at most. */
export function chaptersOf(length: Length): [number, number] {
  return length === 'quick' ? [2, 3] : length === 'standard' ? [3, 5] : [5, 8];
}
/** Steps of a chapter, at least and at most (the recap included). */
export function stepsOf(length: Length): [number, number] {
  return length === 'quick' ? [4, 6] : length === 'standard' ? [5, 8] : [7, 10];
}
/** Verified steps enough to keep a chapter when the retries are exhausted. */
export const enoughSteps = (length: Length) => Math.ceil(stepsOf(length)[0] / 2);

export interface TutorialValidationContext {
  corpus: QuizCorpus;
  agentNames: string[];
  projectName: string;
  modules: string[];
  length: Length;
}

type Rejected = { id: string; rejection: TutorialRejection; message: string };
export type Verdict<T> =
  { ok: true; value: T } | { ok: false; rejection: TutorialRejection; message: string };
const reject = (rejection: TutorialRejection, message: string) =>
  ({ ok: false, rejection, message }) as const;

class ShapeError extends Error {}
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
function onlyKeys(v: Record<string, unknown>, allowed: string[], required: string[], at: string) {
  for (const k of Object.keys(v))
    if (!allowed.includes(k)) throw new ShapeError(`unknown field \`${k}\` in ${at}`);
  for (const k of required) if (!(k in v)) throw new ShapeError(`missing field \`${k}\` in ${at}`);
}
function str(v: unknown, at: string): string {
  if (typeof v !== 'string') throw new ShapeError(`${at}: expected a string`);
  return v;
}
function optStr(v: unknown, at: string): string | undefined {
  return v === undefined || v === null ? undefined : str(v, at);
}
function int(v: unknown, at: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 2 ** 32 - 1)
    throw new ShapeError(`${at}: expected an integer`);
  return v;
}
function optInt(v: unknown, at: string): number | undefined {
  return v === undefined || v === null ? undefined : int(v, at);
}
function list<T>(v: unknown, at: string, item: (x: unknown, at: string) => T): T[] {
  if (!Array.isArray(v)) throw new ShapeError(`${at}: expected a list`);
  return v.map((x, i) => item(x, `${at}[${String(i)}]`));
}
function selfCheck(v: unknown, at: string): { projectSpecific: boolean; reason: string } {
  if (!isObject(v)) throw new ShapeError(`${at}: expected an object`);
  onlyKeys(v, ['projectSpecific', 'reason'], ['projectSpecific', 'reason'], at);
  if (typeof v.projectSpecific !== 'boolean') throw new ShapeError(`${at}.projectSpecific`);
  return { projectSpecific: v.projectSpecific, reason: str(v.reason, `${at}.reason`) };
}
function citation(v: unknown, at: string): Citation {
  if (!isObject(v)) throw new ShapeError(`${at}: expected an object`);
  onlyKeys(v, ['path', 'firstLine', 'lastLine', 'why'], ['path'], at);
  const first = optInt(v.firstLine, `${at}.firstLine`);
  const last = optInt(v.lastLine, `${at}.lastLine`);
  const why = optStr(v.why, `${at}.why`);
  return {
    path: str(v.path, `${at}.path`),
    ...(first === undefined ? {} : { firstLine: first }),
    ...(last === undefined ? {} : { lastLine: last }),
    ...(why === undefined ? {} : { why }),
  };
}

/** The keys of each step type (like the structs with `deny_unknown_fields`). */
const STEP_FIELDS: Record<Step['type'], { allowed: string[]; required: string[] }> = {
  explain: { allowed: ['title', 'body', 'sources'], required: ['title', 'body', 'sources'] },
  conceptBridge: {
    allowed: ['title', 'concept', 'applied', 'docsUrl', 'sources'],
    required: ['title', 'concept', 'applied', 'sources'],
  },
  codeTour: { allowed: ['title', 'stops'], required: ['title', 'stops'] },
  diagram: {
    allowed: ['title', 'mermaid', 'caption', 'sources'],
    required: ['title', 'mermaid', 'sources'],
  },
  putInOrder: {
    allowed: ['title', 'prompt', 'items', 'explanation', 'sources'],
    required: ['title', 'prompt', 'items', 'explanation', 'sources'],
  },
  match: {
    allowed: ['title', 'prompt', 'pairs', 'explanation', 'sources'],
    required: ['title', 'prompt', 'pairs', 'explanation', 'sources'],
  },
  spotIt: {
    allowed: ['title', 'prompt', 'path', 'firstLine', 'lastLine', 'answerLine', 'explanation'],
    required: ['title', 'prompt', 'path', 'firstLine', 'lastLine', 'answerLine', 'explanation'],
  },
  quickCheck: {
    allowed: ['kind', 'question', 'choices', 'answer', 'hint', 'explanation', 'sources'],
    required: ['kind', 'question', 'choices', 'answer', 'hint', 'explanation', 'sources'],
  },
  tryIt: {
    allowed: ['title', 'instruction', 'command', 'where', 'expected', 'sources'],
    required: ['title', 'instruction', 'sources'],
  },
  recap: { allowed: ['takeaways', 'sources'], required: ['takeaways'] },
};

/** Parses one step like serde: the `type` tag, the known fields only. */
export function parseStep(v: unknown, at: string): Step {
  if (!isObject(v)) throw new ShapeError(`${at}: expected an object`);
  const type = v.type;
  if (typeof type !== 'string' || !(type in STEP_FIELDS))
    throw new ShapeError(`${at}: unknown variant \`${String(type)}\``);
  const t = type as Step['type'];
  const { allowed, required } = STEP_FIELDS[t];
  onlyKeys(v, ['type', 'selfCheck', ...allowed], required, at);
  const check =
    v.selfCheck === undefined || v.selfCheck === null
      ? undefined
      : selfCheck(v.selfCheck, `${at}.selfCheck`);
  const sc = check === undefined ? {} : { selfCheck: check };
  const sources = () => list(v.sources ?? [], `${at}.sources`, citation);
  const strs = (k: string) => list(v[k], `${at}.${k}`, str);
  switch (t) {
    case 'explain':
      return { type: t, title: str(v.title, at), body: str(v.body, at), sources: sources(), ...sc };
    case 'conceptBridge': {
      const docsUrl = optStr(v.docsUrl, at);
      return {
        type: t,
        title: str(v.title, at),
        concept: str(v.concept, at),
        applied: str(v.applied, at),
        ...(docsUrl === undefined ? {} : { docsUrl }),
        sources: sources(),
        ...sc,
      };
    }
    case 'codeTour':
      return {
        type: t,
        title: str(v.title, at),
        stops: list(v.stops, `${at}.stops`, (s, sat) => {
          if (!isObject(s)) throw new ShapeError(sat);
          const keys = ['path', 'firstLine', 'lastLine', 'annotation'];
          onlyKeys(s, keys, keys, sat);
          return {
            path: str(s.path, sat),
            firstLine: int(s.firstLine, sat),
            lastLine: int(s.lastLine, sat),
            annotation: str(s.annotation, sat),
          };
        }),
        ...sc,
      };
    case 'diagram': {
      const caption = optStr(v.caption, at);
      return {
        type: t,
        title: str(v.title, at),
        mermaid: str(v.mermaid, at),
        ...(caption === undefined ? {} : { caption }),
        sources: sources(),
        ...sc,
      };
    }
    case 'putInOrder':
      return {
        type: t,
        title: str(v.title, at),
        prompt: str(v.prompt, at),
        items: strs('items'),
        explanation: str(v.explanation, at),
        sources: sources(),
        ...sc,
      };
    case 'match':
      return {
        type: t,
        title: str(v.title, at),
        prompt: str(v.prompt, at),
        pairs: list(v.pairs, `${at}.pairs`, (p, pat) => {
          if (!isObject(p)) throw new ShapeError(pat);
          onlyKeys(p, ['left', 'right'], ['left', 'right'], pat);
          return { left: str(p.left, pat), right: str(p.right, pat) };
        }),
        explanation: str(v.explanation, at),
        sources: sources(),
        ...sc,
      };
    case 'spotIt':
      return {
        type: t,
        title: str(v.title, at),
        prompt: str(v.prompt, at),
        path: str(v.path, at),
        firstLine: int(v.firstLine, at),
        lastLine: int(v.lastLine, at),
        answerLine: int(v.answerLine, at),
        explanation: str(v.explanation, at),
        ...sc,
      };
    case 'quickCheck': {
      if (v.kind !== 'multipleChoice' && v.kind !== 'trueFalse') throw new ShapeError(`${at}.kind`);
      return {
        type: t,
        kind: v.kind,
        question: str(v.question, at),
        choices: strs('choices'),
        answer: int(v.answer, at),
        hint: str(v.hint, at),
        explanation: str(v.explanation, at),
        sources: sources(),
        ...sc,
      };
    }
    case 'tryIt': {
      const command = optStr(v.command, at);
      const where = optStr(v.where, at);
      const expected = optStr(v.expected, at);
      return {
        type: t,
        title: str(v.title, at),
        instruction: str(v.instruction, at),
        ...(command === undefined ? {} : { command }),
        ...(where === undefined ? {} : { where }),
        ...(expected === undefined ? {} : { expected }),
        sources: sources(),
        ...sc,
      };
    }
    case 'recap':
      return { type: t, takeaways: strs('takeaways'), sources: sources(), ...sc };
  }
}

function stepCitationsOf(step: Step): Citation[] {
  switch (step.type) {
    case 'codeTour':
      return step.stops.map((s) => ({
        path: s.path,
        firstLine: s.firstLine,
        lastLine: s.lastLine,
      }));
    case 'spotIt':
      return [{ path: step.path, firstLine: step.firstLine, lastLine: step.lastLine }];
    default:
      return step.sources;
  }
}

const stepTitleOf = (step: Step) =>
  step.type === 'quickCheck' ? step.question : step.type === 'recap' ? 'Recap' : step.title;

/** Like Rust's `check_citation`. */
function checkCitation(
  c: Citation,
  maxLines: number,
  ctx: TutorialValidationContext,
): Verdict<{ citation: Citation; cited: Set<string>; binary: boolean }> {
  const path = c.path
    .trim()
    .replace(/^(?:\.\/)+/, '')
    .replace(/\\/g, '/');
  const file = ctx.corpus.files.get(path);
  if (!file) {
    if (isAgentFile(path, ctx.agentNames))
      return reject(
        'agentFile',
        `cites ${path}, an agent instruction file (context only, never a source)`,
      );
    if (isSecret(path)) return reject('secretFile', `cites ${path}, a file that may hold secrets`);
    return reject(
      'unknownPath',
      `cites ${path}, which is not a file of this project (use the paths of the corpus map)`,
    );
  }
  const nz = (n: number | undefined) => (n !== undefined && n > 0 ? n : undefined);
  let first = nz(c.firstLine);
  let last = nz(c.lastLine);
  if (first === undefined) first = last;
  if (last === undefined) last = first;
  const why = c.why === undefined ? {} : { why: c.why };
  if (file.binary) {
    if (first !== undefined)
      return reject('binaryRange', `cites lines of ${path}, a binary file that cannot be read`);
    return { ok: true, value: { citation: { path, ...why }, cited: new Set(), binary: true } };
  }
  if (first === undefined || last === undefined)
    return reject('missingRange', `cites ${path} without the line range that holds the fact`);
  if (first > last)
    return reject(
      'badRange',
      `cites lines ${String(first)}-${String(last)} of ${path}, which is not a range`,
    );
  if (last - first + 1 > maxLines)
    return reject(
      'rangeTooLong',
      `cites ${String(last - first + 1)} lines of ${path}; cite at most ${String(maxLines)}, the ones that hold the fact`,
    );
  if (last > file.lines.length)
    return reject(
      'beyondEnd',
      `${path} has ${String(file.lines.length)} lines; lines ${String(first)}-${String(last)} do not exist`,
    );
  const cited = new Set<string>();
  for (const line of file.lines.slice(first - 1, last)) for (const w of words(line)) cited.add(w);
  return {
    ok: true,
    value: { citation: { path, firstLine: first, lastLine: last, ...why }, cited, binary: false },
  };
}

// ---------------------------------------------------------------------------------------------
// The outline.

export interface ValidatedOutline {
  title: string;
  intro: string;
  insufficientMaterial: boolean;
  materialNote: string | null;
  docsNote: string | null;
  suggestedSubjects: string[];
  accepted: Chapter[];
  rejected: Rejected[];
  dropped: number;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/** Like `validate_outline`: `{ ok: false }` is a shape error rejecting the whole answer. */
export function validateOutline(
  output: unknown,
  ctx: TutorialValidationContext,
): Validation<ValidatedOutline> {
  if (output === null || output === undefined)
    return { ok: false, error: 'no JSON answer was given' };
  let parsed;
  try {
    if (!isObject(output)) throw new ShapeError('expected an object');
    const allowed = [
      'insufficientMaterial',
      'materialNote',
      'docsNote',
      'suggestedSubjects',
      'title',
      'intro',
      'chapters',
    ];
    onlyKeys(
      output,
      allowed,
      ['insufficientMaterial', 'title', 'intro', 'chapters'],
      'the outline',
    );
    if (typeof output.insufficientMaterial !== 'boolean')
      throw new ShapeError('insufficientMaterial');
    parsed = {
      insufficientMaterial: output.insufficientMaterial,
      materialNote: optStr(output.materialNote, 'materialNote'),
      docsNote: optStr(output.docsNote, 'docsNote'),
      suggestedSubjects: list(output.suggestedSubjects ?? [], 'suggestedSubjects', str),
      title: str(output.title, 'title'),
      intro: str(output.intro, 'intro'),
      chapters: list(output.chapters, 'chapters', (c, at) => {
        if (!isObject(c)) throw new ShapeError(at);
        const keys = ['id', 'title', 'goal', 'minutes', 'keySources', 'selfCheck'];
        onlyKeys(c, keys, keys, at);
        return {
          id: str(c.id, at),
          title: str(c.title, at),
          goal: str(c.goal, at),
          minutes: int(c.minutes, at),
          keySources: list(c.keySources, `${at}.keySources`, str),
          selfCheck: selfCheck(c.selfCheck, `${at}.selfCheck`),
        };
      }),
    };
  } catch (err) {
    if (err instanceof ShapeError) return { ok: false, error: err.message };
    throw err;
  }
  const max = Math.min(chaptersOf(ctx.length)[1], MAX_CHAPTERS);
  const v: ValidatedOutline = {
    title: parsed.title.trim(),
    intro: parsed.intro.trim(),
    insufficientMaterial: parsed.insufficientMaterial,
    materialNote: parsed.materialNote?.trim() ? parsed.materialNote : null,
    docsNote: parsed.docsNote?.trim() ? parsed.docsNote : null,
    suggestedSubjects: parsed.suggestedSubjects,
    accepted: [],
    rejected: [],
    dropped: 0,
  };
  const titles = new Set<string>();
  for (const raw of parsed.chapters) {
    const verdict = ((): Verdict<Chapter> => {
      if (raw.keySources.length === 0) return reject('noSource', 'names no key source');
      let citable = 0;
      const cited = new Set<string>();
      for (const s of raw.keySources) {
        const path = s
          .trim()
          .replace(/^(?:\.\/)+/, '')
          .replace(/\\/g, '/');
        const file = ctx.corpus.files.get(path);
        if (file) {
          citable += 1;
          if (!file.binary)
            for (const line of file.lines.slice(0, KEY_SOURCE_LINES))
              for (const w of words(line)) cited.add(w);
        } else if (isAgentFile(path, ctx.agentNames)) {
          return reject(
            'agentFile',
            `is built on ${path}, an agent instruction file (context only, never a source)`,
          );
        } else if (isSecret(path)) {
          return reject('secretFile', `is built on ${path}, a file that may hold secrets`);
        }
      }
      if (citable === 0)
        return reject(
          'unknownPath',
          `names no key source that is a file of this project (${raw.keySources.join(', ')})`,
        );
      if (!raw.selfCheck.projectSpecific)
        return reject('selfCheck', 'your own self-check says it is not specific to this project');
      if (!namesTheProject(`${raw.title} ${raw.goal}`, cited, ctx))
        return reject(
          'generic',
          'generic: the title and the goal name nothing of this project (a file, a module, an identifier)',
        );
      const key = raw.title.trim().toLowerCase();
      if (titles.has(key)) return reject('duplicate', "repeats another chapter's title");
      titles.add(key);
      return {
        ok: true,
        value: {
          id: '',
          title: raw.title.trim(),
          goal: raw.goal.trim(),
          minutes: Math.min(15, Math.max(2, raw.minutes)),
          steps: [],
        },
      };
    })();
    if (verdict.ok) {
      if (v.accepted.length < max) v.accepted.push(verdict.value);
      else v.dropped += 1;
    } else v.rejected.push({ id: raw.id, rejection: verdict.rejection, message: verdict.message });
  }
  v.accepted.forEach((c, i) => {
    c.id = `c${String(i + 1)}`;
  });
  return { ok: true, value: v };
}

// ---------------------------------------------------------------------------------------------
// A chapter.

export interface ValidatedChapter {
  title: string;
  hootIntro: string;
  docsNote: string | null;
  accepted: Step[];
  rejected: Rejected[];
  dropped: number;
}

/** "2 rejected: 1 cited lines that do not check out, 1 was generic". */
export function chapterSummary(rejected: Rejected[]): string {
  const counts = new Map<string, number>();
  for (const r of rejected)
    counts.set(PLAIN[r.rejection], (counts.get(PLAIN[r.rejection]) ?? 0) + 1);
  const parts = [...counts].map(([p, n]) => `${String(n)} ${p}`);
  return `${String(rejected.length)} rejected: ${parts.join(', ')}`;
}

function specificText(step: Step): string {
  switch (step.type) {
    case 'explain':
      return `${step.title} ${step.body}`;
    case 'conceptBridge':
      return `${step.title} ${step.applied}`;
    case 'codeTour':
      return `${step.title} ${step.stops.map((s) => s.annotation).join(' ')}`;
    case 'diagram':
      return `${step.title} ${step.mermaid} ${step.caption ?? ''}`;
    case 'putInOrder':
      return `${step.prompt} ${step.items.join(' ')} ${step.explanation}`;
    case 'match':
      return `${step.prompt} ${step.pairs.map((p) => `${p.left} ${p.right}`).join(' ')} ${step.explanation}`;
    case 'spotIt':
      return `${step.title} ${step.prompt} ${step.explanation}`;
    case 'quickCheck':
      return `${step.question} ${step.explanation} ${step.choices.join(' ')}`;
    case 'tryIt':
      return `${step.title} ${step.instruction} ${step.command ?? ''}`;
    case 'recap':
      return step.takeaways.join(' ');
  }
}

function distinct(items: string[]): boolean {
  const seen = new Set<string>();
  return items.every((i) => {
    const n = Array.from(i.toLowerCase())
      .filter((c) => /[\p{L}\p{N}]/u.test(c))
      .join('');
    if (n === '' || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

function mermaidSource(text: string): string | null {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^`+/, '');
    if (t.startsWith('mermaid')) t = t.slice('mermaid'.length);
    t = t.trim().replace(/`+$/, '').trimEnd();
  }
  const first = (t.split('\n')[0] ?? '').trim();
  const ok = [
    'flowchart',
    'graph',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'erDiagram',
  ].some((k) => first.startsWith(k));
  return ok && first !== '' ? t : null;
}

function checkQuick(
  step: Extract<Step, { type: 'quickCheck' }>,
  ctx: TutorialValidationContext,
): Verdict<null> {
  const quiz = {
    insufficientMaterial: false,
    questions: [
      {
        id: 'q1',
        kind: step.kind,
        question: step.question,
        choices: step.choices,
        answer: step.answer,
        hint: step.hint,
        explanation: step.explanation,
        sources: step.sources.map((c) => ({
          path: c.path,
          firstLine: c.firstLine !== undefined && c.firstLine > 0 ? c.firstLine : null,
          lastLine: c.lastLine !== undefined && c.lastLine > 0 ? c.lastLine : null,
          why: c.why ?? null,
        })),
        difficulty: 2,
        selfCheck: step.selfCheck ?? { projectSpecific: false, reason: '' },
      },
    ],
  };
  const v = validateQuiz(quiz, { ...ctx, exclude: [], count: 1 });
  if (!v.ok) return reject('quickCheck', `quick check: ${v.error}`);
  const first = v.value.rejected[0];
  if (first) return reject('quickCheck', `quick check: ${first.message}`);
  if (v.value.accepted.length === 0) return reject('quickCheck', 'quick check: not accepted');
  return { ok: true, value: null };
}

export function checkStep(step: Step, ctx: TutorialValidationContext): Verdict<Step> {
  const out: Step = structuredClone(step);
  const specific = step.selfCheck?.projectSpecific === true;
  const cited = new Set<string>();
  const maxLines =
    step.type === 'codeTour' || step.type === 'spotIt' ? MAX_SNIPPET_LINES : MAX_RANGE_LINES;
  const citations = stepCitationsOf(step);
  if (citations.length === 0 && step.type !== 'recap') return reject('noSource', 'cites no source');
  let textSources = 0;
  const checked: Citation[] = [];
  for (const c of citations) {
    const v = checkCitation(c, maxLines, ctx);
    if (!v.ok) return v;
    if (!v.value.binary) textSources += 1;
    for (const w of v.value.cited) cited.add(w);
    checked.push(v.value.citation);
  }
  if (citations.length > 0 && textSources === 0)
    return reject(
      'binaryOnly',
      'cites only binary files, whose content cannot be read; cite the text that uses them',
    );
  switch (out.type) {
    case 'explain':
    case 'tryIt':
      out.sources = checked;
      break;
    case 'conceptBridge':
      if (out.docsUrl !== undefined && !/^https?:\/\//.test(out.docsUrl))
        return reject(
          'docsUrl',
          `docsUrl "${out.docsUrl}" is not an http(s) link to the official documentation`,
        );
      out.sources = checked;
      break;
    case 'codeTour':
      if (out.stops.length < 2 || out.stops.length > 6)
        return reject('items', `has ${String(out.stops.length)} stops; a code tour has 2 to 6`);
      out.stops.forEach((s, i) => {
        s.path = checked[i]?.path ?? s.path;
      });
      break;
    case 'diagram': {
      const src = mermaidSource(out.mermaid);
      if (src === null)
        return reject(
          'mermaid',
          'its mermaid is not a diagram (start with flowchart, sequenceDiagram, classDiagram or stateDiagram-v2, no fence)',
        );
      out.mermaid = src;
      out.sources = checked;
      break;
    }
    case 'putInOrder':
      if (out.items.length < 3 || out.items.length > 7 || !distinct(out.items))
        return reject(
          'items',
          `has ${String(out.items.length)} items; put-in-order needs 3 to 7 distinct steps`,
        );
      out.sources = checked;
      break;
    case 'match':
      if (
        out.pairs.length < 3 ||
        out.pairs.length > 6 ||
        !distinct(out.pairs.map((p) => p.left)) ||
        !distinct(out.pairs.map((p) => p.right))
      )
        return reject(
          'items',
          `has ${String(out.pairs.length)} pairs; match needs 3 to 6 pairs with distinct sides`,
        );
      out.sources = checked;
      break;
    case 'spotIt':
      out.path = checked[0]?.path ?? out.path;
      if (out.answerLine < out.firstLine || out.answerLine > out.lastLine)
        return reject(
          'answerLine',
          `its answerLine ${String(out.answerLine)} is outside the snippet ${String(out.firstLine)}-${String(out.lastLine)} of ${out.path}`,
        );
      break;
    case 'quickCheck': {
      const q = checkQuick(out, ctx);
      if (!q.ok) return q;
      out.sources = checked;
      break;
    }
    case 'recap':
      if (out.takeaways.length !== 3 || !distinct(out.takeaways))
        return reject(
          'items',
          `has ${String(out.takeaways.length)} takeaways; a recap has exactly 3 distinct ones`,
        );
      out.sources = checked;
      break;
  }
  if (!specific)
    return reject(
      'selfCheck',
      'your own self-check says it is not specific to this project (or is missing)',
    );
  if (!namesTheProject(specificText(step), cited, ctx))
    return reject(
      'generic',
      'generic: its text names nothing of this project (a file, an identifier of the cited lines, a module)',
    );
  delete out.selfCheck;
  return { ok: true, value: out };
}

const INTERACTIVE = new Set<Step['type']>(['putInOrder', 'match', 'spotIt', 'quickCheck']);

/** Like `validate_chapter`. */
export function validateChapter(
  output: unknown,
  ctx: TutorialValidationContext,
): Validation<ValidatedChapter> {
  if (output === null || output === undefined)
    return { ok: false, error: 'no JSON answer was given' };
  let parsed;
  try {
    if (!isObject(output)) throw new ShapeError('expected an object');
    onlyKeys(
      output,
      ['id', 'title', 'hootIntro', 'steps', 'docsNote'],
      ['id', 'title', 'hootIntro', 'steps'],
      'the chapter',
    );
    parsed = {
      id: str(output.id, 'id'),
      title: str(output.title, 'title'),
      hootIntro: str(output.hootIntro, 'hootIntro'),
      docsNote: optStr(output.docsNote, 'docsNote'),
      steps: list(output.steps, 'steps', parseStep),
    };
  } catch (err) {
    if (err instanceof ShapeError) return { ok: false, error: err.message };
    throw err;
  }
  const max = Math.min(stepsOf(ctx.length)[1], MAX_STEPS);
  const v: ValidatedChapter = {
    title: parsed.title.trim(),
    hootIntro: parsed.hootIntro.trim(),
    docsNote: parsed.docsNote?.trim() ? parsed.docsNote : null,
    accepted: [],
    rejected: [],
    dropped: 0,
  };
  const titles = new Set<string>();
  let recap: Step | null = null;
  for (const [i, step] of parsed.steps.entries()) {
    const label = `step ${String(i + 1)} (${step.type}: ${stepTitleOf(step)})`;
    const verdict = ((): Verdict<Step> => {
      const key = stepTitleOf(step).trim().toLowerCase();
      if (step.type !== 'recap') {
        if (titles.has(key)) return reject('duplicate', "repeats another step's title");
        titles.add(key);
      }
      return checkStep(step, ctx);
    })();
    if (verdict.ok) {
      if (verdict.value.type === 'recap') {
        if (recap === null) recap = verdict.value;
        else v.dropped += 1;
      } else if (v.accepted.length + 1 < max) v.accepted.push(verdict.value);
      else v.dropped += 1;
    } else v.rejected.push({ id: label, rejection: verdict.rejection, message: verdict.message });
  }
  if (recap) v.accepted.push(recap);
  else
    v.rejected.push({
      id: 'recap',
      rejection: 'recap',
      message: 'the chapter has no recap step (exactly three takeaways, last)',
    });
  if (v.accepted.length > 4 && !v.accepted.some((s) => INTERACTIVE.has(s.type)))
    v.rejected.push({
      id: 'interactive',
      rejection: 'interactive',
      message:
        'the chapter has more than four steps and none is interactive: replace one explain card with a putInOrder, match, spotIt or quickCheck step',
    });
  return { ok: true, value: v };
}
