/**
 * The mock of Save results… / Save quiz… (`learning/save.rs`, `learning/quiz/file.rs`): the same
 * file name cleanup and the same front matter check.
 */
import type { QuizCategory, QuizSaveKind } from '../types';

const categoryOf = (v: string | null): QuizCategory | null =>
  v === 'global' || v === 'feature' || v === 'code' || v === 'tutorial' ? v : null;

export interface SavedMarkdown {
  kind: QuizSaveKind;
  relPath: string;
  markdown: string;
}

/** The front matter of `text` (between the leading `---` and the next `---`), if any. */
export function frontMatter(text: string): string | null {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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

/** What the graph keeps of a quiz file (Rust `QuizFileInfo`). */
export interface QuizFileInfo {
  title: string | null;
  subject: string | null;
  generated: string | null;
  questions: number;
  category: QuizCategory | null;
  role: string | null;
}

/** A top-level scalar of the front matter: plain, single- or double-quoted (Rust `field`). */
function field(fm: string, key: string): string | null {
  let value: string | null = null;
  for (const line of fm.split('\n')) {
    const colon = line.indexOf(':');
    if (colon >= 0 && line.slice(0, colon) === key) {
      value = line.slice(colon + 1).trim();
      break;
    }
  }
  if (value === null) return null;
  if (!value.startsWith('"') && !value.startsWith("'")) {
    const comment = value.indexOf(' #');
    if (comment >= 0) value = value.slice(0, comment).trimEnd();
  }
  let text = value;
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      text = JSON.parse(value) as string;
    } catch {
      text = value.slice(1, -1);
    }
  } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    text = value.slice(1, -1).replace(/''/g, "'");
  }
  return text === '' ? null : text;
}

/** The summary of a quiz file, or null when `text` is not one (Rust `info`). */
export function quizInfo(text: string): QuizFileInfo | null {
  if (!isQuizMarkdown(text)) return null;
  const fm = frontMatter(text) ?? '';
  const questions = text.split('\n').filter((l) => /^\s*(```|~~~)igrasp-quiz/.test(l)).length;
  return {
    title: field(fm, 'title'),
    subject: field(fm, 'subject'),
    generated: field(fm, 'generated'),
    category: categoryOf(field(fm, 'category')),
    role: field(fm, 'role'),
    questions,
  };
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
