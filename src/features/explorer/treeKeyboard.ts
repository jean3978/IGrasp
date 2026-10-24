// Keyboard behavior of the file tree (WAI-ARIA tree pattern), as a pure function of the rows.

import type { TreeRow } from '../../stores/tree';

export type TreeCommand =
  | { type: 'focus'; path: string }
  | { type: 'expand'; path: string }
  | { type: 'collapse'; path: string }
  | { type: 'expandMany'; paths: string[] }
  | { type: 'open'; path: string; pin: boolean }
  | { type: 'none' };

const NONE: TreeCommand = { type: 'none' };

export function treeKeyCommand(
  key: string,
  rows: TreeRow[],
  focused: string | null,
  typeahead = '',
): TreeCommand {
  const real = rows.filter((r) => r.kind !== 'loading');
  if (real.length === 0) return NONE;
  const index = Math.max(
    0,
    real.findIndex((r) => r.path === focused),
  );
  const row = real[index];
  if (!row) return NONE;
  const focus = (r: TreeRow | undefined): TreeCommand =>
    r ? { type: 'focus', path: r.path } : NONE;

  if (focused === null || !real.some((r) => r.path === focused)) {
    // First key press: land on the first row.
    return focus(real[0]);
  }

  switch (key) {
    case 'ArrowDown':
      return focus(real[index + 1]);
    case 'ArrowUp':
      return focus(real[index - 1]);
    case 'Home':
      return focus(real[0]);
    case 'End':
      return focus(real[real.length - 1]);
    case 'ArrowRight':
      if (row.kind !== 'dir') return NONE;
      if (!row.expanded) return { type: 'expand', path: row.path };
      return real[index + 1]?.parent === row.path ? focus(real[index + 1]) : NONE;
    case 'ArrowLeft':
      if (row.kind === 'dir' && row.expanded) return { type: 'collapse', path: row.path };
      return row.parent === '' ? NONE : { type: 'focus', path: row.parent };
    case 'Enter':
      if (row.kind === 'dir') {
        return row.expanded
          ? { type: 'collapse', path: row.path }
          : { type: 'expand', path: row.path };
      }
      return { type: 'open', path: row.path, pin: true };
    case ' ':
      if (row.kind === 'dir') {
        return row.expanded
          ? { type: 'collapse', path: row.path }
          : { type: 'expand', path: row.path };
      }
      return { type: 'open', path: row.path, pin: false };
    case '*': {
      const siblings = real.filter(
        (r) => r.kind === 'dir' && r.parent === row.parent && !r.expanded,
      );
      return { type: 'expandMany', paths: siblings.map((r) => r.path) };
    }
    default:
      break;
  }

  if (typeahead !== '') {
    const needle = typeahead.toLowerCase();
    // Search after the current row first, then wrap; a repeated single letter cycles.
    const ordered = [...real.slice(index + 1), ...real.slice(0, index + 1)];
    const match = ordered.find((r) => r.name.toLowerCase().startsWith(needle));
    if (match) return focus(match);
  }
  return NONE;
}

/** DOM id of a tree row, stable for a given path. */
export function rowId(path: string): string {
  return `tree-item-${path.replace(/[^a-zA-Z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;
}
