import { describe, expect, it } from 'vitest';
import type { QuizQuestion, QuizRecord, QuizSource } from '../../ipc/types';
import { sha256Hex } from '../../lib/sha256';
import {
  checkSources,
  hashSources,
  parseQuizFile,
  quizFileMarkdown,
  quizFileName,
  recordFromFile,
} from './quizFile';
import type { ReadSource } from './quizFile';

const disk: Record<string, string> = {
  'src/main.ts': "// Entry\r\nimport { greet } from './greet';\nconst a = 1;\nconst b = 2;\n",
  'docs/architecture.md': '# Architecture\n\nThe app has two parts.\n',
};
const read: ReadSource = (relPath) => {
  const content = disk[relPath];
  return Promise.resolve(content === undefined ? null : { content, truncated: false });
};

const code: QuizSource = {
  path: 'src/main.ts',
  firstLine: 2,
  lastLine: 3,
  why: 'the import',
  kind: 'code',
};
const doc: QuizSource = {
  path: 'docs/architecture.md',
  firstLine: 3,
  lastLine: 3,
  why: null,
  kind: 'markdown',
};

const questions: QuizQuestion[] = [
  {
    id: 'r1-q1',
    kind: 'multipleChoice',
    question: 'Which helper does src/main.ts import:\nfrom where?',
    choices: ['greet', 'main: the entry', '`Options`'],
    answer: 0,
    hint: 'Line 2.',
    explanation: "src/main.ts imports greet from './greet'.\n\nIt is the only import.",
    sources: [code, doc],
    difficulty: 2,
  },
  {
    id: 'r1-q2',
    kind: 'trueFalse',
    question: 'The architecture page describes two parts.',
    choices: ['True', 'False'],
    answer: 0,
    hint: '',
    explanation: 'docs/architecture.md says so.',
    sources: [doc],
    difficulty: 1,
  },
];

const record: QuizRecord = {
  id: 'quiz-abc',
  startedMs: Date.UTC(2026, 9, 24, 14, 2),
  finishedMs: null,
  providerId: 'mock',
  model: 'mock-large',
  subject: 'arch',
  subjectTitle: 'How the app fits together',
  category: 'feature',
  role: 'Level designer',
  mode: 'adaptive',
  scope: { type: 'wholeProject' },
  origin: { type: 'generated' },
  count: 2,
  questions,
  answers: [],
  startLevel: 3,
  level: 4,
  score: 0,
  bestStreak: 0,
  usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.01 },
  durationMs: 1,
  attempts: 1,
  rounds: 1,
  resumeId: null,
  materialNote: null,
  docsNote: null,
  suggestedSubjects: [],
  tutorial: null,
};

async function written(): Promise<string> {
  return quizFileMarkdown(record, 'Demo', await hashSources(questions, read));
}

describe('quiz files', () => {
  it('writes the front matter with the hashes and one block per question', async () => {
    const md = await written();
    expect(md).toMatchSnapshot();
    expect(md).toContain(`sha256: ${sha256Hex("import { greet } from './greet';\nconst a = 1;")}`);
    expect(quizFileName(record)).toBe('quiz-how-the-app-fits-together.md');
  });

  it('reads back what it writes', async () => {
    const parsed = parseQuizFile(await written());
    expect(parsed.questions).toEqual(
      questions.map((q) => ({ ...q, question: q.question.replace('\n', ' ') })),
    );
    expect(parsed).toMatchObject({
      id: 'quiz-abc',
      subject: 'How the app fits together',
      level: 3,
      provider: 'mock',
      skipped: 0,
      category: 'feature',
      role: 'Level designer',
    });
    const played = recordFromFile(parsed, 'quizzes/q.md');
    expect(played.origin).toEqual({ type: 'file', path: 'quizzes/q.md' });
    expect(played).toMatchObject({ category: 'feature', role: 'Level designer' });
    expect(played.usage.costUsd).toBeNull();
    expect(played.startLevel).toBe(3);
    expect(await checkSources(parsed, read)).toEqual({});
  });

  it('keeps a fence quoted in an explanation inside its block', async () => {
    const quoting = {
      ...questions[1],
      explanation: 'Run this:\n```sh\nnpm test\n```',
    } as QuizQuestion;
    const md = quizFileMarkdown({ ...record, questions: [quoting] }, 'Demo', new Map());
    expect(md).toContain('````igrasp-quiz');
    expect(parseQuizFile(md).questions[0]?.explanation).toBe(quoting.explanation);
    expect(await checkSources(parseQuizFile(md), read)).toEqual({});
  });

  it('tolerates hand edits: a broken block is skipped and counted', () => {
    const text = [
      '---',
      'igrasp: quiz',
      'subject: Hand made',
      '---',
      '',
      '## 1) Plain heading question?',
      '',
      '~~~igrasp-quiz',
      'choices: [yes, no]',
      'answer: 1',
      'sources:',
      '  - path: /src/main.ts',
      '    lines: L2-L3',
      '~~~',
      '',
      '## 2. Broken',
      '',
      '```igrasp-quiz',
      'choices: [only one]',
      'answer: 0',
      '```',
      '',
      '## 3. Bad YAML',
      '',
      '```igrasp-quiz',
      'choices: [a, b',
      '```',
    ].join('\n');
    const parsed = parseQuizFile(text);
    expect(parsed.skipped).toBe(2);
    expect(parsed.questions).toEqual([
      {
        id: 'q1',
        kind: 'trueFalse',
        question: 'Plain heading question?',
        choices: ['yes', 'no'],
        answer: 1,
        hint: '',
        explanation: '',
        sources: [{ path: 'src/main.ts', firstLine: 2, lastLine: 3, why: null, kind: 'code' }],
        difficulty: 3,
      },
    ]);
    expect(recordFromFile(parsed, 'x.md').materialNote).toMatch(/2 questions .* were skipped/);
    expect(() => parseQuizFile('# Not a quiz\n')).toThrow(/not a quiz/);
    expect(() => parseQuizFile('---\nigrasp: quiz\n---\n# Empty\n')).toThrow(/no question/);
  });

  it('flags a changed range and a missing file, and leaves the rest alone', async () => {
    const parsed = parseQuizFile(await written());
    const later: ReadSource = (relPath) =>
      relPath === 'docs/architecture.md'
        ? Promise.resolve(null)
        : Promise.resolve({
            content: "// Entry\nimport { greet } from './hello';\nconst a = 1;\n",
            truncated: false,
          });
    expect(await checkSources(parsed, later)).toEqual({
      'r1-q1': [
        { path: 'src/main.ts', state: 'changed' },
        { path: 'docs/architecture.md', state: 'missing' },
      ],
      'r1-q2': [{ path: 'docs/architecture.md', state: 'missing' }],
    });
    // Lines past the end of the file changed too.
    const short: ReadSource = () => Promise.resolve({ content: 'one line', truncated: false });
    expect((await checkSources(parsed, short))['r1-q2']).toEqual([
      { path: 'docs/architecture.md', state: 'changed' },
    ]);
  });
});
