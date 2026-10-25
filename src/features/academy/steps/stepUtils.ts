// Helpers of the step components (kept apart so the components' files export components only).

import type { Citation, QuickCheckStep, QuizQuestion } from '../../../ipc/types';
import { citationLines } from '../../../lib/tutorial';
import { openSourceFile } from '../../../stores/tabs';

/** Wrong tries allowed before an interactive step shows its answer. */
export const MAX_TRIES = 2;

/** A quick check as the quiz's question (the quiz's card renders it). */
export function asQuestion(step: QuickCheckStep, key: string): QuizQuestion {
  return {
    id: key,
    kind: step.kind,
    question: step.question,
    choices: step.choices,
    answer: step.answer,
    hint: step.hint,
    explanation: step.explanation,
    sources: step.sources.map((c) => ({
      path: c.path,
      firstLine: c.firstLine ?? null,
      lastLine: c.lastLine ?? null,
      why: c.why ?? null,
      kind: /\.(?:md|markdown)$/i.test(c.path)
        ? 'markdown'
        : c.firstLine === undefined
          ? 'binary'
          : 'code',
    })),
    difficulty: 2,
  };
}

/** `pairs` without the keys in `drop`. */
export const withoutKeys = (pairs: Record<number, number>, drop: Iterable<number>) => {
  const gone = new Set(drop);
  return Object.fromEntries(Object.entries(pairs).filter(([k]) => !gone.has(Number(k)))) as Record<
    number,
    number
  >;
};

/** `src/a.rs:12-30`, `src/a.rs:12` or the path alone. */
export const citationLabel = (c: Citation) => {
  const lines = citationLines(c);
  return lines ? `${c.path}:${lines}` : c.path;
};

/** Opens a cited file where it reads best (the preview for markdown, the code viewer at its lines). */
export function openCitation(c: Citation) {
  if (
    c.firstLine === undefined &&
    c.lastLine === undefined &&
    !/\.(?:md|markdown)$/i.test(c.path)
  ) {
    // A binary asset cited by name: nothing to read here.
    return;
  }
  openSourceFile(c.path, c.firstLine, c.lastLine);
}

/** How a cited source differs from when the tutorial was written. */
export type SourceStatus = 'changed' | 'missing';
