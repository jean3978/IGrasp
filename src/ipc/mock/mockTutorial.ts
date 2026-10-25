// Tutorial generations of the mock AI, like Rust's `learning/tutorial/compose.rs` and
// `operation.rs`: the outline request (one validated run), the chapters (a staged run, one
// validated run per chapter), the validators that accept, repair or give up, and what the mock
// model answers for each script (`__igraspMock.state.ai.tutorialScript`). The frontend never sends
// a tutorial prompt; this composes it from what the user chose.

import { BackendError } from '../types';
import type {
  AiInlinedDocument,
  Chapter,
  ChapterResult,
  JsonValue,
  Length,
  OutlineResult,
  ProjectProfile,
  Step,
  Tutorial,
  TutorialInput,
  TutorialSubject,
  TutorialUsage,
} from '../types';
import { MOCK_MAX_RETRIES } from './mockQuiz';
import { corpusOfFiles, isAgentFile, isSecret, namesTheProject, words } from './mockQuizValidate';
import { slug } from '../../lib/tutorial';
import type { QuizCorpus } from './mockQuizValidate';
import { GENERIC_STEP, POOL, THIN_SUGGESTIONS } from './mockTutorialPool';
import type { PoolChapter } from './mockTutorialPool';
import {
  MAX_CHAPTERS,
  chapterSummary,
  chaptersOf,
  enoughSteps,
  plainOf,
  stepsOf,
  validateChapter,
  validateOutline,
} from './mockTutorialValidate';
import type { TutorialValidationContext } from './mockTutorialValidate';

export type MockTutorialScript =
  'valid' | 'retry' | 'exhaust' | 'thin' | 'textOnly' | 'slow' | 'stageFail';

/** Stages of a staged run at most (like `MAX_STAGES`). */
export const MOCK_MAX_STAGES = 8;
/** Bytes of the fixed blocks of the real tutorial prompts (audience, rules, voice, step types). */
export const MOCK_TUTORIAL_RULES_BYTES = 14000;
export const MOCK_TUTORIAL_SCHEMA: JsonValue = { type: 'object', title: 'tutorial' };

export type MockVerdict =
  | { type: 'accept'; value: unknown }
  | { type: 'retry'; repairPrompt: string; reason: string }
  | { type: 'fail'; message: string };

export interface MockTutorialDeps {
  files: Map<string, string>;
  profile: ProjectProfile;
  agentNames: string[];
}

export interface Base {
  corpus: QuizCorpus;
  ctx: TutorialValidationContext;
  input: TutorialInput;
}

export function base(deps: MockTutorialDeps, input: TutorialInput): Base {
  const corpus = corpusOfFiles(deps.files, { type: 'wholeProject' }, deps.agentNames);
  return {
    corpus,
    input,
    ctx: {
      corpus,
      agentNames: deps.agentNames,
      projectName: deps.profile.name,
      modules: deps.profile.modules.map((m) => m.path),
      length: input.length,
    },
  };
}

export function inlinedOf(deps: MockTutorialDeps, anchors: string[]): AiInlinedDocument[] {
  const docs: AiInlinedDocument[] = [];
  for (const a of anchors) {
    const content = deps.files.get(a);
    if (content !== undefined && !docs.some((d) => d.path === a))
      docs.push({ path: a, bytes: new TextEncoder().encode(content).length, contextOnly: false });
  }
  for (const name of deps.agentNames) {
    const content = deps.files.get(name);
    if (content !== undefined)
      docs.push({ path: name, bytes: new TextEncoder().encode(content).length, contextOnly: true });
  }
  return docs;
}

/** Trims the input like Rust's `TutorialInput::normalized`. */
export function normalizedInput(input: TutorialInput): TutorialInput {
  const cut = (s: string, n: number) => Array.from(s.trim()).slice(0, n).join('');
  const opt = (s: string | null, n: number) => {
    if (s === null) return null;
    const t = cut(s, n);
    return t === '' ? null : t;
  };
  return {
    ...input,
    subject: cut(input.subject, 300) || 'The big picture',
    subjectId: opt(input.subjectId, 200),
    picks: input.picks
      .map((p) => cut(p, 200))
      .filter((p) => p !== '')
      .slice(0, 4),
    domainGap: opt(input.domainGap, 200),
    role: opt(input.role, 80),
  };
}

// ---------------------------------------------------------------------------------------------
// The outline.

export interface MockOutlineComposed extends Base {
  prompt: string;
  inlined: AiInlinedDocument[];
}

export function composeMockOutline(
  deps: MockTutorialDeps,
  raw: TutorialInput,
  card: TutorialSubject | null,
): MockOutlineComposed {
  const input = normalizedInput(raw);
  const b = base(deps, input);
  if ([...b.corpus.files.values()].every((f) => f.binary))
    throw new BackendError('Ai', 'This folder holds no text files a tutorial could be built on.');
  const anchors = [
    ...(card?.picks.filter((p) => input.picks.includes(p.title)).flatMap((p) => p.anchors) ?? []),
    ...(card?.anchors ?? []),
    'README.md',
    'docs/architecture.md',
    'package.json',
  ];
  const focus = card ? `\nThe kind of tutorial asked for: ${card.focus}` : '';
  const prompt = `You are Hoot, the teacher of IGrasp's Academy. Plan a tutorial about "${input.subject}" in ${deps.profile.name}.${focus}`;
  return { ...b, prompt, inlined: inlinedOf(deps, anchors) };
}

/** Like Rust's `OutlineValidator`. */
export class MockOutlineValidator {
  private best: { accepted: Chapter[]; v: ReturnType<typeof validateOutline> } | null = null;
  private rejectedTotal = 0;
  private lastReason = '';

  constructor(private readonly c: MockOutlineComposed) {}

  private result(
    v: Extract<ReturnType<typeof validateOutline>, { ok: true }>['value'],
    note: string | null,
  ): OutlineResult {
    return {
      title: v.title,
      intro: v.intro,
      insufficientMaterial: v.insufficientMaterial,
      materialNote: note ?? v.materialNote,
      docsNote: v.docsNote,
      suggestedSubjects: v.suggestedSubjects,
      chapters: v.accepted,
      rejectedCount: this.rejectedTotal,
    };
  }

  check(output: unknown): MockVerdict {
    const v = validateOutline(output, this.c.ctx);
    if (!v.ok) {
      this.lastReason = 'the answer was not valid outline JSON';
      return {
        type: 'retry',
        repairPrompt: `Your answer could not be read as the outline JSON (${v.error}).`,
        reason: this.lastReason,
      };
    }
    this.rejectedTotal += v.value.rejected.length;
    const [min] = chaptersOf(this.c.input.length);
    const accepted = v.value.accepted.length;
    const enough = accepted >= min || (v.value.insufficientMaterial && accepted >= 1);
    if (v.value.rejected.length === 0 && enough)
      return { type: 'accept', value: this.result(v.value, null) };
    const reason =
      v.value.rejected.length === 0
        ? `only ${String(accepted)} chapters; ${String(min)} needed`
        : `${String(v.value.rejected.length)} chapters rejected: ${v.value.rejected.map((r) => plainOf(r.rejection)).join(', ')}`;
    if (!this.best || accepted > this.best.accepted.length)
      this.best = { accepted: v.value.accepted, v };
    this.lastReason = reason;
    return {
      type: 'retry',
      repairPrompt: v.value.rejected.map((r) => `- ${r.id}: ${r.message}`).join('\n'),
      reason,
    };
  }

  onExhausted(): MockVerdict {
    const attempts = 1 + MOCK_MAX_RETRIES;
    const best = this.best;
    if (best && best.accepted.length > 0 && best.v.ok)
      return {
        type: 'accept',
        value: this.result(
          best.v.value,
          `Hoot could verify ${String(best.accepted.length)} chapters after ${String(attempts)} attempts.`,
        ),
      };
    return {
      type: 'fail',
      message: `Hoot could not plan a grounded tutorial after ${String(attempts)} attempts (${this.lastReason}). Try another subject.`,
    };
  }
}

const rawChapter = (p: PoolChapter, i: number) => ({
  id: `c${String(i + 1)}`,
  title: p.title,
  goal: p.goal,
  minutes: p.minutes,
  keySources: p.keySources,
  selfCheck: { projectSpecific: true, reason: 'built on files of igrasp-demo' },
});

/** What the mock model answers to an outline request, attempt `n` (1-based). */
export function scriptedOutline(
  script: MockTutorialScript,
  c: MockOutlineComposed,
  n: number,
): unknown {
  const [, max] = chaptersOf(c.input.length);
  const chapters = POOL.slice(0, Math.min(max, POOL.length, MAX_CHAPTERS)).map(rawChapter);
  const outline = {
    insufficientMaterial: false,
    docsNote: 'Nothing in igrasp-demo documents how greet() is built; src/greet.ts is missing.',
    title: `${c.input.subject}: a tour of igrasp-demo`,
    intro:
      'You will follow igrasp-demo from src/main.ts to its Makefile, its architecture page and its decisions.',
    chapters,
  };
  switch (script) {
    case 'exhaust':
      return null;
    case 'thin':
      return {
        insufficientMaterial: true,
        materialNote: `igrasp-demo has too little material for "${c.input.subject}".`,
        suggestedSubjects: THIN_SUGGESTIONS,
        title: 'What igrasp-demo can teach',
        intro: 'igrasp-demo is small: Hoot found one chapter it can ground in src/main.ts.',
        chapters: chapters.slice(0, 1),
      };
    case 'retry':
      if (n === 1)
        return {
          ...outline,
          chapters: [
            ...chapters.slice(0, -1),
            {
              ...rawChapter(POOL[0] as PoolChapter, chapters.length - 1),
              title: 'What functions are',
              goal: 'Explain functions in general for any program.',
            },
          ],
        };
      return outline;
    default:
      return outline;
  }
}

// ---------------------------------------------------------------------------------------------
// The chapters.

export interface MockChapterStage extends Base {
  chapter: Chapter;
  /** The chapter's index in the outline. */
  index: number;
  prompt: string;
  inlined: AiInlinedDocument[];
}

function recapsOf(chapters: Chapter[], except: number): [string, string[]][] {
  return chapters.flatMap((c, i) => {
    if (i === except) return [];
    const r = [...c.steps].reverse().find((s) => s.type === 'recap');
    return r?.type === 'recap' ? [[c.title, r.takeaways] as [string, string[]]] : [];
  });
}

/** Like Rust's `ChapterStages`: the stages writing `indices` of `t` (or a new chapter for `goal`). */
export function composeMockChapters(
  deps: MockTutorialDeps,
  t: Tutorial,
  indices: number[],
  goal: string | null,
): {
  stages: (accepted: ChapterResult[]) => MockChapterStage[];
  chapters: Chapter[];
  indices: number[];
} {
  const chapters = structuredClone(t.chapters);
  let wanted = indices;
  const g = goal?.trim() ?? '';
  if (g !== '') {
    if (chapters.length >= MAX_CHAPTERS)
      throw new BackendError('Ai', `A tutorial has at most ${String(MAX_CHAPTERS)} chapters.`);
    chapters.push({
      id: `c${String(chapters.length + 1)}`,
      title: g.slice(0, 80),
      goal: g.slice(0, 300),
      minutes: Math.floor((t.length === 'quick' ? 5 : t.length === 'standard' ? 15 : 30) / 3),
      questions: [],
      steps: [],
    });
    wanted = [chapters.length - 1];
  }
  const seen = new Set<number>();
  if (
    wanted.length === 0 ||
    wanted.length > MOCK_MAX_STAGES ||
    wanted.some((i) => i >= chapters.length || i < 0 || seen.size === seen.add(i).size)
  )
    throw new BackendError(
      'Ai',
      `Choose between 1 and ${String(MOCK_MAX_STAGES)} chapters of the outline to write.`,
    );
  const input: TutorialInput = {
    subject: t.subject,
    subjectId: null,
    picks: [],
    familiarity: t.familiarity,
    domainGap: t.domainGap ?? null,
    length: t.length,
    role: t.role ?? null,
  };
  const stage = (stageIndex: number, accepted: ChapterResult[]): MockChapterStage => {
    const index = wanted[stageIndex] ?? 0;
    const chapter = chapters[index] as Chapter;
    const recaps = recapsOf(chapters, index);
    for (const r of accepted) {
      const recap = [...r.chapter.steps].reverse().find((s) => s.type === 'recap');
      if (recap?.type === 'recap' && !recaps.some(([title]) => title === r.chapter.title))
        recaps.push([r.chapter.title, recap.takeaways]);
    }
    const written =
      recaps.length === 0
        ? ''
        : `\nChapters already written (their recaps; do not repeat what they teach, build on it):\n${recaps.map(([title, k]) => `- ${title}: ${k.join(' / ')}`).join('\n')}`;
    const prompt = `You are Hoot, the teacher of IGrasp's Academy. The tutorial "${t.subject}" in ${deps.profile.name} has this outline (already accepted).${written}\nWrite chapter ${String(index + 1)} of ${String(chapters.length)}: "${chapter.title}" (id ${chapter.id}).`;
    const pool = POOL[index % POOL.length] as PoolChapter;
    return {
      ...base(deps, input),
      chapter,
      index,
      prompt,
      inlined: inlinedOf(deps, [...pool.keySources, 'README.md']),
    };
  };
  return {
    chapters,
    indices: wanted,
    stages: (accepted) => wanted.map((_, i) => stage(i, accepted)),
  };
}

/** Like Rust's `ChapterValidator`. */
export class MockChapterValidator {
  private best: Extract<ReturnType<typeof validateChapter>, { ok: true }>['value'] | null = null;
  private rejectedTotal = 0;
  private lastReason = '';

  constructor(private readonly s: MockChapterStage) {}

  private result(
    v: Extract<ReturnType<typeof validateChapter>, { ok: true }>['value'],
  ): ChapterResult {
    const intro = v.hootIntro;
    return {
      chapter: {
        id: this.s.chapter.id,
        title: v.title === '' ? this.s.chapter.title : v.title,
        goal: this.s.chapter.goal,
        minutes: this.s.chapter.minutes,
        questions: [],
        ...(intro === '' ? {} : { hootIntro: intro }),
        steps: v.accepted,
      },
      docsNote: v.docsNote,
      rejectedCount: this.rejectedTotal,
    };
  }

  check(output: unknown): MockVerdict {
    const v = validateChapter(output, this.s.ctx);
    if (!v.ok) {
      this.lastReason = 'the answer was not valid chapter JSON';
      return {
        type: 'retry',
        repairPrompt: `Your answer could not be read as the chapter JSON (${v.error}).`,
        reason: this.lastReason,
      };
    }
    this.rejectedTotal += v.value.rejected.length;
    const [min] = stepsOf(this.s.input.length);
    const accepted = v.value.accepted.length;
    if (v.value.rejected.length === 0 && accepted >= min)
      return { type: 'accept', value: this.result(v.value) };
    const shortBy = Math.max(0, min - accepted);
    const reason =
      v.value.rejected.length === 0
        ? `${String(shortBy)} steps missing`
        : chapterSummary(v.value.rejected);
    if (!this.best || accepted > this.best.accepted.length) this.best = v.value;
    this.lastReason = reason;
    return {
      type: 'retry',
      repairPrompt: v.value.rejected.map((r) => `- ${r.id}: ${r.message}`).join('\n'),
      reason,
    };
  }

  onExhausted(): MockVerdict {
    const attempts = 1 + MOCK_MAX_RETRIES;
    if (this.best && this.best.accepted.length >= enoughSteps(this.s.input.length))
      return { type: 'accept', value: this.result(this.best) };
    return {
      type: 'fail',
      message: `Hoot could not verify enough steps of "${this.s.chapter.title}" after ${String(attempts)} attempts (${this.lastReason}).`,
    };
  }
}

/** The steps of a pool chapter sized for `length` (the recap last). */
function sized(p: PoolChapter, length: Length): JsonValue[] {
  const [min, max] = stepsOf(length);
  const steps = [...p.steps];
  for (const extra of p.extras) if (steps.length + 1 < min) steps.push(extra);
  return [...steps.slice(0, max - 1), p.recap];
}

/**
 * What the mock model answers to the chapter of `stage` (its 1-based number in the run), attempt
 * `n`: a pool chapter written for the outline's chapter.
 */
export function scriptedChapter(
  script: MockTutorialScript,
  s: MockChapterStage,
  stageNumber: number,
  n: number,
): unknown {
  const p = POOL[s.index % POOL.length] as PoolChapter;
  const chapter = {
    id: s.chapter.id,
    title: s.chapter.title,
    hootIntro: p.hootIntro,
    steps: sized(p, s.input.length),
  };
  if (script === 'retry' && n === 1) return { ...chapter, steps: [GENERIC_STEP, ...chapter.steps] };
  if (script === 'stageFail' && stageNumber === 2) return null;
  if (script === 'exhaust') return null;
  return chapter;
}

export type { Step };

// ---------------------------------------------------------------------------------------------
// "Suggest more subjects", like Rust's `learning/tutorial/suggest.rs`.

export interface MockSuggestComposed {
  ctx: TutorialValidationContext;
  taken: Set<string>;
  prompt: string;
  inlined: AiInlinedDocument[];
}

export function composeMockSuggest(
  deps: MockTutorialDeps,
  offered: TutorialSubject[],
): MockSuggestComposed {
  const b = base(deps, normalizedInput({ ...EMPTY_INPUT, subject: 'more subjects to learn' }));
  const list = offered.map((c) => `- ${c.title}`).join('\n') || '(none)';
  return {
    ctx: b.ctx,
    taken: new Set(offered.map((c) => c.title.toLowerCase())),
    prompt: `You are Hoot, the teacher of IGrasp's Academy. Suggest 5 to 8 more tutorial subjects about ${deps.profile.name}.\nAlready offered:\n${list}`,
    inlined: inlinedOf(deps, ['README.md', 'docs/architecture.md']),
  };
}

const EMPTY_INPUT: TutorialInput = {
  subject: '',
  subjectId: null,
  picks: [],
  familiarity: 'newHere',
  domainGap: null,
  length: 'standard',
  role: null,
};

interface RawSuggestion {
  title: string;
  blurb: string;
  anchors: string[];
  selfCheck: { projectSpecific: boolean; reason: string };
}

/** Like Rust's `SuggestValidator`. */
export class MockSuggestValidator {
  private best: TutorialSubject[] = [];
  private rejectedTotal = 0;
  private lastReason = '';

  constructor(private readonly c: MockSuggestComposed) {}

  private validate(raw: RawSuggestion[]): [TutorialSubject[], [string, string][]] {
    const accepted: TutorialSubject[] = [];
    const rejected: [string, string][] = [];
    for (const s of raw.slice(0, 8)) {
      const title = s.title.split(/\s+/).filter(Boolean).join(' ');
      const key = title.toLowerCase();
      const verdict = ((): TutorialSubject | string => {
        if (this.c.taken.has(key) || accepted.some((a) => a.title.toLowerCase() === key))
          return 'is already offered';
        const anchors: string[] = [];
        const cited = new Set<string>();
        for (const a of s.anchors) {
          const path = a
            .trim()
            .replace(/^(?:\.\/)+/, '')
            .replace(/\\/g, '/');
          const file = this.c.ctx.corpus.files.get(path);
          if (file) {
            if (!file.binary) {
              for (const l of file.lines.slice(0, 3000)) for (const w of words(l)) cited.add(w);
              anchors.push(path);
            }
          } else if (isAgentFile(path, this.c.ctx.agentNames))
            return `starts from ${path}, an agent instruction file`;
          else if (isSecret(path)) return `starts from ${path}, a file that may hold secrets`;
        }
        if (anchors.length === 0) return 'names no text file of this project as an anchor';
        if (!s.selfCheck.projectSpecific) return 'your own self-check says it is not specific';
        if (!namesTheProject(`${s.title} ${s.blurb}`, cited, this.c.ctx))
          return 'generic: the title and the blurb name nothing of this project';
        return {
          id: `suggested:${slug(title)}`,
          kind: 'suggested',
          family: 'Suggested',
          title,
          blurb: s.blurb.trim(),
          focus: `${title}: ${s.blurb.trim()}`,
          anchors,
          material: 'some',
          picks: [],
          domain: null,
        };
      })();
      if (typeof verdict === 'string') rejected.push([title, verdict]);
      else accepted.push(verdict);
    }
    return [accepted, rejected];
  }

  check(output: unknown): MockVerdict {
    const subjects =
      typeof output === 'object' && output !== null && 'subjects' in output
        ? output.subjects
        : null;
    if (!Array.isArray(subjects)) {
      this.lastReason = 'the answer was not valid JSON';
      return {
        type: 'retry',
        repairPrompt: 'Return the subjects JSON again.',
        reason: this.lastReason,
      };
    }
    const [accepted, rejected] = this.validate(subjects as RawSuggestion[]);
    this.rejectedTotal += rejected.length;
    if (accepted.length > this.best.length) this.best = accepted;
    if (accepted.length >= 3 && rejected.length === 0)
      return { type: 'accept', value: { subjects: accepted, rejectedCount: this.rejectedTotal } };
    this.lastReason = `${String(rejected.length)} subjects rejected`;
    return {
      type: 'retry',
      repairPrompt: rejected.map(([t, why]) => `- ${t}: ${why}`).join('\n'),
      reason: this.lastReason,
    };
  }

  onExhausted(): MockVerdict {
    if (this.best.length === 0)
      return {
        type: 'fail',
        message: `Hoot could not find a new subject grounded in this project after ${String(1 + MOCK_MAX_RETRIES)} attempts (${this.lastReason}).`,
      };
    return { type: 'accept', value: { subjects: this.best, rejectedCount: this.rejectedTotal } };
  }
}

const suggestion = (title: string, blurb: string, anchors: string[]): RawSuggestion => ({
  title,
  blurb,
  anchors,
  selfCheck: { projectSpecific: true, reason: 'names files of igrasp-demo' },
});

/** What the mock model suggests, attempt `n`. */
export function scriptedSuggest(script: MockTutorialScript, n: number): unknown {
  if (script === 'exhaust') return null;
  const subjects = [
    suggestion(
      'How igrasp-demo shouts a greeting',
      'Follows the loud option of main() in src/main.ts.',
      ['src/main.ts'],
    ),
    suggestion('What the CI of igrasp-demo checks', 'Follows ci.yml down to make test.', [
      '.github/workflows/ci.yml',
      'Makefile',
    ]),
    suggestion(
      'How igrasp-demo is packaged as the demo command',
      'Follows the bin entry of package.json to src/main.ts.',
      ['package.json', 'src/main.ts'],
    ),
  ];
  if (script === 'retry' && n === 1)
    return {
      subjects: [...subjects, suggestion('Learn TypeScript', 'Types in general.', ['README.md'])],
    };
  return { subjects };
}

// ---------------------------------------------------------------------------------------------
// The cost line, like Rust's `learning/tutorial/cost.rs`.

const MEASURED: Record<string, Record<Length, [number, number]>> = {
  outline: { quick: [0.15, 0.25], standard: [0.2, 0.45], deep: [0.45, 0.6] },
  chapters: { quick: [0.15, 0.25], standard: [0.2, 0.45], deep: [0.4, 0.55] },
  review: { quick: [0.2, 0.6], standard: [0.2, 0.6], deep: [0.2, 0.6] },
  suggest: { quick: [0.05, 0.2], standard: [0.05, 0.2], deep: [0.05, 0.2] },
};
const WHAT: Record<string, string> = {
  outline: 'outline',
  chapters: 'chapter',
  review: 'review',
  suggest: 'suggestion',
};

export function costHint(
  usage: TutorialUsage[],
  kind: string,
  length: Length,
  calls: number,
): string {
  const n = Math.max(1, calls);
  const what = WHAT[kind] ?? 'suggestion';
  const last = [...usage]
    .reverse()
    .filter((u) => u.kind === kind && u.calls > 0)
    .find((u) => u.length === length || kind === 'review' || kind === 'suggest');
  if (last && last.costUsd !== null) {
    const per = last.costUsd / last.calls;
    return n === 1
      ? `The last ${what} in this folder cost $${per.toFixed(2)} (with ${last.model === '' ? 'the default model' : last.model}).`
      : `About $${per.toFixed(2)} per ${what} in this folder, so about $${(per * n).toFixed(2)} for ${String(n)}.`;
  }
  const [low, high] = MEASURED[kind]?.[length] ?? [0.05, 0.2];
  const total =
    n > 1 ? `, about $${(low * n).toFixed(2)}–${(high * n).toFixed(2)} for ${String(n)}` : '';
  return `Usually $${low.toFixed(2)}–${high.toFixed(2)} per ${what} with a mid-size model on real projects${total}; a large project costs more.`;
}
