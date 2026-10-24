// A small line diff for the proposed-edit cards (longest common subsequence). The proposed edits
// of the Edit tool are short snippets, so a quadratic diff is fine here; the Git phase will
// bring a real rendered markdown diff.

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
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;
  // lcs[i * (m + 1) + j] = length of the LCS of a[i..] and b[j..].
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  const at = (i: number, j: number) => lcs[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const left = a[i] ?? '';
    const right = b[j] ?? '';
    if (left === right) {
      out.push({ type: 'same', text: left });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ type: 'del', text: left });
      i++;
    } else {
      out.push({ type: 'add', text: right });
      j++;
    }
  }
  for (; i < n; i++) out.push({ type: 'del', text: a[i] ?? '' });
  for (; j < m; j++) out.push({ type: 'add', text: b[j] ?? '' });
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
