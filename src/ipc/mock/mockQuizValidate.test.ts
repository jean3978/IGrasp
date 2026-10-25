// The mock's quiz validator on the fixtures `cargo test` runs through the Rust validator: both
// must accept and reject the same questions for the same reasons.

import { describe, expect, it } from 'vitest';
import type { QuizExclusion, SourceScope } from '../types';
import {
  STOP_WORDS,
  buildQuizCorpus,
  isAgentFile,
  isSecret,
  rejectionSummary,
  textLines,
  validateQuiz,
  words,
} from './mockQuizValidate';

interface FixtureFile {
  path: string;
  content?: string;
  lines?: number;
  binary?: boolean;
  agent?: boolean;
}
interface FixtureCorpus {
  name: string;
  modules: string[];
  agentNames: string[];
  files: FixtureFile[];
}
interface Case {
  description: string;
  scope?: SourceScope;
  count: number;
  exclude?: QuizExclusion[];
  output: unknown;
  expected: {
    shapeError?: boolean;
    accepted?: string[];
    rejected?: Record<string, string>;
    insufficient?: boolean;
  };
}

const corpusFixture = Object.values(
  import.meta.glob<FixtureCorpus>('/src/test/fixtures/quiz/corpus.json', {
    eager: true,
    import: 'default',
  }),
)[0];
const stopwords = Object.values(
  import.meta.glob<string[]>('/src/test/fixtures/quiz/stopwords.json', {
    eager: true,
    import: 'default',
  }),
)[0];
const cases = import.meta.glob<Case>('/src/test/fixtures/quiz/cases/*.json', {
  eager: true,
  import: 'default',
});

function linesOf(f: FixtureFile): string[] {
  if (f.content !== undefined) return textLines(f.content);
  return Array.from({ length: f.lines ?? 0 }, (_, i) => `filler ${String(i + 1)}`);
}

function run(c: Case) {
  if (!corpusFixture) throw new Error('no corpus fixture');
  const entries = corpusFixture.files
    .filter((f) => !isSecret(f.path))
    .map((f) => ({
      file: {
        path: f.path,
        binary: f.binary ?? false,
        markdown: /\.(?:md|markdown)$/i.test(f.path),
        lines: f.binary ? [] : linesOf(f),
      },
      agent: f.agent ?? false,
    }));
  const corpus = buildQuizCorpus(entries, c.scope ?? { type: 'wholeProject' });
  return validateQuiz(c.output, {
    corpus,
    agentNames: corpusFixture.agentNames,
    projectName: corpusFixture.name,
    modules: corpusFixture.modules,
    exclude: c.exclude ?? [],
    count: c.count,
  });
}

describe('the mock quiz validator on the shared fixtures', () => {
  it('finds the fixtures', () => {
    expect(Object.keys(cases).length).toBeGreaterThanOrEqual(6);
  });

  for (const [file, c] of Object.entries(cases)) {
    it(`${file.split('/').pop() ?? file}: ${c.description}`, () => {
      const result = run(c);
      if (c.expected.shapeError) {
        expect(result.ok).toBe(false);
        return;
      }
      if (!result.ok) throw new Error(`unexpected shape error: ${result.error}`);
      expect(result.value.accepted.map((q) => q.id)).toEqual(c.expected.accepted ?? []);
      expect(Object.fromEntries(result.value.rejected.map((r) => [r.id, r.rejection]))).toEqual(
        c.expected.rejected ?? {},
      );
      expect(result.value.insufficientMaterial).toBe(c.expected.insufficient ?? false);
    });
  }

  it('uses the shared stop words', () => {
    expect(STOP_WORDS).toEqual(stopwords);
  });

  it('agrees with Rust on words, agent files, secrets and the summary', () => {
    const w = words('The AiGateway::start() in src/ai/gateway.rs, line 120 of 2024!');
    expect(w.has('aigateway') && w.has('gateway')).toBe(true);
    expect(w.has('start') || w.has('2024') || w.has('line')).toBe(false);
    expect(isAgentFile('.cursor/rules/style.mdc', [])).toBe(true);
    expect(isAgentFile('docs/RULES.md', ['RULES.md'])).toBe(true);
    expect(isAgentFile('src/agents/brain.rs', [])).toBe(false);
    expect(isSecret('config/prod.env') && isSecret('id_ed25519.pub')).toBe(true);
    expect(isSecret('src/secretary.rs')).toBe(false);
    expect(
      rejectionSummary([
        { rejection: 'agentFile' },
        { rejection: 'generic' },
        { rejection: 'agentFile' },
      ]),
    ).toBe('3 rejected: 2 cited agent files, 1 was generic');
  });
});
