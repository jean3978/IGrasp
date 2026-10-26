// The reader's progress in a tutorial, pure (plan §4.10): which steps are done, the XP and the
// streak, the chapters completed, graduation, and the steps "updated since you read it". The
// rules are fixed (never tuned by the AI) and pinned by `src/test/fixtures/tutorial/xp.json`.

import type { Chapter, Step, StepAnswer, Tutorial, TutorialProgress } from '../../ipc/types';
import { stepHash, stepKey } from '../../lib/tutorial';

/** Points of a step read or done, by type (interactive steps follow `INTERACTIVE_XP`). */
export const READ_XP: Partial<Record<Step['type'], number>> = {
  explain: 5,
  conceptBridge: 5,
  diagram: 5,
  recap: 5,
  codeTour: 10,
  tryIt: 10,
};
/** Points of an interactive step: right at the first try without a hint, right after a hint or a
 * second try, or the explanation read after two wrong tries. */
export const INTERACTIVE_XP = { firstTry: 20, helped: 10, explained: 5 } as const;
export const CHAPTER_XP = 25;
/** From this streak of right interactive answers, a step's points are multiplied. */
export const STREAK_FROM = 3;
export const STREAK_BONUS = 1.5;

export const INTERACTIVE_TYPES: Step['type'][] = ['putInOrder', 'match', 'spotIt', 'quickCheck'];
export const isInteractive = (step: Step) => INTERACTIVE_TYPES.includes(step.type);

/** How a step was completed. */
export type StepOutcome =
  /** Read (explain, bridge, diagram, recap), a tour walked, a try-it done or skipped. */
  | { kind: 'read' }
  | { kind: 'skipped' }
  /** An interactive step: right or not, after how many tries, with a hint or not. */
  | { kind: 'answered'; right: boolean; tries: number; usedHint: boolean };

export function emptyProgress(tutorialId: string, now: number): TutorialProgress {
  return {
    tutorialId,
    startedMs: now,
    lastOpenedMs: now,
    finishedMs: null,
    chapter: 0,
    step: 0,
    completed: {},
    answers: {},
    xp: 0,
    streak: 0,
    bestStreak: 0,
    chaptersDone: [],
    graduated: false,
  };
}

/** The points of `step` completed with `outcome`, before the streak bonus. */
export function basePoints(step: Step, outcome: StepOutcome): number {
  if (outcome.kind === 'skipped') return 0;
  if (outcome.kind === 'read') return READ_XP[step.type] ?? 5;
  if (!outcome.right) return INTERACTIVE_XP.explained;
  return outcome.tries <= 1 && !outcome.usedHint ? INTERACTIVE_XP.firstTry : INTERACTIVE_XP.helped;
}

export interface Completion {
  progress: TutorialProgress;
  /** XP gained by this step (and its chapter, when it completed it). */
  gained: number;
  chapterDone: boolean;
  graduated: boolean;
  /** The streak reached a multiple of `STREAK_FROM` with this answer. */
  streakMilestone: boolean;
}

const written = (t: Tutorial) => t.chapters.filter((c) => c.steps.length > 0);

/** Whether every step of `chapter` is completed in `completed`. */
export const chapterComplete = (chapter: Chapter, completed: Record<string, string>) =>
  chapter.steps.every((_, i) => stepKey(chapter.id, i) in completed);

/**
 * Completes step `index` of chapter `chapterIndex`. A step completed again keeps its first points
 * (re-reading earns nothing) but takes the new hash, which clears its "updated" mark.
 */
export function completeStep(
  t: Tutorial,
  p: TutorialProgress,
  chapterIndex: number,
  index: number,
  outcome: StepOutcome,
  now: number,
): Completion {
  const chapter = t.chapters[chapterIndex];
  const step = chapter?.steps[index];
  if (!chapter || !step)
    return { progress: p, gained: 0, chapterDone: false, graduated: false, streakMilestone: false };
  const key = stepKey(chapter.id, index);
  const first = !(key in p.completed);
  let streak = p.streak;
  let gained = 0;
  let milestone = false;
  const answers: Record<string, StepAnswer> = { ...p.answers };
  if (outcome.kind === 'answered' && first) {
    const rightFirst = outcome.right && outcome.tries <= 1 && !outcome.usedHint;
    streak = rightFirst ? streak + 1 : 0;
    milestone = rightFirst && streak >= STREAK_FROM && streak % STREAK_FROM === 0;
    answers[key] = {
      right: outcome.right,
      firstTry: rightFirst,
      usedHint: outcome.usedHint,
      tries: outcome.tries,
    };
  }
  if (first) {
    const base = basePoints(step, outcome);
    const bonus = outcome.kind === 'answered' && streak >= STREAK_FROM ? STREAK_BONUS : 1;
    gained = Math.round(base * bonus);
  }
  const completed = { ...p.completed, [key]: stepHash(step) };
  const wasDone = p.chaptersDone.includes(chapter.id);
  const chapterDone = !wasDone && chapterComplete(chapter, completed);
  if (chapterDone) gained += CHAPTER_XP;
  const chaptersDone = chapterDone ? [...p.chaptersDone, chapter.id] : p.chaptersDone;
  const all = t.chapters.length > 0 && t.chapters.every((c) => c.steps.length > 0);
  const graduated = !p.graduated && all && written(t).every((c) => chaptersDone.includes(c.id));
  const nextPosition =
    index + 1 < chapter.steps.length
      ? { chapter: chapterIndex, step: index + 1 }
      : { chapter: chapterIndex, step: index };
  return {
    progress: {
      ...p,
      ...nextPosition,
      completed,
      answers,
      xp: p.xp + gained,
      streak,
      bestStreak: Math.max(p.bestStreak, streak),
      chaptersDone,
      graduated: p.graduated || graduated,
      finishedMs: graduated ? now : p.finishedMs,
      lastOpenedMs: now,
    },
    gained,
    chapterDone,
    graduated,
    streakMilestone: milestone,
  };
}

/** The steps completed before they changed: `"<chapter id>:<index>"` keys. */
export function updatedSince(t: Tutorial, p: TutorialProgress): Set<string> {
  const out = new Set<string>();
  for (const c of t.chapters)
    c.steps.forEach((s, i) => {
      const key = stepKey(c.id, i);
      const hash = p.completed[key];
      if (hash !== undefined && hash !== stepHash(s)) out.add(key);
    });
  return out;
}

export type ChapterState = 'locked' | 'unwritten' | 'current' | 'done' | 'open';

/**
 * Where each chapter stands on the course map: `done`, the `current` one (the first written
 * chapter not done), `open` (written, started or after a done one), `unwritten`, or `locked`
 * (written but not reached yet).
 */
export function chapterStates(t: Tutorial, p: TutorialProgress): ChapterState[] {
  let current = -1;
  return t.chapters.map((c, i) => {
    if (c.steps.length === 0) return 'unwritten';
    if (p.chaptersDone.includes(c.id)) return 'done';
    const started = c.steps.some((_, k) => stepKey(c.id, k) in p.completed);
    if (current < 0) {
      current = i;
      return 'current';
    }
    return started ? 'open' : 'locked';
  });
}

/** Steps done of a chapter. */
export const stepsDone = (c: Chapter, p: TutorialProgress) =>
  c.steps.filter((_, i) => stepKey(c.id, i) in p.completed).length;

/** How a chapter went, for its recap. */
export interface ChapterSummary {
  steps: number;
  /** Steps done, counting the recap on screen as done. */
  done: number;
  /** Interactive steps, and those answered right (at the first try). */
  interactive: number;
  right: number;
  firstTry: number;
  /** Steps other than the recap still to do, in order (the chapter is not done without them). */
  missing: number[];
  /** Already counted as done (its chapter bonus was earned before). */
  chapterDone: boolean;
}

/** The summary of `chapter` shown on its recap (step `recap`). */
export function chapterSummary(c: Chapter, p: TutorialProgress, recap: number): ChapterSummary {
  let interactive = 0;
  let right = 0;
  let firstTry = 0;
  const missing: number[] = [];
  c.steps.forEach((step, i) => {
    const key = stepKey(c.id, i);
    if (i !== recap && !(key in p.completed)) missing.push(i);
    if (!isInteractive(step)) return;
    interactive++;
    const answer = p.answers[key];
    if (answer?.right) right++;
    if (answer?.firstTry) firstTry++;
  });
  return {
    steps: c.steps.length,
    done: c.steps.length - missing.length,
    interactive,
    right,
    firstTry,
    missing,
    chapterDone: p.chaptersDone.includes(c.id),
  };
}

/** The first step of `chapter` not done yet (or 0). */
export function resumeStep(c: Chapter, p: TutorialProgress): number {
  const i = c.steps.findIndex((_, k) => !(stepKey(c.id, k) in p.completed));
  return i < 0 ? 0 : i;
}

/** A deterministic shuffle of `n` items (a put-in-order step must not show the answer first). */
export function shuffledOrder(n: number, seed: string): number[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  // Never the right order itself.
  if (n > 1 && order.every((v, i) => v === i)) order.reverse();
  return order;
}
