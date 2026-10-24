// Turning a permission request into a proposed markdown edit the user can review as a diff.

import type { JsonValue } from '../../ipc/types';
import type { PendingPermission } from '../../stores/claude';
import { lineDiff } from './diff';
import type { DiffLine } from './diff';

const str = (v: JsonValue | undefined) => (typeof v === 'string' ? v : null);
const obj = (v: JsonValue | undefined | null): Record<string, JsonValue> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null;

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

/** Shows `path` relative to the open folder when it is inside it. */
export function displayPath(path: string, root: string | null): string {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const file = norm(path);
  const base = root ? norm(root) : '';
  if (base && file.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return file.slice(base.length + 1);
  }
  return path;
}

export interface ProposedEdit {
  file: string;
  hunks: DiffLine[][];
  /** The content is new (Write): nothing to compare against yet. */
  whole: boolean;
}

/** The markdown edit a permission request proposes, if it is one. */
export function proposedEdit(p: PendingPermission): ProposedEdit | null {
  const input = obj(p.input);
  const file = str(input?.file_path);
  if (!input || !file || !isMarkdownPath(file)) return null;
  switch (p.toolName) {
    case 'Edit':
      return {
        file,
        hunks: [lineDiff(str(input.old_string) ?? '', str(input.new_string) ?? '')],
        whole: false,
      };
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return {
        file,
        hunks: edits.map((e) => {
          const edit = obj(e);
          return lineDiff(str(edit?.old_string) ?? '', str(edit?.new_string) ?? '');
        }),
        whole: false,
      };
    }
    case 'Write':
      return { file, hunks: [lineDiff('', str(input.content) ?? '')], whole: true };
    default:
      return null;
  }
}
