// The quiz engine: which question comes next, how the level moves, the streak and the score.
// Pure (no React, no store), so the order and the adaptation are tested on their own; the
// quiz store keeps an `EngineState` and calls these functions.

import type { QuizAnswer, QuizQuestion } from '../../ipc/types';

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;
/** Questions per round in adaptive mode (like `difficulty::ROUND_SIZE`). */
export const ROUND_SIZE = 5;
/** Right (or wrong) answers in a row that move the level by one. */
export const RUN_TO_MOVE = 2;

export interface EngineState {
  level: number;
  /** Right answers in a row (shown as the streak). */
  streak: number;
  bestStreak: number;
  score: number;
  /** Right and wrong answers since the level last moved. */
  rightRun: number;
  wrongRun: number;
  /** Ids of the questions asked so far, in order. */
  asked: string[];
  /** The question on screen, or null when none is left. */
  current: string | null;
  /** The answer of the current question once given. */
  chosen: number | null;
  usedHint: boolean;
  /** The cited files were opened ("Look it up") for the current question. */
  lookedUp: boolean;
}

export interface AnswerOutcome {
  state: EngineState;
  correct: boolean;
  /** -1, 0 or 1. */
  levelChange: number;
  answer: QuizAnswer;
}

const clampLevel = (l: number) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(l)));

export function initialEngine(startLevel: number): EngineState {
  return {
    level: clampLevel(startLevel),
    streak: 0,
    bestStreak: 0,
    score: 0,
    rightRun: 0,
    wrongRun: 0,
    asked: [],
    current: null,
    chosen: null,
    usedHint: false,
    lookedUp: false,
  };
}

/**
 * The unplayed question whose difficulty is nearest to `level`; ties go to the lower
 * difficulty, then to the original order.
 */
export function pickNext(
  questions: QuizQuestion[],
  asked: readonly string[],
  level: number,
): QuizQuestion | null {
  const played = new Set(asked);
  let best: QuizQuestion | null = null;
  let bestKey: [number, number] = [Infinity, Infinity];
  for (const q of questions) {
    if (played.has(q.id)) continue;
    const key: [number, number] = [Math.abs(q.difficulty - level), q.difficulty];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = q;
      bestKey = key;
    }
  }
  return best;
}

/** Moves to the next question (or to none when the pool is played). */
export function next(state: EngineState, questions: QuizQuestion[]): EngineState {
  const q = pickNext(questions, state.asked, state.level);
  return {
    ...state,
    current: q?.id ?? null,
    asked: q ? [...state.asked, q.id] : state.asked,
    chosen: null,
    usedHint: false,
    lookedUp: false,
  };
}

export function takeHint(state: EngineState): EngineState {
  return state.chosen === null ? { ...state, usedHint: true } : state;
}

/** "Look it up": recorded with the answer like the hint; the level ignores both. */
export function takeLook(state: EngineState): EngineState {
  return state.chosen === null ? { ...state, lookedUp: true } : state;
}

/**
 * Answers the current question with `choice`. Two right answers in a row raise the level by one
 * (at most 5), two wrong lower it by one (at least 1), and a wrong answer at level 5 lowers it
 * at once.
 */
export function answer(state: EngineState, question: QuizQuestion, choice: number): AnswerOutcome {
  const correct = choice === question.answer;
  let { level, rightRun, wrongRun } = state;
  const levelAt = level;
  if (correct) {
    rightRun += 1;
    wrongRun = 0;
    if (rightRun >= RUN_TO_MOVE && level < MAX_LEVEL) {
      level += 1;
      rightRun = 0;
    }
  } else {
    wrongRun += 1;
    rightRun = 0;
    if (level === MAX_LEVEL || (wrongRun >= RUN_TO_MOVE && level > MIN_LEVEL)) {
      level -= 1;
      wrongRun = 0;
    }
  }
  const streak = correct ? state.streak + 1 : 0;
  return {
    state: {
      ...state,
      level,
      rightRun,
      wrongRun,
      streak,
      bestStreak: Math.max(state.bestStreak, streak),
      score: state.score + (correct ? 1 : 0),
      chosen: choice,
    },
    correct,
    levelChange: Math.sign(level - levelAt),
    answer: {
      questionId: question.id,
      chosen: choice,
      correct,
      usedHint: state.usedHint,
      lookedUp: state.lookedUp,
      levelAt,
    },
  };
}

/**
 * The engine of a quiz restored from its answers (the Continue card): the answers are replayed
 * in order, then the next question is picked unless the last one is still unanswered.
 */
export function restoreEngine(
  startLevel: number,
  questions: QuizQuestion[],
  answers: QuizAnswer[],
): EngineState {
  let state = initialEngine(startLevel);
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) continue;
    state = {
      ...state,
      current: q.id,
      asked: [...state.asked, q.id],
      usedHint: a.usedHint,
      lookedUp: a.lookedUp,
    };
    state = answer(state, q, a.chosen).state;
  }
  return next(state, questions);
}

/** Rounds of an adaptive quiz of `count` questions. */
export const roundsOf = (count: number) => Math.max(1, Math.ceil(count / ROUND_SIZE));

/** Questions of round `number` (1-based) of a quiz of `count`. */
export const roundSize = (count: number, number: number) =>
  Math.max(0, Math.min(ROUND_SIZE, count - ROUND_SIZE * (number - 1)));

/**
 * A multiple choice question with its choices in a random order and its answer following, so
 * the right choice is never where the AI tends to put it (first). True/false keeps "True",
 * "False". Done once, when the questions arrive: the record keeps the order, replays reuse it.
 */
export function shuffleChoices(q: QuizQuestion, random: () => number = Math.random): QuizQuestion {
  if (q.kind !== 'multipleChoice') return q;
  const order = q.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const kept = order[i] ?? i;
    order[i] = order[j] ?? j;
    order[j] = kept;
  }
  return {
    ...q,
    choices: order.map((i) => q.choices[i] ?? ''),
    answer: order.indexOf(q.answer),
  };
}

/** The ids of a generation's questions, made unique across rounds: `r2-q1`. */
export function rekey(questions: QuizQuestion[], round: number): QuizQuestion[] {
  return questions.map((q) => ({ ...q, id: `r${String(round)}-${q.id}` }));
}
