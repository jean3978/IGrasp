// The quiz (plan §6.2): its screens, the setup of a new quiz, the one generation call, the
// questions being played and the history. `start` is the only place a quiz spends tokens
// (`backend.aiStart`), reached from the confirmation card's Start (a new quiz, Keep going) or
// from the Next round button of an adaptive quiz; everything else is local: the profile, the
// subjects, the estimate, playing, hints, replays and saving.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import type {
  AiEventEnvelope,
  AiSizeEstimate,
  QuizExclusion,
  QuizFileSummary,
  QuizGenerationInput,
  QuizMode,
  QuizQuestion,
  QuizRecord,
  QuizResult,
  QuizScopeSetting,
  QuizSummary,
  SourceScope,
  Subject,
} from '../ipc/types';
import { BackendError } from '../ipc/types';
import { resultsFileName, resultsMarkdown } from '../features/quiz/quizMarkdown';
import {
  checkSources,
  hashSources,
  parseQuizFile,
  quizFileMarkdown,
  quizFileName,
  recordFromFile,
} from '../features/quiz/quizFile';
import type { ReadSource, SourceNote } from '../features/quiz/quizFile';
import {
  answer as engineAnswer,
  initialEngine,
  next as engineNext,
  rekey,
  restoreEngine,
  roundSize,
  roundsOf,
  takeHint,
  takeLook,
} from '../features/quiz/quizEngine';
import type { EngineState } from '../features/quiz/quizEngine';
import { errorMessage, useAiProvider } from './aiProvider';
import { useProjectProfile } from './projectProfile';
import { useSettings } from './settings';
import { useToasts } from './toasts';

export type QuizScreen = 'home' | 'confirm' | 'generating' | 'question' | 'results';

/** The level a new quiz starts at (difficulty 2: you read the README and a little code). */
export const START_LEVEL = 2;
/** Tool summaries kept for the activity line. */
const ACTIVITY_LINES = 4;

export interface QuizSetup {
  /** What the quiz is about: a proposed subject (or none), a typed one, or code to check. */
  target: QuizTarget;
  /** Null: no specific subject. */
  subjectId: string | null;
  /** The subject the developer typed (target `custom`). */
  customSubject: string;
  /** Root-relative files or folders (target `paths`). */
  paths: string[];
  count: number;
  mode: QuizMode;
  scope: QuizScopeSetting;
}

/** What a generation adds: a new quiz, the next adaptive round, or more questions. */
export type GenerationKind = 'new' | 'round' | 'keepGoing';

export interface PendingConfirm {
  kind: GenerationKind;
  input: QuizGenerationInput;
  /** The questions the quiz will have once this generation is confirmed (Keep going). */
  count: number;
}

export interface GenerationProgress {
  kind: GenerationKind;
  startedMs: number;
  /** The last tool summaries ("Read src/main.ts"). */
  activity: string[];
  filesRead: number;
  /** The retry that started, if any. */
  attempt: { number: number; of: number; reason: string } | null;
  /** The adaptive round being written. */
  round: { number: number; of: number; level: number } | null;
}

/** Why the last generation ended without questions (shown on the home). */
export interface QuizFailure {
  message: string;
  suggestedSubjects: string[];
}

interface QuizState {
  screen: QuizScreen;
  setup: QuizSetup;
  /** The estimate and the generation waiting for the confirmation card. */
  estimate: AiSizeEstimate | null;
  pending: PendingConfirm | null;
  operationId: number | null;
  /** Between Start and the operation id: its events are buffered. */
  starting: boolean;
  buffered: AiEventEnvelope[];
  generation: GenerationProgress | null;
  failure: QuizFailure | null;
  /** The quiz on screen (also saved as the current quiz until it is finished). */
  record: QuizRecord | null;
  engine: EngineState | null;
  /** An unfinished quiz found in app data (the Continue card). */
  saved: QuizRecord | null;
  history: QuizSummary[];
  /** The quiz files of the folder (Saved quizzes). */
  quizFiles: QuizFileSummary[];
  /** Sources of a quiz file that changed or went missing, by question id. */
  sourceNotes: Record<string, SourceNote[]>;

  /** Loads what the home shows: profile, subjects, history, a quiz to continue (all local). */
  openHome: (root: string) => Promise<void>;
  setSetup: (patch: Partial<QuizSetup>) => void;
  /** Estimates the new quiz and shows the confirmation card (spends nothing). */
  prepare: () => Promise<void>;
  /** Estimates more questions at the level reached and shows the card (spends nothing). */
  keepGoing: () => Promise<void>;
  cancelConfirm: () => void;
  /** Start on the confirmation card: the generation it describes. */
  confirmStart: () => Promise<void>;
  /** Next round of an adaptive quiz (the button's click is the user action). */
  nextRound: () => Promise<void>;
  /** Stops the running generation. */
  cancel: () => Promise<void>;
  /** `ai://event` of the quiz's operation (routed by the event bridge). */
  onEvent: (envelope: AiEventEnvelope) => void;
  /** Whether `operationId` is the quiz's (or the quiz is starting one). */
  owns: (operationId: number) => boolean;
  answer: (choice: number) => void;
  hint: () => void;
  /** "Look it up" opened the cited files before the answer (recorded with it). */
  lookUp: () => void;
  /** After the reveal: the next question, or the results when the pool is played. */
  next: () => void;
  finish: () => Promise<void>;
  /** Plays a finished quiz again from the history or the results (no AI). */
  playAgain: (id?: string) => Promise<void>;
  /** Plays a quiz built elsewhere (a quiz file), no AI. */
  play: (record: QuizRecord, notes?: Record<string, SourceNote[]>) => Promise<void>;
  /** Plays a quiz file: `relPath` in the folder, or the one picked in the open dialog. No AI. */
  playFile: (relPath?: string) => Promise<void>;
  refreshQuizFiles: () => Promise<void>;
  continueSaved: () => void;
  /** Back to the home; an unfinished quiz stays as the current quiz. */
  goHome: () => void;
  newQuiz: () => void;
  forgetHistory: () => Promise<void>;
  /** Save results…: the save dialog, then a toast that opens the file (silent when dismissed). */
  saveResults: () => Promise<void>;
  /** Save quiz…: the quiz as a shareable file (with the hashes of its cited lines). */
  saveQuiz: () => Promise<void>;
  /** The folder closed or changed. */
  leaveFolder: () => void;
}

export type QuizTarget = 'subject' | 'custom' | 'paths';

/** A typed subject is kept in the record as `custom:<text>`. */
const CUSTOM = 'custom:';

/** The subject fields of an input continuing `subject` (a record's). */
export const subjectFields = (
  subject: string | null,
): Pick<QuizGenerationInput, 'subjectId' | 'customSubject'> =>
  subject?.startsWith(CUSTOM)
    ? { subjectId: null, customSubject: subject.slice(CUSTOM.length) }
    : { subjectId: subject, customSubject: null };

/** What a new quiz is about, from the setup. */
export function targetInput(
  setup: QuizSetup,
): Pick<QuizGenerationInput, 'subjectId' | 'customSubject' | 'scope'> {
  if (setup.target === 'paths')
    return { subjectId: null, customSubject: null, scope: { type: 'paths', paths: setup.paths } };
  if (setup.target === 'custom')
    return {
      subjectId: null,
      customSubject: setup.customSubject.trim(),
      scope: scopeOf(setup.scope),
    };
  return { subjectId: setup.subjectId, customSubject: null, scope: scopeOf(setup.scope) };
}

/** The title a quiz shows: the subject's, the typed text, the code checked, or none. */
export function titleOf(input: QuizGenerationInput, subjects: Subject[]): string {
  if (input.scope.type === 'paths') return `Code check: ${input.scope.paths.join(', ')}`;
  if (input.customSubject) return input.customSubject;
  return subjects.find((s) => s.id === input.subjectId)?.title ?? 'No specific subject';
}

/** Whether the setup says what to ask about (a typed subject or paths are not empty). */
export const targetReady = (setup: QuizSetup) =>
  setup.target === 'subject' ||
  (setup.target === 'custom' ? setup.customSubject.trim() !== '' : setup.paths.length > 0);

export const scopeOf = (scope: QuizScopeSetting): SourceScope =>
  scope === 'documentationOnly' ? { type: 'documentationOnly' } : { type: 'wholeProject' };

export const newQuizId = () =>
  `quiz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const setupFromSettings = (): QuizSetup => {
  const learning = useSettings.getState().settings.learning;
  return {
    target: 'subject',
    customSubject: '',
    paths: [],
    subjectId: null,
    count: learning.quizQuestions,
    mode: learning.quizMode,
    scope: learning.quizScope,
  };
};

/** Rounds an adaptive quiz of the record plans; 1 for a fixed quiz. */
export const plannedRounds = (r: QuizRecord) => (r.mode === 'adaptive' ? roundsOf(r.count) : 1);

/** What follows the reveal of the current question. */
export function afterReveal(
  s: Pick<QuizState, 'record' | 'engine'>,
): 'next' | 'nextRound' | 'results' {
  const { record, engine } = s;
  if (!record || !engine) return 'results';
  if (engine.asked.length < record.questions.length) return 'next';
  if (record.origin.type === 'generated' && record.rounds < plannedRounds(record))
    return 'nextRound';
  return 'results';
}

const exclusions = (questions: QuizQuestion[]): QuizExclusion[] =>
  questions.map((q) => ({ question: q.question, source: q.sources[0]?.path ?? null }));

function save(record: QuizRecord) {
  backend.saveCurrentQuiz(record).catch((err: unknown) => {
    useToasts.getState().notify('error', `Cannot save the quiz: ${errorMessage(err)}`);
  });
}

const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, costUsd: null });

/** A source file's text for the freshness hashes; null when it is gone or not text. */
const readSource: ReadSource = (relPath) =>
  backend.readTextFile(relPath).then(
    (f) => ({ content: f.content, truncated: f.truncated }),
    () => null,
  );

export const useQuiz = create<QuizState>()((set, get) => {
  /** What the running operation produced so far. */
  let run: {
    result: QuizResult | null;
    error: string | null;
    resumeId: string | null;
    model: string | null;
    usage: {
      inputTokens: number;
      outputTokens: number;
      costUsd: number | null;
      durationMs: number;
    };
    attempts: number;
    input: QuizGenerationInput;
    count: number;
  } | null = null;

  const baseInput = (over: Partial<QuizGenerationInput>): QuizGenerationInput => {
    const { setup } = get();
    return {
      ...targetInput(setup),
      count: setup.count,
      mode: setup.mode,
      round: null,
      startLevel: START_LEVEL,
      exclude: [],
      domainGap: null,
      ...over,
    };
  };

  /** The input of the next adaptive round of `record`. */
  const roundInput = (
    record: QuizRecord,
    engine: EngineState,
    total: number,
  ): QuizGenerationInput => {
    const number = record.rounds + 1;
    return {
      ...subjectFields(record.subject),
      count: Math.max(1, roundSize(total, number)),
      mode: 'adaptive',
      round: {
        number,
        of: roundsOf(total),
        asked: record.answers.length,
        right: engine.score,
        level: engine.level,
      },
      startLevel: engine.level,
      exclude: exclusions(record.questions),
      scope: record.scope,
      domainGap: null,
    };
  };

  /** The one call that spends tokens. */
  const start = async (kind: GenerationKind, input: QuizGenerationInput, count: number) => {
    if (get().operationId !== null || get().starting) return;
    const record = get().record;
    const resumeId = kind === 'new' ? undefined : (record?.resumeId ?? undefined);
    run = {
      result: null,
      error: null,
      resumeId: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: null, durationMs: 0 },
      attempts: 1,
      input,
      count,
    };
    set({
      screen: 'generating',
      starting: true,
      buffered: [],
      failure: null,
      pending: null,
      generation: {
        kind,
        startedMs: Date.now(),
        activity: [],
        filesRead: 0,
        attempt: null,
        round:
          input.round === null
            ? null
            : { number: input.round.number, of: input.round.of, level: input.round.level },
      },
    });
    const model = useAiProvider.getState().model;
    try {
      const operationId = await backend.aiStart('quizGeneration', {
        prompt: '',
        contextPaths: [],
        images: [],
        policy: 'readOnly',
        quiz: input,
        ...(model ? { model } : {}),
        ...(resumeId === undefined ? {} : { resumeId }),
      });
      const buffered = get().buffered;
      set({ operationId, starting: false, buffered: [] });
      for (const e of buffered) if (e.operationId === operationId) get().onEvent(e);
    } catch (err) {
      run = null;
      set({
        starting: false,
        buffered: [],
        generation: null,
        screen: get().record && kind !== 'new' ? 'results' : 'home',
        failure: { message: errorMessage(err), suggestedSubjects: [] },
      });
    }
  };

  /** A generation ended with `result`. */
  const applyResult = (kind: GenerationKind, result: QuizResult) => {
    const r = run;
    if (!r) return;
    const usage = (prev: QuizRecord['usage']) => ({
      inputTokens: prev.inputTokens + r.usage.inputTokens,
      outputTokens: prev.outputTokens + r.usage.outputTokens,
      costUsd:
        prev.costUsd === null && r.usage.costUsd === null
          ? null
          : (prev.costUsd ?? 0) + (r.usage.costUsd ?? 0),
    });
    const current = get().record;
    if (result.questions.length === 0) {
      set({
        screen: current && kind !== 'new' ? 'results' : 'home',
        generation: null,
        failure: {
          message:
            result.materialNote ?? 'Hoot found no question it could verify about this subject.',
          suggestedSubjects: result.suggestedSubjects,
        },
      });
      return;
    }
    if (kind === 'new' || !current) {
      const { setup } = get();
      const subjects = useProjectProfile.getState().subjects ?? [];
      const record: QuizRecord = {
        id: newQuizId(),
        startedMs: Date.now(),
        finishedMs: null,
        providerId: useAiProvider.getState().status?.providerId ?? '',
        model: r.model ?? useAiProvider.getState().model,
        subject: r.input.customSubject ? `${CUSTOM}${r.input.customSubject}` : r.input.subjectId,
        subjectTitle: titleOf(r.input, subjects),
        mode: r.input.mode,
        scope: r.input.scope,
        origin: { type: 'generated' },
        count: r.input.mode === 'adaptive' ? setup.count : result.questions.length,
        questions: rekey(result.questions, 1),
        answers: [],
        startLevel: r.input.startLevel,
        level: r.input.startLevel,
        score: 0,
        bestStreak: 0,
        usage: usage(emptyUsage()),
        durationMs: r.usage.durationMs,
        attempts: r.attempts,
        rounds: 1,
        resumeId: r.resumeId,
        materialNote: result.materialNote,
        suggestedSubjects: result.suggestedSubjects,
      };
      const engine = engineNext(initialEngine(record.startLevel), record.questions);
      set({ record, engine, screen: 'question', generation: null, saved: null });
      save(record);
      return;
    }
    const round = current.rounds + 1;
    const record: QuizRecord = {
      ...current,
      finishedMs: null,
      count:
        kind === 'keepGoing' && current.mode === 'fixed'
          ? current.count + result.questions.length
          : r.count,
      questions: [...current.questions, ...rekey(result.questions, round)],
      usage: usage(current.usage),
      durationMs: current.durationMs + r.usage.durationMs,
      attempts: current.attempts + r.attempts,
      rounds: round,
      resumeId: r.resumeId ?? current.resumeId,
      materialNote: result.materialNote ?? current.materialNote,
    };
    const engine = get().engine ?? initialEngine(record.level);
    set({
      record,
      engine: engineNext(engine, record.questions),
      screen: 'question',
      generation: null,
    });
    save(record);
  };

  return {
    screen: 'home',
    setup: setupFromSettings(),
    estimate: null,
    pending: null,
    operationId: null,
    starting: false,
    buffered: [],
    generation: null,
    failure: null,
    record: null,
    engine: null,
    saved: null,
    history: [],
    quizFiles: [],
    sourceNotes: {},

    async openHome(root) {
      const profile = useProjectProfile.getState();
      await profile.load(root);
      await Promise.all([
        useProjectProfile.getState().loadSubjects(),
        backend
          .listQuizHistory()
          .then((history) => {
            set({ history });
          })
          .catch(() => undefined),
        backend
          .getCurrentQuiz()
          .then((saved) => {
            if (!get().record) set({ saved });
          })
          .catch(() => undefined),
        get().refreshQuizFiles(),
      ]);
    },

    setSetup(patch) {
      set((s) => ({ setup: { ...s.setup, ...patch } }));
    },

    async prepare() {
      if (get().operationId !== null || get().starting) return;
      const { setup } = get();
      const input = baseInput({
        count: setup.mode === 'adaptive' ? roundSize(setup.count, 1) : setup.count,
        round: null,
      });
      try {
        const estimate = await backend.aiEstimate({
          promptBytes: 0,
          contextPaths: [],
          images: 0,
          quiz: input,
        });
        set({ estimate, pending: { kind: 'new', input, count: setup.count }, screen: 'confirm' });
      } catch (err) {
        set({ failure: { message: errorMessage(err), suggestedSubjects: [] } });
      }
    },

    async keepGoing() {
      const { record, engine, setup } = get();
      if (!record || !engine || get().operationId !== null) return;
      let input: QuizGenerationInput;
      let count: number;
      if (record.mode === 'adaptive') {
        count = record.count + setup.count;
        input = roundInput(record, engine, count);
      } else {
        count = record.count + setup.count;
        input = {
          ...subjectFields(record.subject),
          count: setup.count,
          mode: 'fixed',
          round: null,
          startLevel: engine.level,
          exclude: exclusions(record.questions),
          scope: record.scope,
          domainGap: null,
        };
      }
      try {
        const estimate = await backend.aiEstimate({
          promptBytes: 0,
          contextPaths: [],
          images: 0,
          quiz: input,
        });
        set({ estimate, pending: { kind: 'keepGoing', input, count }, screen: 'confirm' });
      } catch (err) {
        useToasts.getState().notify('error', `Cannot prepare more questions: ${errorMessage(err)}`);
      }
    },

    cancelConfirm() {
      const pending = get().pending;
      set({
        pending: null,
        estimate: null,
        screen: pending?.kind === 'keepGoing' ? 'results' : 'home',
      });
    },

    async confirmStart() {
      const pending = get().pending;
      if (!pending) return;
      await start(pending.kind, pending.input, pending.count);
    },

    async nextRound() {
      const s = get();
      if (afterReveal(s) !== 'nextRound' || !s.record || !s.engine) return;
      await start('round', roundInput(s.record, s.engine, s.record.count), s.record.count);
    },

    async cancel() {
      const { operationId } = get();
      if (operationId === null) return;
      try {
        await backend.aiCancel(operationId);
      } catch (err) {
        useToasts.getState().notify('error', `Cannot stop the generation: ${errorMessage(err)}`);
      }
    },

    owns(operationId) {
      const s = get();
      return s.operationId === operationId || (s.starting && s.operationId === null);
    },

    onEvent(envelope) {
      const s = get();
      if (envelope.operationId !== s.operationId) {
        if (s.starting) set({ buffered: [...s.buffered, envelope] });
        return;
      }
      const r = run;
      const generation = s.generation;
      if (!r || !generation) return;
      const { event } = envelope;
      switch (event.type) {
        case 'session':
          r.resumeId = event.resumeId;
          if (event.model) r.model = event.model;
          return;
        case 'toolUse':
          set({
            generation: {
              ...generation,
              activity: [...generation.activity, event.summary].slice(-ACTIVITY_LINES),
              filesRead: generation.filesRead + (/^(?:read|view|open)/i.test(event.tool) ? 1 : 0),
            },
          });
          return;
        case 'attempt':
          r.attempts += 1;
          set({
            generation: {
              ...generation,
              attempt: { number: event.number, of: event.of, reason: event.reason },
            },
          });
          return;
        case 'usage':
          r.usage = {
            inputTokens: r.usage.inputTokens + event.inputTokens,
            outputTokens: r.usage.outputTokens + event.outputTokens,
            costUsd:
              event.costUsd === null && r.usage.costUsd === null
                ? null
                : (r.usage.costUsd ?? 0) + (event.costUsd ?? 0),
            durationMs: r.usage.durationMs + event.durationMs,
          };
          return;
        case 'structuredOutput':
          r.result = event.value as unknown as QuizResult;
          return;
        case 'error':
          r.error = event.message;
          return;
        case 'done': {
          set({ operationId: null });
          const kind = generation.kind;
          if (event.outcome === 'Completed' && r.result) {
            applyResult(kind, r.result);
          } else if (event.outcome === 'Cancelled') {
            const record = get().record;
            // A cancelled round ends the quiz with what was played.
            if (record && kind !== 'new') {
              set({ generation: null });
              void get().finish();
            } else {
              set({ generation: null, screen: 'home' });
            }
          } else {
            const record = get().record;
            set({
              generation: null,
              screen: record && kind !== 'new' ? 'results' : 'home',
              failure: {
                message: r.error ?? event.detail ?? 'The generation failed.',
                suggestedSubjects: r.result?.suggestedSubjects ?? [],
              },
            });
          }
          run = null;
          return;
        }
        default:
          return;
      }
    },

    answer(choice) {
      const { record, engine } = get();
      if (!record || !engine || engine.current === null || engine.chosen !== null) return;
      const question = record.questions.find((q) => q.id === engine.current);
      if (!question || choice < 0 || choice >= question.choices.length) return;
      const out = engineAnswer(engine, question, choice);
      const next: QuizRecord = {
        ...record,
        answers: [...record.answers, out.answer],
        level: out.state.level,
        score: out.state.score,
        bestStreak: out.state.bestStreak,
      };
      set({ record: next, engine: out.state });
      save(next);
    },

    hint() {
      const engine = get().engine;
      if (engine) set({ engine: takeHint(engine) });
    },

    lookUp() {
      const engine = get().engine;
      if (engine) set({ engine: takeLook(engine) });
    },

    next() {
      const s = get();
      if (!s.record || !s.engine || s.engine.chosen === null) return;
      const after = afterReveal(s);
      if (after === 'next') set({ engine: engineNext(s.engine, s.record.questions) });
      else if (after === 'results') void get().finish();
    },

    async finish() {
      const record = get().record;
      if (!record) return;
      const finished: QuizRecord = { ...record, finishedMs: Date.now() };
      set({ record: finished, screen: 'results', saved: null });
      try {
        await backend.saveCurrentQuiz(finished);
        set({ history: await backend.listQuizHistory() });
      } catch (err) {
        useToasts.getState().notify('error', `Cannot save the quiz: ${errorMessage(err)}`);
      }
    },

    async playAgain(id) {
      let source = get().record;
      if (id !== undefined && source?.id !== id) {
        try {
          source = await backend.getQuizRecord(id);
        } catch (err) {
          useToasts.getState().notify('error', `Cannot open that quiz: ${errorMessage(err)}`);
          return;
        }
      }
      if (!source) return;
      const origin =
        source.origin.type === 'file' ? source.origin : { type: 'replay' as const, of: source.id };
      // A quiz file played again keeps the notes of its sources.
      await get().play({ ...source, origin }, origin.type === 'file' ? get().sourceNotes : {});
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async play(source, notes = {}) {
      const record: QuizRecord = {
        ...source,
        id: newQuizId(),
        startedMs: Date.now(),
        finishedMs: null,
        answers: [],
        level: source.startLevel,
        score: 0,
        bestStreak: 0,
        usage: emptyUsage(),
        durationMs: 0,
        attempts: 0,
        rounds: Math.max(1, source.rounds),
        resumeId: null,
        // A replay plays exactly the questions it has.
        mode: 'fixed',
        count: source.questions.length,
      };
      set({
        record,
        engine: engineNext(initialEngine(record.startLevel), record.questions),
        screen: 'question',
        saved: null,
        failure: null,
        sourceNotes: notes,
      });
      save(record);
    },

    continueSaved() {
      const saved = get().saved;
      if (!saved) return;
      set({
        record: saved,
        engine: restoreEngine(saved.startLevel, saved.questions, saved.answers),
        saved: null,
        screen: 'question',
      });
    },

    goHome() {
      const { record, operationId } = get();
      if (operationId !== null) return;
      const unfinished = record && record.finishedMs === null ? record : null;
      set({
        screen: 'home',
        record: null,
        engine: null,
        saved: unfinished ?? get().saved,
        pending: null,
        estimate: null,
      });
    },

    newQuiz() {
      if (get().operationId !== null) return;
      set({
        screen: 'home',
        record: null,
        engine: null,
        pending: null,
        estimate: null,
        failure: null,
      });
    },

    async forgetHistory() {
      await backend.forgetQuizzes();
      set({ history: [], saved: null });
    },

    async saveResults() {
      const { record } = get();
      if (!record) return;
      const project = useProjectProfile.getState().profile?.name ?? 'project';
      try {
        const file = await backend.saveQuizMarkdown(
          'results',
          resultsMarkdown(record, project),
          resultsFileName(project, record.finishedMs ?? Date.now()),
        );
        useToasts
          .getState()
          .notify(
            'info',
            `Results saved to ${file.relPath ?? file.path}`,
            file.relPath ?? undefined,
          );
      } catch (err) {
        if (err instanceof BackendError && err.code === 'SaveCancelled') return;
        useToasts.getState().notify('error', `Cannot save the results: ${errorMessage(err)}`);
      }
    },

    async saveQuiz() {
      const { record } = get();
      if (!record) return;
      const project = useProjectProfile.getState().profile?.name ?? 'project';
      try {
        const hashes = await hashSources(record.questions, readSource);
        const file = await backend.saveQuizMarkdown(
          'quiz',
          quizFileMarkdown(record, project, hashes),
          quizFileName(record),
        );
        useToasts
          .getState()
          .notify('info', `Quiz saved to ${file.relPath ?? file.path}`, file.relPath ?? undefined);
        void get().refreshQuizFiles();
      } catch (err) {
        if (err instanceof BackendError && err.code === 'SaveCancelled') return;
        useToasts.getState().notify('error', `Cannot save the quiz: ${errorMessage(err)}`);
      }
    },

    async playFile(relPath) {
      if (get().operationId !== null || get().starting) return;
      try {
        const text = await backend.readQuizFile(relPath);
        const parsed = parseQuizFile(text.content);
        // Citations resolve against the open folder, even for a file picked outside it.
        const notes = await checkSources(parsed, readSource);
        await get().play(recordFromFile(parsed, text.relPath ?? text.path), notes);
      } catch (err) {
        if (err instanceof BackendError && err.code === 'SaveCancelled') return;
        useToasts.getState().notify('error', `Cannot play that quiz: ${errorMessage(err)}`);
      }
    },

    async refreshQuizFiles() {
      try {
        set({ quizFiles: await backend.listQuizFiles() });
      } catch {
        set({ quizFiles: [] });
      }
    },

    leaveFolder() {
      const { operationId } = get();
      if (operationId !== null) void backend.aiCancel(operationId).catch(() => undefined);
      run = null;
      set({
        screen: 'home',
        setup: setupFromSettings(),
        estimate: null,
        pending: null,
        operationId: null,
        starting: false,
        buffered: [],
        generation: null,
        failure: null,
        record: null,
        engine: null,
        saved: null,
        history: [],
        quizFiles: [],
        sourceNotes: {},
      });
    },
  };
});

export const selectQuizBusy = (s: QuizState) => s.operationId !== null || s.starting;
