// The results of a quiz as markdown (Save results…): a front matter, a summary table, then each
// question in the order played with the choices as a task list (`[x]` your answer, ✓ the right
// one), the explanation and the sources. Links are root-absolute (`/src/x.ts#L3-L8`): they work
// wherever the user saves the file inside the folder, in IGrasp and on GitHub.

import type { QuizQuestion, QuizRecord, QuizSource } from '../../ipc/types';
import { formatElapsed } from './quizFormat';

/** A YAML scalar that stays a string whatever it contains (JSON strings are valid YAML). */
const yamlString = (s: string) => JSON.stringify(s);

/** One line of text (a question or a choice never breaks the list it is in). */
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

/** `|` would end a table cell. */
const cell = (s: string) => oneLine(s).replace(/\|/g, '\\|');

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-10-25` and `14:05`, in local time. */
function dateParts(ms: number): { day: string; time: string } {
  const d = new Date(ms);
  return {
    day: `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** A file name safe on every system: lowercase letters, digits and dashes. */
export function slug(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === '' ? 'project' : s.slice(0, 60);
}

/** `quiz-results-<project>-<YYYY-MM-DD>-<HHmm>.md`. */
export function resultsFileName(project: string, ms: number): string {
  const { day, time } = dateParts(ms);
  return `quiz-results-${slug(project)}-${day}-${time.replace(':', '')}.md`;
}

function lineRange(s: QuizSource): string {
  if (s.firstLine === null) return '';
  return s.lastLine !== null && s.lastLine !== s.firstLine
    ? `${String(s.firstLine)}-${String(s.lastLine)}`
    : String(s.firstLine);
}

/** A link to the cited lines; a markdown file opens at its top (`#L…` would be a heading). */
export function sourceLink(s: QuizSource): string {
  const range = lineRange(s);
  const label = range === '' ? s.path : `${s.path}:${range}`;
  if (s.kind === 'binary') return `\`${s.path}\``;
  const href = encodeURI(`/${s.path}`);
  const fragment = s.kind === 'markdown' || range === '' ? '' : `#L${range.replace('-', '-L')}`;
  return `[${label.replace(/[[\]]/g, '\\$&')}](${href}${fragment})`;
}

function questionSection(
  n: number,
  q: QuizQuestion,
  chosen: number,
  correct: boolean,
  usedHint: boolean,
): string {
  const choices = q.choices
    .map((c, i) => `- [${i === chosen ? 'x' : ' '}] ${oneLine(c)}${i === q.answer ? ' ✓' : ''}`)
    .join('\n');
  const verdict = `${correct ? '**Right**' : '**Missed**'}${usedHint ? ' · with the hint' : ''}`;
  const sources = q.sources.map((s) => {
    const why = s.why ? ` — ${oneLine(s.why)}` : '';
    return `- ${sourceLink(s)}${why}`;
  });
  return [
    `## ${String(n)}. ${oneLine(q.question)}`,
    '',
    choices,
    '',
    verdict,
    '',
    q.explanation.trim(),
    '',
    'Sources:',
    '',
    ...sources,
  ].join('\n');
}

/** The markdown of a finished (or stopped) quiz, `project` being the folder's name. */
export function resultsMarkdown(record: QuizRecord, project: string): string {
  const { day, time } = dateParts(record.finishedMs ?? record.startedMs);
  const answered = record.answers.length;
  const hints = record.answers.filter((a) => a.usedHint).length;
  const title = `${project} — ${record.subjectTitle}`;
  const front = [
    '---',
    `title: ${yamlString(title)}`,
    `project: ${yamlString(project)}`,
    `subject: ${yamlString(record.subjectTitle)}`,
    `date: ${yamlString(`${day} ${time}`)}`,
    `provider: ${yamlString(record.providerId)}`,
    `model: ${yamlString(record.model)}`,
    `mode: ${record.mode}`,
    `score: ${String(record.score)}`,
    `level: ${String(record.level)}`,
    `questions: ${String(answered)}`,
    '---',
  ];
  const elapsed = (record.finishedMs ?? record.startedMs) - record.startedMs;
  const ai =
    record.origin.type === 'generated'
      ? `${cell(record.model || record.providerId)}${
          record.usage.costUsd !== null ? ` · $${record.usage.costUsd.toFixed(2)}` : ''
        }`
      : 'none (replayed)';
  const table = [
    '| Score | Level reached | Best streak | Hints | Time | AI |',
    '|---|---|---|---|---|---|',
    `| ${String(record.score)}/${String(answered)} | ${String(record.level)}/5 | ${String(
      record.bestStreak,
    )} | ${String(hints)} | ${formatElapsed(elapsed)} | ${ai} |`,
  ];
  const sections = record.answers.flatMap((a, i) => {
    const q = record.questions.find((x) => x.id === a.questionId);
    return q ? [questionSection(i + 1, q, a.chosen, a.correct, a.usedHint)] : [];
  });
  const notes = record.materialNote ? ['', `> ${oneLine(record.materialNote)}`] : [];
  return `${[
    ...front,
    '',
    `# Quiz results: ${title}`,
    '',
    `${day} at ${time}, ${record.mode === 'adaptive' ? 'adaptive' : 'fixed'} mode.`,
    ...notes,
    '',
    ...table,
    '',
    sections.join('\n\n'),
  ].join('\n')}\n`;
}
