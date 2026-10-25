// The quiz in progress and the finished quizzes per folder, like `appdata/learning.rs`: a
// finished record moves to the history, newest first, at most 20; ids are checked.

import { BackendError } from '../types';
import type { QuizRecord, QuizSummary } from '../types';

export const MOCK_MAX_HISTORY = 20;

export interface FolderQuizzes {
  current: QuizRecord | null;
  history: QuizRecord[];
}

export const emptyQuizzes = (): FolderQuizzes => ({ current: null, history: [] });

const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

export function saveCurrent(folder: FolderQuizzes, record: QuizRecord): FolderQuizzes {
  if (!validId(record.id)) throw new BackendError('AppData', `invalid quiz id: "${record.id}"`);
  const copy = structuredClone(record);
  if (copy.finishedMs === null) return { ...folder, current: copy };
  const history = [copy, ...folder.history.filter((h) => h.id !== copy.id)]
    .sort((a, b) => (b.finishedMs ?? b.startedMs) - (a.finishedMs ?? a.startedMs))
    .slice(0, MOCK_MAX_HISTORY);
  return { current: folder.current?.id === copy.id ? null : folder.current, history };
}

export function summaryOf(r: QuizRecord): QuizSummary {
  return {
    id: r.id,
    finishedMs: r.finishedMs,
    subjectTitle: r.subjectTitle,
    origin: structuredClone(r.origin),
    model: r.model,
    questions: r.questions.length,
    answered: r.answers.length,
    score: r.score,
    level: r.level,
  };
}
