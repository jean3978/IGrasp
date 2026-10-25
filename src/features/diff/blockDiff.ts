// Block-level diff of two markdown documents: the blocks (blocks.ts) are compared by their
// normalized text. A run of removed and added blocks between two common blocks is one change
// group (a removed block followed by an added one is a `changed` group).

import { diffArrays } from 'diff';
import { blockLabel, splitBlocks, splitBlocksFrom } from './blocks';
import type { Block, BlockList } from './blocks';

export type GroupKind = 'same' | 'added' | 'removed' | 'changed';

export interface DiffGroup {
  kind: GroupKind;
  /** Blocks of the old document (empty for `added`). For `same`, the old twins of `newBlocks`. */
  oldBlocks: Block[];
  /** Blocks of the new document (empty for `removed`). */
  newBlocks: Block[];
  /** Index among the change groups (`kind !== 'same'`), or -1 for `same`. */
  changeIndex: number;
  /** "replaced paragraph", "added list", "removed table"... */
  label: string;
}

export interface BlockDiff {
  old: BlockList;
  new: BlockList;
  oldText: string;
  newText: string;
  /** Every group in document order. */
  groups: DiffGroup[];
  /** The groups that are not `same`, in order (`changes[i].changeIndex === i`). */
  changes: DiffGroup[];
}

function describe(kind: GroupKind, oldBlocks: Block[], newBlocks: Block[]): string {
  const side = kind === 'removed' ? oldBlocks : newBlocks;
  const first = side[0];
  const same = first !== undefined && side.every((b) => b.kind === first.kind);
  const noun = !first
    ? 'content'
    : same
      ? blockLabel(first.kind) + (side.length > 1 ? 's' : '')
      : `${side.length} blocks`;
  if (kind === 'added') return `added ${noun}`;
  if (kind === 'removed') return `removed ${noun}`;
  return `replaced ${noun}`;
}

export function blockDiff(oldText: string, newText: string): BlockDiff {
  const oldList = splitBlocks(oldText);
  // Only the changed region of the new text is parsed: parsing is most of the cost.
  const newList = splitBlocksFrom(oldText, oldList, newText);
  const parts = diffArrays(
    oldList.blocks.map((b) => b.key),
    newList.blocks.map((b) => b.key),
  );
  const groups: DiffGroup[] = [];
  const changes: DiffGroup[] = [];
  let o = 0;
  let n = 0;
  const push = (kind: GroupKind, oldBlocks: Block[], newBlocks: Block[]) => {
    const group: DiffGroup = {
      kind,
      oldBlocks,
      newBlocks,
      changeIndex: kind === 'same' ? -1 : changes.length,
      label: kind === 'same' ? 'unchanged' : describe(kind, oldBlocks, newBlocks),
    };
    groups.push(group);
    if (kind !== 'same') changes.push(group);
  };
  let removed: Block[] = [];
  let added: Block[] = [];
  const flush = () => {
    if (removed.length === 0 && added.length === 0) return;
    const kind: GroupKind =
      removed.length === 0 ? 'added' : added.length === 0 ? 'removed' : 'changed';
    push(kind, removed, added);
    removed = [];
    added = [];
  };
  for (const part of parts) {
    const count = part.value.length;
    if (part.removed) {
      removed = removed.concat(oldList.blocks.slice(o, o + count));
      o += count;
    } else if (part.added) {
      added = added.concat(newList.blocks.slice(n, n + count));
      n += count;
    } else {
      flush();
      push('same', oldList.blocks.slice(o, o + count), newList.blocks.slice(n, n + count));
      o += count;
      n += count;
    }
  }
  flush();
  return { old: oldList, new: newList, oldText, newText, groups, changes };
}

/** 1-based inclusive line range of a set of blocks, or null when empty. */
export function lineRange(blocks: Block[]): { startLine: number; endLine: number } | null {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  return first && last ? { startLine: first.startLine, endLine: last.endLine } : null;
}
