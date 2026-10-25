import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../client';
import type { QuizRecord } from '../types';
import { FIXTURE_ROOT } from './fixture';

const record = (id: string, finishedMs: number | null): QuizRecord => ({
  id,
  startedMs: 10,
  finishedMs,
  providerId: 'mock',
  model: 'mock-fast',
  subject: null,
  subjectTitle: `About ${id}`,
  category: null,
  role: null,
  mode: 'fixed',
  scope: { type: 'wholeProject' },
  origin: { type: 'generated' },
  count: 10,
  questions: [],
  answers: [],
  startLevel: 2,
  level: 2,
  score: 4,
  bestStreak: 2,
  usage: { inputTokens: 1, outputTokens: 1, costUsd: null },
  durationMs: 0,
  attempts: 1,
  rounds: 1,
  resumeId: null,
  materialNote: null,
  docsNote: null,
  suggestedSubjects: [],
});

beforeEach(async () => {
  window.__igraspMock?.reset();
  await backend.openRoot(FIXTURE_ROOT);
});

describe('mock quiz storage', () => {
  it('keeps the current quiz and moves a finished one to the history', async () => {
    expect(await backend.getCurrentQuiz()).toBeNull();
    await backend.saveCurrentQuiz(record('q-1', null));
    expect((await backend.getCurrentQuiz())?.id).toBe('q-1');
    await backend.saveCurrentQuiz(record('q-1', 100));
    expect(await backend.getCurrentQuiz()).toBeNull();
    const history = await backend.listQuizHistory();
    expect(history.map((h) => [h.id, h.subjectTitle, h.score])).toEqual([['q-1', 'About q-1', 4]]);
    expect((await backend.getQuizRecord('q-1')).model).toBe('mock-fast');
    await expect(backend.getQuizRecord('nope')).rejects.toThrow();
    for (let i = 0; i < 25; i++) await backend.saveCurrentQuiz(record(`h${String(i)}`, 200 + i));
    const trimmed = await backend.listQuizHistory();
    expect(trimmed).toHaveLength(20);
    expect(trimmed[0]?.id).toBe('h24');
    await backend.saveCurrentQuiz(record('c', null));
    await backend.clearCurrentQuiz();
    expect(await backend.getCurrentQuiz()).toBeNull();
    await backend.forgetQuizzes();
    expect(await backend.listQuizHistory()).toEqual([]);
    await expect(backend.saveCurrentQuiz(record('../x', null))).rejects.toThrow();
    expect(window.__igraspMock?.state.ai.starts).toEqual([]);
  });

  it('normalizes the learning settings like Rust', async () => {
    const s = await backend.updateSettings({
      learning: {
        quizQuestions: 99,
        quizMode: 'adaptive',
        quizzesFolder: ' docs\\quizzes/ ',
        quizResultsFolder: '../out',
      },
    });
    expect(s.learning).toEqual({
      quizQuestions: 30,
      quizMode: 'adaptive',
      quizScope: 'wholeProject',
      effects: true,
      quizResultsFolder: 'quiz-results',
      quizzesFolder: 'docs/quizzes',
    });
    expect(s.ai.historyLimit).toBe(100);
  });
});
