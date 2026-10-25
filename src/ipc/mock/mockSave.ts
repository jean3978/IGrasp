/**
 * The mock of Save results… / Save quiz… (`learning/save.rs`, `learning/quiz/file.rs`): the same
 * file name cleanup and the same front matter check.
 */
import type { QuizSaveKind } from '../types';

export interface SavedMarkdown {
  kind: QuizSaveKind;
  relPath: string;
  markdown: string;
}

/** The front matter of `text` (between the leading `---` and the next `---`), if any. */
export function frontMatter(text: string): string | null {
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  const opening = body.startsWith('---\r\n') ? 5 : body.startsWith('---\n') ? 4 : 0;
  if (opening === 0) return null;
  const rest = body.slice(opening);
  let offset = 0;
  for (const line of rest.split(/(?<=\n)/)) {
    if (line.trimEnd() === '---') return rest.slice(0, offset);
    offset += line.length;
  }
  return null;
}

/** Whether `text` starts with a front matter that declares `igrasp: quiz`. */
export function isQuizMarkdown(text: string): boolean {
  const fm = frontMatter(text);
  if (fm === null) return false;
  return fm.split('\n').some((line) => {
    const colon = line.indexOf(':');
    if (colon < 0) return false;
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/^["']+|["']+$/g, '');
    return line.slice(0, colon).trim() === 'igrasp' && value === 'quiz';
  });
}

/** A file name for the dialog: no folders, no characters a file system refuses, `.md`. */
export function safeFileName(name: string): string {
  const last = name.split(/[/\\]/).pop() ?? name;
  const cleaned = Array.from(last)
    // eslint-disable-next-line no-control-regex
    .map((c) => (/[\u0000-\u001f\u007f<>:"|?*]/.test(c) ? '-' : c))
    .join('')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  const base = cleaned === '' ? 'quiz' : cleaned;
  return base.toLowerCase().endsWith('.md') ? base : `${base}.md`;
}
