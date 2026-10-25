import { describe, expect, it } from 'vitest';
import type { QuizQuestion, QuizRecord, QuizSource } from '../../ipc/types';
import { classifyHref } from '../../lib/linkTargets';
import { resultsFileName, resultsMarkdown, sourceLink } from './quizMarkdown';

const mainSource: QuizSource = {
  path: 'src/main.ts',
  firstLine: 2,
  lastLine: 4,
  why: 'the import',
  kind: 'code',
};
const docSource: QuizSource = {
  path: 'docs/architecture.md',
  firstLine: 10,
  lastLine: 12,
  why: null,
  kind: 'markdown',
};
const logoSource: QuizSource = {
  path: 'assets/logo bin.png',
  firstLine: null,
  lastLine: null,
  why: null,
  kind: 'binary',
};

const started = new Date(2026, 9, 25, 14, 5).getTime();

const questions: QuizQuestion[] = [
  {
    id: 'r1-q1',
    kind: 'multipleChoice',
    question: 'Which helper does src/main.ts import to build its message?',
    choices: ['greet', 'main', 'Options | flags'],
    answer: 0,
    hint: 'The second line of the entry point.',
    explanation: "src/main.ts imports greet from './greet'.",
    sources: [mainSource, docSource],
    difficulty: 2,
  },
  {
    id: 'r1-q2',
    kind: 'trueFalse',
    question: 'The logo is stored as a binary asset.',
    choices: ['True', 'False'],
    answer: 0,
    hint: 'Look under assets/.',
    explanation: 'assets/logo bin.png is a binary file.',
    sources: [
      logoSource,
      { path: 'src/greet.ts', firstLine: 7, lastLine: 7, why: null, kind: 'code' },
    ],
    difficulty: 3,
  },
];

const record: QuizRecord = {
  id: 'quiz-1',
  startedMs: started,
  finishedMs: started + 95_000,
  providerId: 'mock',
  model: 'mock-large',
  subject: null,
  subjectTitle: 'The whole project',
  mode: 'fixed',
  scope: { type: 'wholeProject' },
  origin: { type: 'generated' },
  count: 2,
  questions,
  answers: [
    { questionId: 'r1-q1', chosen: 1, correct: false, usedHint: true, levelAt: 2 },
    { questionId: 'r1-q2', chosen: 0, correct: true, usedHint: false, levelAt: 2 },
  ],
  startLevel: 2,
  level: 2,
  score: 1,
  bestStreak: 1,
  usage: { inputTokens: 1200, outputTokens: 800, costUsd: 0.0412 },
  durationMs: 4000,
  attempts: 1,
  rounds: 1,
  resumeId: null,
  materialNote: null,
  suggestedSubjects: [],
};

describe('resultsMarkdown', () => {
  it('writes the front matter, the table and each question with its sources', () => {
    expect(resultsMarkdown(record, 'Fixture "app"')).toMatchSnapshot();
  });

  it('says a replay used no AI', () => {
    const md = resultsMarkdown({ ...record, origin: { type: 'replay', of: 'x' } }, 'p');
    expect(md).toContain('| none (replayed) |');
  });

  it('links that the preview resolves to the cited file and lines, from any folder', () => {
    const link = sourceLink(mainSource);
    expect(link).toBe('[src/main.ts:2-4](/src/main.ts#L2-L4)');
    const href = /\]\((.*)\)/.exec(link)?.[1];
    expect(classifyHref('quiz-results/deep/r.md', href)).toEqual({
      kind: 'file',
      relPath: 'src/main.ts',
      fragment: 'L2-L4',
    });
    expect(sourceLink(logoSource)).toBe('`assets/logo bin.png`');
    expect(sourceLink(docSource)).toBe('[docs/architecture.md:10-12](/docs/architecture.md)');
  });

  it('suggests a dated file name', () => {
    expect(resultsFileName('My Game (2D)', started)).toBe(
      'quiz-results-my-game-2d-2026-10-25-1405.md',
    );
  });
});
