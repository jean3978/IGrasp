// The mock backend's quiz generation, like `learning/quiz/compose.rs`: the composed request (a
// short prompt with the task block, read-only, with a schema), the documents it inlines, the
// validator that accepts, repairs or gives up on each attempt with the same cap as Rust, and the
// scripted answers of the mock AI (`MockQuizScript`, chosen with `__igraspMock.state.ai`).

import { tutorialCitations } from '../../lib/tutorial';
import type {
  AiInlinedDocument,
  JsonValue,
  ProjectProfile,
  QuizGenerationInput,
  Tutorial,
  QuizResult,
  Subject,
} from '../types';
import { POOL } from './mockQuizPool';
import type { PoolQuestion } from './mockQuizPool';
import { corpusOfFiles, rejectionSummary, validateQuiz } from './mockQuizValidate';
import type { QuizCorpus, ValidatedQuiz } from './mockQuizValidate';

/** Like `ai::run::MAX_RETRIES`. */
export const MOCK_MAX_RETRIES = 2;
/** Like `difficulty::ROUND_SIZE`. */
export const MOCK_ROUND_SIZE = 5;

/**
 * What the mock AI answers to a quiz generation:
 * - `valid`: grounded questions from the pool (rounds and exclusions honoured);
 * - `retry`: the first attempt cites an agent file and a range that does not exist, the next
 *   ones are valid;
 * - `exhaust`: every attempt cites agent files only (the operation fails after three);
 * - `thin`: too little material: two questions, a note and suggested subjects;
 * - `textOnly`: the answer comes as a text block with the JSON (the fallback path);
 * - `slow`: reads a file per second for five seconds first (for Cancel and the activity line);
 * - `leak`: the first attempt cites code (rejected under "Documentation only"), then valid.
 */
export type MockQuizScript = 'valid' | 'retry' | 'exhaust' | 'thin' | 'textOnly' | 'slow' | 'leak';

/** Like `run::json_of_text`: the whole text, a fenced block, or from the first `{` to the last
 * `}`; null when none parses. */
export function jsonOfText(text: string): unknown {
  const parse = (t: string): unknown => {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return undefined;
    }
  };
  const trimmed = text.trim();
  const whole = parse(trimmed);
  if (whole !== undefined) return whole;
  const block = trimmed.split('```')[1];
  if (block !== undefined) {
    const fenced = parse(block.replace(/^json/, '').trim());
    if (fenced !== undefined) return fenced;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && start < end ? (parse(trimmed.slice(start, end + 1)) ?? null) : null;
}

/** The schema the mock sends (the real one is Rust's; the mock only marks the request). */
export const MOCK_QUIZ_SCHEMA: JsonValue = { type: 'object', title: 'quiz' };

const normalized = (text: string) =>
  Array.from(text.toLowerCase())
    .filter((c) => /[\p{L}\p{N}]/u.test(c))
    .join('');

/** Like `difficulty::plan`. */
export function difficultyPlan(count: number, level: number): number[] {
  const l = Math.min(5, Math.max(1, level));
  const weight = (d: number) =>
    d === 0 ? 3 : d === 1 ? 2.6 : d === -1 ? 2.2 : Math.abs(d) === 2 ? 1 : 0.5;
  if (count <= 0) return [0, 0, 0, 0, 0];
  const weights = [1, 2, 3, 4, 5].map((x) => weight(x - l));
  const total = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w * count) / total);
  const out = exact.map(Math.floor);
  let given = out.reduce((a, b) => a + b, 0);
  const order = [0, 1, 2, 3, 4].sort((a, b) => {
    const ra = (exact[a] ?? 0) - (out[a] ?? 0);
    const rb = (exact[b] ?? 0) - (out[b] ?? 0);
    return rb - ra || Math.abs(a + 1 - l) - Math.abs(b + 1 - l);
  });
  for (let i = 0; given < count; i = (i + 1) % 5, given++) {
    const at = order[i] ?? 0;
    out[at] = (out[at] ?? 0) + 1;
  }
  if (out[l - 1] === 0) {
    const far = [0, 1, 2, 3, 4]
      .filter((i) => (out[i] ?? 0) > 0)
      .sort((a, b) => Math.abs(b - (l - 1)) - Math.abs(a - (l - 1)))[0];
    if (far !== undefined) {
      out[far] = (out[far] ?? 0) - 1;
      out[l - 1] = 1;
    }
  }
  return out;
}

export interface MockQuizComposed {
  prompt: string;
  inlined: AiInlinedDocument[];
  corpus: QuizCorpus;
  count: number;
  plan: number[];
  input: QuizGenerationInput;
}

interface ComposeDeps {
  files: Map<string, string>;
  profile: ProjectProfile;
  subjects: Subject[];
  agentNames: string[];
}

/** A root-relative path with `/` separators and no leading or trailing slash. */
const normalizePath = (p: string) =>
  p
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/');

/** Like `QuizGenerationInput::normalized`. */
function normalizedInput(input: QuizGenerationInput): QuizGenerationInput {
  let count = Math.min(30, Math.max(3, input.count));
  if (input.mode === 'adaptive') count = Math.min(count, MOCK_ROUND_SIZE);
  const custom = input.subjectId === null ? (input.customSubject ?? '').trim().slice(0, 200) : '';
  const scope: QuizGenerationInput['scope'] =
    input.scope.type === 'paths'
      ? {
          type: 'paths',
          paths: [...new Set(input.scope.paths.map((p) => normalizePath(p)).filter(Boolean))].slice(
            0,
            50,
          ),
        }
      : input.scope;
  return {
    ...input,
    count,
    startLevel: Math.min(5, Math.max(1, input.startLevel)),
    customSubject: custom === '' ? null : custom,
    scope,
  };
}

/** Like `compose`: throws when the subject is no longer proposed. */
export function composeMockQuiz(
  deps: ComposeDeps,
  raw: QuizGenerationInput,
  resumeId: string | undefined,
  tutorial: Tutorial | null = null,
): MockQuizComposed {
  let input = normalizedInput(raw);
  // "Quiz me on this tutorial": its cited files are the sources (like Rust's `compose`).
  if (tutorial) {
    const cited = [...new Set(tutorialCitations(tutorial).map((c) => c.path))].sort();
    input = {
      ...input,
      scope: { type: 'paths', paths: cited },
      subjectId: null,
      customSubject: null,
      category: 'tutorial',
      domainGap: input.domainGap ?? tutorial.domainGap ?? null,
    };
  }
  const subject =
    input.subjectId === null ? null : deps.subjects.find((s) => s.id === input.subjectId);
  if (subject === undefined) {
    throw new Error(
      `The subject "${String(input.subjectId)}" is no longer proposed for this folder; pick another one.`,
    );
  }
  const corpus = corpusOfFiles(deps.files, input.scope, deps.agentNames);
  const paths = input.scope.type === 'paths' ? input.scope.paths : null;
  if (paths && [...corpus.files.values()].every((f) => f.binary)) {
    throw new Error(
      `None of these paths holds text files of the project: ${paths.join(', ')}. Check the paths (root-relative, like src/main.rs or src/save).`,
    );
  }
  const overview = deps.subjects.find((s) => s.id === 'concept:architecture');
  // A typed subject starts from the files its words name (like Rust `custom_anchors`).
  const typedWords = (input.customSubject ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
  const typed = [...corpus.files.keys()].filter((p) =>
    typedWords.some((w) => p.toLowerCase().includes(w)),
  );
  let anchors =
    subject?.anchors ??
    (paths ? [...corpus.files.keys()].slice(0, 5) : null) ??
    (typed.length > 0 ? typed.slice(0, 5) : null) ??
    overview?.anchors ??
    [];
  if (input.scope.type === 'documentationOnly') {
    anchors = [...anchors, deps.profile.docs.readme ?? '', deps.profile.docs.architecture ?? ''];
  }
  anchors = [...new Set(anchors)].filter((a) => corpus.files.has(a));
  const level = input.round?.level ?? input.startLevel;
  const plan = difficultyPlan(input.count, level);
  const planText = plan
    .map((n, i) => (n > 0 ? `${String(n)} of difficulty ${String(i + 1)}` : ''))
    .filter(Boolean)
    .join(', ');
  const about = tutorial
    ? `the tutorial "${tutorial.title}" about ${deps.profile.name} (${tutorial.subject}), which the player just took`
    : subject
      ? `${deps.profile.name}'s "${subject.title}" (${subject.focus})`
      : paths
        ? `the code of ${deps.profile.name} in ${paths.join(', ')}`
        : input.customSubject
          ? `"${input.customSubject}" in ${deps.profile.name} (${input.category === 'feature' ? 'a feature of the project' : input.category === 'global' ? 'a concept across the project' : 'a subject'} that the player typed)`
          : `${deps.profile.name} as a whole`;
  const lines = [
    resumeId === undefined
      ? `You are Hoot, the quiz master of IGrasp, writing a quiz about ONE specific software project.`
      : '',
    input.round
      ? `This is round ${String(input.round.number)} of ${String(input.round.of)}; now at level ${String(input.round.level)}.`
      : '',
    `Write ${String(input.count)} questions about ${about}, with these difficulties: ${planText}.`,
    input.scope.type === 'documentationOnly' ? 'Sources are limited to the documentation.' : '',
    tutorial
      ? `Question style: test understanding, not memory. The tutorial "${tutorial.title}" taught: ${tutorial.chapters
          .filter((c) => c.steps.length > 0)
          .map((c) => `${c.title}: ${c.goal}`)
          .join(' | ')}`
      : '',
    input.role ? `Audience: ${input.role} on this project.` : 'Audience: developers.',
    input.category ? `Kind of quiz: ${input.category}.` : '',
    input.exclude.length > 0
      ? `Do not ask again: ${input.exclude.map((e) => e.question).join(' | ')}`
      : '',
    resumeId === undefined ? `# Anchor files\n${anchors.join('\n')}` : '',
  ];
  const size = (path: string) => (deps.files.get(path) ?? '').length;
  const inlined: AiInlinedDocument[] =
    resumeId === undefined
      ? [
          ...anchors.map((path) => ({ path, bytes: size(path), contextOnly: false })),
          ...corpus.agentFiles.map((f) => ({
            path: f.path,
            bytes: size(f.path),
            contextOnly: true,
          })),
        ]
      : [];
  const prompt = lines.filter(Boolean).join('\n');
  return { prompt, inlined, corpus, count: input.count, plan, input };
}

/** Like `QuizValidator` in Rust. */
export type MockVerdict =
  | { type: 'accept'; value: QuizResult }
  | { type: 'retry'; repairPrompt: string; reason: string }
  | { type: 'fail'; message: string };

export class MockQuizValidator {
  private best: ValidatedQuiz | null = null;
  private rejectedTotal = 0;
  private lastReason = '';

  constructor(
    private readonly composed: MockQuizComposed,
    private readonly profile: ProjectProfile,
    private readonly agentNames: string[],
  ) {}

  private result(v: ValidatedQuiz, note: string | null): QuizResult {
    return {
      questions: v.accepted,
      insufficientMaterial: v.insufficientMaterial,
      materialNote: note ?? v.materialNote,
      docsNote: v.docsNote,
      suggestedSubjects: v.suggestedSubjects,
      rejectedCount: this.rejectedTotal,
    };
  }

  check(output: unknown): MockVerdict {
    const validated = validateQuiz(output, {
      corpus: this.composed.corpus,
      agentNames: this.agentNames,
      projectName: this.profile.name,
      modules: this.profile.modules.map((m) => m.path),
      exclude: this.composed.input.exclude,
      count: this.composed.count,
    });
    if (!validated.ok) {
      this.lastReason = 'the answer was not valid quiz JSON';
      return {
        type: 'retry',
        repairPrompt: `Return the complete JSON again (${validated.error}).`,
        reason: this.lastReason,
      };
    }
    const v = validated.value;
    this.rejectedTotal += v.rejected.length;
    if (v.insufficientMaterial || v.accepted.length >= this.composed.count) {
      return { type: 'accept', value: this.result(v, null) };
    }
    const shortBy = this.composed.count - v.accepted.length;
    const reason =
      v.rejected.length === 0
        ? `${String(shortBy)} questions missing`
        : rejectionSummary(v.rejected);
    if (this.best === null || v.accepted.length > this.best.accepted.length) this.best = v;
    this.lastReason = reason;
    return {
      type: 'retry',
      repairPrompt: [
        `Thank you. IGrasp checked your questions against the project. ${String(v.accepted.length)} were accepted.`,
        ...v.rejected.map((r) => `- ${r.id}: ${r.message}`),
        'Same schema, JSON only.',
      ].join('\n'),
      reason,
    };
  }

  onExhausted(): MockVerdict {
    const attempts = 1 + MOCK_MAX_RETRIES;
    const best = this.best;
    this.best = null;
    const enough = Math.min(3, Math.max(1, Math.floor(this.composed.count / 2)));
    if (best && best.accepted.length >= enough) {
      return {
        type: 'accept',
        value: this.result(
          best,
          `Hoot could verify ${String(best.accepted.length)} of the ${String(this.composed.count)} questions after ${String(attempts)} attempts.`,
        ),
      };
    }
    return {
      type: 'fail',
      message: `Hoot could not verify enough questions after ${String(attempts)} attempts (${this.lastReason}). Try another subject or fewer questions.`,
    };
  }
}

/** Questions from the pool for the plan, skipping excluded ones and, under "Documentation
 * only", anything citing code. */
function pick(composed: MockQuizComposed, count: number): PoolQuestion[] {
  const excluded = new Set(composed.input.exclude.map((e) => normalized(e.question)));
  // Only questions whose sources are all in scope (the docs, or the code to check).
  const available = POOL.filter(
    (q) =>
      !excluded.has(normalized(q.question)) &&
      q.sources.every((s) => composed.corpus.files.has(s.path)),
  );
  const out: PoolQuestion[] = [];
  composed.plan.forEach((n, i) => {
    const level = available.filter((q) => q.difficulty === i + 1 && !out.includes(q));
    out.push(...level.slice(0, n));
  });
  for (const q of available) if (out.length < count && !out.includes(q)) out.push(q);
  return out.slice(0, count);
}

const asRaw = (q: PoolQuestion, id: string) => ({
  id,
  ...q,
  selfCheck: { projectSpecific: true, reason: 'cites the fixture project' },
});

const broken = (id: string, path: string, firstLine: number, lastLine: number) => ({
  id,
  kind: 'multipleChoice',
  question: `What do the rules of igrasp-demo say (${id})?`,
  choices: ['Keep answers short', 'Write long answers', 'Never cite files'],
  answer: 0,
  hint: 'Read the rules.',
  explanation: 'The rules of igrasp-demo say to keep answers short.',
  sources: [{ path, firstLine, lastLine }],
  difficulty: 2,
  selfCheck: { projectSpecific: true, reason: 'r' },
});

/** The structured answer of attempt `attempt` (1-based) for `script`. */
export function scriptedAnswer(
  script: MockQuizScript,
  composed: MockQuizComposed,
  attempt: number,
): JsonValue {
  const count = composed.count;
  const valid = () => pick(composed, count).map((q, i) => asRaw(q, `q${String(i + 1)}`));
  const answer = (questions: unknown[], extra: Record<string, JsonValue> = {}): JsonValue =>
    ({ insufficientMaterial: false, questions, ...extra }) as JsonValue;
  switch (script) {
    case 'retry': {
      if (attempt > 1) return answer(valid());
      const qs: unknown[] = valid();
      qs[1] = broken('q2', 'AGENTS.md', 1, 3);
      if (qs.length > 3) qs[3] = broken('q4', 'README.md', 200, 210);
      return answer(qs);
    }
    case 'exhaust':
      return answer(
        Array.from({ length: count }, (_, i) => broken(`q${String(i + 1)}`, 'AGENTS.md', 1, 2)),
      );
    case 'thin':
      return answer(
        pick(composed, 2).map((q, i) => asRaw(q, `q${String(i + 1)}`)),
        {
          insufficientMaterial: true,
          materialNote:
            'igrasp-demo has little material on this subject: Hoot wrote two questions.',
          docsNote:
            'Nothing documents how the greeting is built or released; a page in docs/ would help.',
          suggestedSubjects: ['Build, CI and release'],
        },
      );
    case 'leak': {
      if (attempt > 1) return answer(valid());
      const qs: unknown[] = valid();
      const code = POOL.find((q) => q.sources.some((s) => s.path === 'src/main.ts'));
      if (code) qs[0] = asRaw(code, 'q1');
      return answer(qs);
    }
    default:
      return answer(valid());
  }
}
