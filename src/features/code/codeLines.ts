// Helpers of the code viewer.

/** Above these, the file is shown as plain text (still virtualized). */
export const MAX_HIGHLIGHT_BYTES = 300 * 1024;
export const MAX_HIGHLIGHT_LINES = 5000;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Splits file content into lines; a final newline does not start an extra empty line. */
export function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export interface LineRange {
  start: number;
  end: number;
}

/** Parses `L10`, `L10-L20` or `L10-20` (a link fragment without `#`; 1-based, ordered). */
export function parseLineFragment(fragment: string | null | undefined): LineRange | null {
  const match = /^L(\d+)(?:-L?(\d+))?$/i.exec(fragment ?? '');
  if (!match?.[1]) return null;
  const a = Number(match[1]);
  const b = match[2] ? Number(match[2]) : a;
  if (a < 1 || b < 1) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}
