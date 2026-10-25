import { describe, expect, it } from 'vitest';
import type { QuizQuestion } from '../../ipc/types';
import {
  answer,
  initialEngine,
  next,
  pickNext,
  rekey,
  shuffleChoices,
  restoreEngine,
  roundSize,
  roundsOf,
  takeHint,
} from './quizEngine';
import type { EngineState } from './quizEngine';

const q = (id: string, difficulty: number, answerIndex = 0): QuizQuestion => ({
  id,
  kind: 'multipleChoice',
  question: `Question ${id}?`,
  choices: ['a', 'b', 'c'],
  answer: answerIndex,
  hint: 'h',
  explanation: 'e',
  sources: [],
  difficulty,
});

const pool = [q('a', 1), q('b', 2), q('c', 2), q('d', 3), q('e', 4), q('f', 5)];

function play(state: EngineState, questions: QuizQuestion[], right: boolean): EngineState {
  const current = questions.find((x) => x.id === state.current);
  if (!current) throw new Error('no question');
  return answer(state, current, right ? current.answer : current.answer + 1).state;
}

describe('the quiz engine', () => {
  it('picks the nearest difficulty, lower first, then the original order', () => {
    expect(pickNext(pool, [], 2)?.id).toBe('b');
    expect(pickNext(pool, ['b'], 2)?.id).toBe('c');
    expect(pickNext(pool, ['b', 'c'], 2)?.id).toBe('a');
    expect(pickNext(pool, ['a', 'b', 'c'], 2)?.id).toBe('d');
    expect(
      pickNext(
        pool,
        pool.map((x) => x.id),
        2,
      ),
    ).toBeNull();
  });

  it('raises the level after two right answers and lowers it after two wrong', () => {
    let s = next(initialEngine(2), pool);
    s = play(s, pool, true);
    expect(s.level).toBe(2);
    s = play(next(s, pool), pool, true);
    expect(s.level).toBe(3);
    expect(s.streak).toBe(2);
    s = play(next(s, pool), pool, false);
    expect(s.level).toBe(3);
    expect(s.streak).toBe(0);
    s = play(next(s, pool), pool, false);
    expect(s.level).toBe(2);
    expect(s.bestStreak).toBe(2);
    expect(s.score).toBe(2);
  });

  it('lowers the level at once after a wrong answer at level 5, and stays within 1-5', () => {
    const top = initialEngine(5);
    const out = answer({ ...top, current: 'f' }, q('f', 5), 2);
    expect(out.correct).toBe(false);
    expect(out.levelChange).toBe(-1);
    expect(out.state.level).toBe(4);
    let s: EngineState = { ...initialEngine(1), current: 'a' };
    s = answer(s, q('a', 1), 1).state;
    s = answer(s, q('a', 1), 1).state;
    expect(s.level).toBe(1);
    expect(initialEngine(9).level).toBe(5);
  });

  it('records the hint, the level at the answer and refuses a hint after answering', () => {
    let s = next(initialEngine(3), pool);
    s = takeHint(s);
    const current = pool.find((x) => x.id === s.current);
    if (!current) throw new Error('no question');
    const out = answer(s, current, current.answer);
    expect(out.answer).toEqual({
      questionId: current.id,
      chosen: current.answer,
      correct: true,
      usedHint: true,
      lookedUp: false,
      levelAt: 3,
    });
    expect(takeHint(out.state)).toBe(out.state);
    expect(next(out.state, pool).usedHint).toBe(false);
  });

  it('plays every question exactly once, whatever the answers', () => {
    for (let seed = 0; seed < 50; seed++) {
      let s = next(initialEngine(1 + (seed % 5)), pool);
      let rng = seed + 1;
      const seen: string[] = [];
      while (s.current !== null) {
        seen.push(s.current);
        rng = (rng * 16807) % 2147483647;
        s = next(play(s, pool, rng % 3 !== 0), pool);
      }
      expect([...seen].sort()).toEqual(pool.map((x) => x.id).sort());
    }
  });

  it('restores a quiz from its answers', () => {
    let s = next(initialEngine(2), pool);
    const answers = [];
    for (const right of [true, true, false]) {
      const current = pool.find((x) => x.id === s.current);
      if (!current) throw new Error('no question');
      const out = answer(s, current, right ? current.answer : 2);
      answers.push(out.answer);
      s = next(out.state, pool);
    }
    const restored = restoreEngine(2, pool, answers);
    expect(restored.level).toBe(s.level);
    expect(restored.score).toBe(2);
    expect(restored.asked.slice(0, 3)).toEqual(answers.map((a) => a.questionId));
    expect(restored.current).toBe(s.current);
  });

  it('counts the rounds and keys their questions apart', () => {
    expect(roundsOf(10)).toBe(2);
    expect(roundsOf(12)).toBe(3);
    expect(roundsOf(3)).toBe(1);
    expect(roundSize(12, 3)).toBe(2);
    expect(roundSize(12, 4)).toBe(0);
    expect(rekey([q('q1', 2)], 2)[0]?.id).toBe('r2-q1');
  });

  it('shuffles the choices of a multiple choice question, the answer following', () => {
    const base = {
      ...q('q1', 2),
      kind: 'multipleChoice' as const,
      choices: ['right', 'w1', 'w2', 'w3'],
      answer: 0,
    };
    // Every position is reached, and the answer always points at "right".
    const positions = new Set<number>();
    for (let n = 0; n < 200; n++) {
      const s = shuffleChoices(base);
      expect(s.choices[s.answer]).toBe('right');
      expect([...s.choices].sort()).toEqual(['right', 'w1', 'w2', 'w3']);
      positions.add(s.answer);
    }
    expect([...positions].sort()).toEqual([0, 1, 2, 3]);
    // A fixed random gives a fixed order; true/false keeps True, False.
    expect(shuffleChoices(base, () => 0).choices).toEqual(['w1', 'w2', 'w3', 'right']);
    const tf = { ...base, kind: 'trueFalse' as const, choices: ['True', 'False'], answer: 1 };
    expect(shuffleChoices(tf)).toBe(tf);
  });
});
