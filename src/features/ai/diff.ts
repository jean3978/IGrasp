// A line diff for the proposed-edit cards (non-markdown or outside-root edits), on `diffLines`
// from the `diff` package. The rendered markdown diff lives in src/features/diff.

import { diffLines } from 'diff';

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  // A trailing newline does not add an empty line.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function lineDiff(before: string, after: string): DiffLine[] {
  // Normalized so that line endings and a missing final newline never show as changes.
  const normalize = (text: string) => {
    const lines = splitLines(text);
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  };
  const out: DiffLine[] = [];
  for (const part of diffLines(normalize(before), normalize(after))) {
    const type = part.added ? 'add' : part.removed ? 'del' : 'same';
    for (const text of splitLines(part.value)) out.push({ type, text });
  }
  return out;
}

/** Number of added and removed lines. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === 'add') added++;
    else if (line.type === 'del') removed++;
  }
  return { added, removed };
}
