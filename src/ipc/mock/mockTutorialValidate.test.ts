// The mock's tutorial validator on the fixtures `cargo test` runs through the Rust validator:
// both must accept and reject the same chapters and steps for the same reasons.

import { describe, expect, it } from 'vitest';
import type { Length } from '../types';
import { buildQuizCorpus, isSecret, textLines } from './mockQuizValidate';
import { validateChapter, validateOutline } from './mockTutorialValidate';
import corpusFixture from '../../test/fixtures/quiz/corpus.json';

interface Case {
  description: string;
  kind: 'outline' | 'chapter';
  length: Length;
  output: unknown;
  expected: {
    shapeError?: boolean;
    accepted?: string[];
    rejected?: Record<string, string>;
    minutes?: number[];
  };
}

const CASES = import.meta.glob<Case>('../../test/fixtures/tutorial/cases/*.json', {
  eager: true,
  import: 'default',
});

function corpus() {
  const files = corpusFixture.files as {
    path: string;
    content?: string;
    lines?: number;
    binary?: boolean;
    agent?: boolean;
  }[];
  return buildQuizCorpus(
    files
      .filter((f) => !isSecret(f.path))
      .map((f) => ({
        file: {
          path: f.path,
          binary: f.binary ?? false,
          markdown: /\.(?:md|markdown)$/i.test(f.path),
          lines:
            f.content !== undefined
              ? textLines(f.content)
              : Array.from({ length: f.lines ?? 0 }, (_, i) => `filler ${String(i + 1)}`),
        },
        agent: f.agent ?? false,
      })),
    { type: 'wholeProject' },
  );
}

const label = (id: string) => id.split(' (')[0] ?? id;

describe('the mock tutorial validator on the shared fixtures', () => {
  it('finds the cases', () => {
    expect(Object.keys(CASES).length).toBeGreaterThanOrEqual(4);
  });

  for (const [file, c] of Object.entries(CASES)) {
    it(`${file.split('/').pop() ?? file}: ${c.description}`, () => {
      const ctx = {
        corpus: corpus(),
        agentNames: corpusFixture.agentNames,
        projectName: corpusFixture.name,
        modules: corpusFixture.modules,
        length: c.length,
      };
      if (c.kind === 'outline') {
        const v = validateOutline(c.output, ctx);
        if (c.expected.shapeError) {
          expect(v.ok).toBe(false);
          return;
        }
        if (!v.ok) throw new Error(v.error);
        expect(v.value.accepted.map((ch) => ch.title)).toEqual(c.expected.accepted ?? []);
        if (c.expected.minutes)
          expect(v.value.accepted.map((ch) => ch.minutes)).toEqual(c.expected.minutes);
        expect(Object.fromEntries(v.value.rejected.map((r) => [label(r.id), r.rejection]))).toEqual(
          c.expected.rejected ?? {},
        );
      } else {
        const v = validateChapter(c.output, ctx);
        if (c.expected.shapeError) {
          expect(v.ok).toBe(false);
          return;
        }
        if (!v.ok) throw new Error(v.error);
        expect(v.value.accepted.map((s) => s.type)).toEqual(c.expected.accepted ?? []);
        expect(Object.fromEntries(v.value.rejected.map((r) => [label(r.id), r.rejection]))).toEqual(
          c.expected.rejected ?? {},
        );
        // The accepted steps carry no self-check and normalized paths.
        for (const s of v.value.accepted) expect(s).not.toHaveProperty('selfCheck');
      }
    });
  }
});
