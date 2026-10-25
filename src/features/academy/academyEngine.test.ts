import { describe, expect, it } from 'vitest';
import xp from '../../test/fixtures/tutorial/xp.json';
import type { Step, Tutorial } from '../../ipc/types';
import {
  CHAPTER_XP,
  INTERACTIVE_XP,
  READ_XP,
  STREAK_BONUS,
  STREAK_FROM,
  chapterStates,
  completeStep,
  emptyProgress,
  resumeStep,
  shuffledOrder,
  updatedSince,
} from './academyEngine';
import type { StepOutcome } from './academyEngine';

const cite = [{ path: 'src/main.ts', firstLine: 1, lastLine: 2 }];
const steps: Step[] = [
  { type: 'explain', title: 'E', body: 'b', sources: cite },
  {
    type: 'quickCheck',
    kind: 'trueFalse',
    question: 'Q?',
    choices: ['True', 'False'],
    answer: 0,
    hint: 'h',
    explanation: 'e',
    sources: cite,
  },
  {
    type: 'spotIt',
    title: 'S',
    prompt: 'p',
    path: 'src/main.ts',
    firstLine: 1,
    lastLine: 4,
    answerLine: 2,
    explanation: 'e',
  },
  {
    type: 'putInOrder',
    title: 'P',
    prompt: 'p',
    items: ['a', 'b', 'c'],
    explanation: 'e',
    sources: cite,
  },
  {
    type: 'match',
    title: 'M',
    prompt: 'p',
    pairs: [
      { left: 'a', right: '1' },
      { left: 'b', right: '2' },
      { left: 'c', right: '3' },
    ],
    explanation: 'e',
    sources: cite,
  },
  { type: 'recap', takeaways: ['x', 'y', 'z'], sources: [] },
];

const tutorial = (chapters = 2): Tutorial => ({
  id: 't',
  title: 'T',
  intro: 'i',
  project: 'p',
  subject: 's',
  familiarity: 'newHere',
  length: 'quick',
  generated: '2026-10-25T00:00:00Z',
  provider: 'mock',
  model: 'm',
  chapters: Array.from({ length: chapters }, (_, i) => ({
    id: `c${String(i + 1)}`,
    title: `Chapter ${String(i + 1)}`,
    goal: 'g',
    minutes: 3,
    steps: i === 0 ? steps : [],
  })),
  sources: [],
});

describe('the XP rules (shared fixture)', () => {
  it('match the pinned values', () => {
    expect(READ_XP).toEqual(xp.read);
    expect(INTERACTIVE_XP).toEqual(xp.interactive);
    expect(CHAPTER_XP).toBe(xp.chapter);
    expect([STREAK_FROM, STREAK_BONUS]).toEqual([xp.streak.from, xp.streak.bonus]);
  });

  it('score a chapter, with the streak bonus and the chapter points', () => {
    const t = tutorial(1);
    let p = emptyProgress('t', 0);
    const gained: number[] = [];
    const streaks: number[] = [];
    let last = null;
    xp.sequence.outcomes.forEach((o, i) => {
      last = completeStep(t, p, 0, i, o as StepOutcome, 1);
      p = last.progress;
      gained.push(last.gained);
      streaks.push(p.streak);
    });
    expect(gained).toEqual(xp.sequence.gained);
    expect(streaks).toEqual(xp.sequence.streaks);
    expect(p.xp).toBe(xp.sequence.xp);
    expect(p.chaptersDone).toEqual(['c1']);
    expect(p.graduated).toBe(true);
    expect(p.bestStreak).toBe(3);
    expect(p.answers['c1:4']).toEqual({ right: false, firstTry: false, usedHint: true, tries: 2 });
  });
});

describe('progress', () => {
  it('gives the points once, and the map knows where the reader is', () => {
    const t = tutorial(2);
    let p = emptyProgress('t', 0);
    expect(chapterStates(t, p)).toEqual(['current', 'unwritten']);
    p = completeStep(t, p, 0, 0, { kind: 'read' }, 1).progress;
    const again = completeStep(t, p, 0, 0, { kind: 'read' }, 2);
    expect(again.gained).toBe(0);
    const first = t.chapters[0];
    if (!first) throw new Error('chapter');
    expect(resumeStep(first, p)).toBe(1);
    for (let i = 1; i < steps.length; i++)
      p = completeStep(
        t,
        p,
        0,
        i,
        { kind: 'answered', right: true, tries: 1, usedHint: false },
        3,
      ).progress;
    expect(chapterStates(t, p)).toEqual(['done', 'unwritten']);
    expect(p.graduated).toBe(false);
  });

  it('marks the steps that changed since they were read, not the moved ones', () => {
    const t = tutorial(1);
    let p = emptyProgress('t', 0);
    p = completeStep(t, p, 0, 0, { kind: 'read' }, 1).progress;
    p = completeStep(
      t,
      p,
      0,
      2,
      { kind: 'answered', right: true, tries: 1, usedHint: false },
      1,
    ).progress;
    const changed = structuredClone(t);
    const c = changed.chapters[0];
    if (!c) throw new Error('chapter');
    c.steps[0] = { type: 'explain', title: 'E', body: 'new body', sources: cite };
    const spot = c.steps[2];
    if (spot?.type === 'spotIt') {
      spot.firstLine += 10;
      spot.lastLine += 10;
      spot.answerLine += 10;
    }
    expect([...updatedSince(changed, p)]).toEqual(['c1:0']);
    // Reading it again clears the mark.
    p = completeStep(changed, p, 0, 0, { kind: 'read' }, 2).progress;
    expect(updatedSince(changed, p).size).toBe(0);
  });

  it('shuffles deterministically and never in the right order', () => {
    expect(shuffledOrder(4, 'a')).toEqual(shuffledOrder(4, 'a'));
    for (const seed of ['a', 'b', 'c', 'd', 'e'])
      expect(shuffledOrder(3, seed)).not.toEqual([0, 1, 2]);
    expect([...shuffledOrder(5, 'x')].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});
