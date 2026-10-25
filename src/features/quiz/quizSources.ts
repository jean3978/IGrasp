// The sources of a question: how they read and how they open.

import type { QuizQuestion, QuizSource } from '../../ipc/types';
import { openSourceFile } from '../../stores/tabs';

/** `src/a.rs:12-30`, `src/a.rs:12` or the path alone. */
export function sourceLabel(s: QuizSource): string {
  if (s.firstLine === null) return s.path;
  if (s.lastLine === null || s.lastLine === s.firstLine) return `${s.path}:${String(s.firstLine)}`;
  return `${s.path}:${String(s.firstLine)}-${String(s.lastLine)}`;
}

/** Opens a source where it reads best: the preview for markdown, the code viewer at its lines. */
export function openSource(s: QuizSource) {
  if (s.kind === 'binary') return;
  openSourceFile(s.path, s.firstLine ?? undefined, s.lastLine ?? undefined);
}

/** The files a question cites that can be read as text, once each, in citation order. */
export function lookUpSources(question: QuizQuestion): QuizSource[] {
  const seen = new Set<string>();
  return question.sources.filter((s) => {
    if (s.kind === 'binary' || seen.has(s.path)) return false;
    seen.add(s.path);
    return true;
  });
}
