// Saved questions in the mock, like `learning/tutorial/question.rs`: the same checks, caps and
// messages; the question carries no author and no date.

import { BackendError } from '../types';
import type { StepQuestion, Tutorial, TutorialStepContext } from '../types';
import { normalizeTutorial, stepCitations, stepTitle } from '../../lib/tutorial';

export const MAX_QUESTION_CHARS = 1_000;
export const MAX_QUOTE_CHARS = 1_000;
export const MAX_ANSWER_CHARS = 20_000;
export const MAX_QUESTIONS_PER_CHAPTER = 50;

const refuse = (message: string) => new BackendError('Forbidden', message);
const count = (s: string) => Array.from(s).length;

export function withQuestion(t: Tutorial, chapter: number, question: StepQuestion): Tutorial {
  const next = structuredClone(t);
  const c = next.chapters[chapter];
  if (!c) throw refuse('This chapter does not exist.');
  if (question.step >= c.steps.length) throw refuse('This step does not exist.');
  if (c.questions.length >= MAX_QUESTIONS_PER_CHAPTER)
    throw refuse(
      `A chapter keeps at most ${String(MAX_QUESTIONS_PER_CHAPTER)} questions; remove one first.`,
    );
  const q = question.question.trim();
  const a = question.answer.trim();
  if (q === '' || a === '') throw refuse('A saved question needs its question and its answer.');
  if (
    count(q) > MAX_QUESTION_CHARS ||
    count(a) > MAX_ANSWER_CHARS ||
    (question.quote !== undefined && count(question.quote) > MAX_QUOTE_CHARS)
  )
    throw refuse('This question or its answer is too long to save.');
  c.questions.push(structuredClone(question));
  return normalizeTutorial(next);
}

export function withoutQuestion(t: Tutorial, chapter: number, index: number): Tutorial {
  const next = structuredClone(t);
  const c = next.chapters[chapter];
  if (!c) throw refuse('This chapter does not exist.');
  if (index >= c.questions.length) throw refuse('This question does not exist.');
  c.questions.splice(index, 1);
  return next;
}

/**
 * What a chat message about a step adds to its prompt and the files the step cites (Rust
 * `question::step_context`; the mock's step text is its title and citations).
 */
export function stepContext(
  t: Tutorial,
  ctx: TutorialStepContext,
  question: string,
): { prompt: string; paths: string[] } {
  const chapter = t.chapters[ctx.chapter];
  if (!chapter) throw refuse('This chapter does not exist.');
  const step = chapter.steps[ctx.step];
  if (!step) throw refuse('This step does not exist.');
  const quote = ctx.quote?.trim()
    ? `\nThey pointed at this part of the step:\n> ${Array.from(ctx.quote.trim()).slice(0, MAX_QUOTE_CHARS).join('').replace(/\n/g, '\n> ')}\n`
    : '';
  const prompt = `The user is taking the tutorial "${t.title}" about the project ${t.project}: chapter ${String(ctx.chapter + 1)} "${chapter.title}", step ${String(ctx.step + 1)} of ${String(chapter.steps.length)}. The step reads:\n\n## ${stepTitle(step)}\n${quote}\nAnswer their question about this step in the terms of this project, citing its files (path and lines) when it helps; if the step itself is wrong or out of date, say so. Do not change any file.\n\nTheir question: ${question}`;
  const paths: string[] = [];
  for (const c of stepCitations(step)) if (!paths.includes(c.path)) paths.push(c.path);
  return { prompt, paths };
}
