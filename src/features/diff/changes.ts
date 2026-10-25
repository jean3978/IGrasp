// Change units of a review: how the edits an agent proposes map to the change groups of the block
// diff (blockDiff.ts), and how the accepted ones compose into the final content.
//
// - Edit / MultiEdit: `buildEditReview(old, hunks)`. One unit per hunk; hunks that touch the same
//   change group merge into one unit ("2 edits in this paragraph"). The result of the accepted
//   units is `acceptedHunks(...)`.
// - Write: `buildWriteReview(old, new)`. One unit per change group. The result of the accepted
//   units is `composeWrite(...)`.

import type { EditHunk } from '../../ipc/generated/EditHunk';
import { blockDiff } from './blockDiff';
import type { BlockDiff } from './blockDiff';
import { blockLabel } from './blocks';
import type { Block } from './blocks';

export interface ChangeUnit {
  /** Position in `review.units`. */
  id: number;
  /** Change-group indexes (`BlockDiff.changes`) this unit covers; empty for a cosmetic hunk. */
  groups: number[];
  /** Indexes of the hunks (Edit / MultiEdit); empty for a Write. */
  hunks: number[];
  /** "replaced paragraph", "2 edits in this paragraph"... for the toolbar and `aria-label`. */
  label: string;
}

export interface LocatedHunk {
  index: number;
  hunk: EditHunk;
  /** False when the old text is not in the current content (or overlaps another hunk). */
  located: boolean;
  /** Offsets of the old text in the old content, and of the new text in the new content. */
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

export interface Review {
  diff: BlockDiff;
  units: ChangeUnit[];
  /** The content with every located hunk applied (the new content of a Write). */
  newText: string;
  /** Edit / MultiEdit only: the hunks, located or not. */
  hunks: LocatedHunk[];
  /** True when some hunk could not be located: the caller should fall back to a line diff. */
  hasUnlocated: boolean;
}

const lineOf = (text: string, offset: number): number => {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) line++;
  return line;
};

/** First and last line of a [start, end) range, ignoring trailing newlines. */
function lines(text: string, start: number, end: number): [number, number] {
  let last = end;
  while (last > start && (text[last - 1] === '\n' || text[last - 1] === '\r')) last--;
  return [lineOf(text, start), lineOf(text, Math.max(start, last - 1))];
}

/**
 * Locates every hunk in the old content (first occurrence, as the provider does) and applies the
 * located ones. Hunks are located in the original content: a hunk that only exists after an
 * earlier hunk of the same MultiEdit is reported as not located.
 */
export function resolveHunks(
  oldText: string,
  hunks: readonly EditHunk[],
): { hunks: LocatedHunk[]; newText: string } {
  const located: LocatedHunk[] = hunks.map((hunk, index) => {
    const at = hunk.oldText === '' ? oldText.length : oldText.indexOf(hunk.oldText);
    return {
      index,
      hunk,
      located: at >= 0,
      oldStart: Math.max(at, 0),
      oldEnd: Math.max(at, 0) + hunk.oldText.length,
      newStart: 0,
      newEnd: 0,
    };
  });
  const order = located.filter((h) => h.located).sort((a, b) => a.oldStart - b.oldStart);
  let out = '';
  let cursor = 0;
  for (const h of order) {
    if (h.oldStart < cursor) {
      h.located = false;
      continue;
    }
    out += oldText.slice(cursor, h.oldStart);
    h.newStart = out.length;
    out += h.hunk.newText;
    h.newEnd = out.length;
    cursor = h.oldEnd;
  }
  out += oldText.slice(cursor);
  return { hunks: located, newText: out };
}

const overlaps = (a: { startLine: number; endLine: number }, b: [number, number]): boolean =>
  a.startLine <= b[1] && a.endLine >= b[0];

function range(blocks: Block[]): { startLine: number; endLine: number } | null {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  return first && last ? { startLine: first.startLine, endLine: last.endLine } : null;
}

/** The change groups a hunk touches, by line overlap on the old and/or the new side. */
function groupsOfHunk(diff: BlockDiff, h: LocatedHunk, newText: string): number[] {
  const found: number[] = [];
  const oldLines = h.hunk.oldText.trim() !== '' ? lines(diff.oldText, h.oldStart, h.oldEnd) : null;
  const newLines = h.hunk.newText.trim() !== '' ? lines(newText, h.newStart, h.newEnd) : null;
  for (const group of diff.changes) {
    const o = range(group.oldBlocks);
    const n = range(group.newBlocks);
    if ((oldLines && o && overlaps(o, oldLines)) || (newLines && n && overlaps(n, newLines))) {
      found.push(group.changeIndex);
    }
  }
  return found;
}

function unitLabel(diff: BlockDiff, groups: number[], hunkCount: number): string {
  const first = groups[0] === undefined ? undefined : diff.changes[groups[0]];
  if (!first) return hunkCount > 1 ? `${hunkCount} edits` : 'edit';
  if (hunkCount <= 1) return groups.length > 1 ? `${first.label} and more` : first.label;
  const block = (first.oldBlocks[0] ?? first.newBlocks[0])?.kind;
  return groups.length === 1 && block
    ? `${hunkCount} edits in this ${blockLabel(block)}`
    : `${hunkCount} edits`;
}

/** Review of an Edit / MultiEdit: the diff of the whole result, and one unit per hunk group. */
export function buildEditReview(oldText: string, hunks: readonly EditHunk[]): Review {
  const resolved = resolveHunks(oldText, hunks);
  const diff = blockDiff(oldText, resolved.newText);
  // Union of hunks that share a change group.
  const parent = resolved.hunks.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    return root;
  };
  const owner = new Map<number, number>();
  const groupsOf = resolved.hunks.map((h) =>
    h.located ? groupsOfHunk(diff, h, resolved.newText) : [],
  );
  groupsOf.forEach((groups, i) => {
    for (const g of groups) {
      const other = owner.get(g);
      if (other === undefined) owner.set(g, i);
      else parent[find(i)] = find(other);
    }
  });
  const byRoot = new Map<number, { hunks: number[]; groups: Set<number> }>();
  resolved.hunks.forEach((h, i) => {
    if (!h.located) return;
    const root = find(i);
    const entry = byRoot.get(root) ?? { hunks: [], groups: new Set<number>() };
    entry.hunks.push(i);
    for (const g of groupsOf[i] ?? []) entry.groups.add(g);
    byRoot.set(root, entry);
  });
  const units = [...byRoot.values()]
    .map((u) => ({ hunks: u.hunks, groups: [...u.groups].sort((a, b) => a - b) }))
    .sort(
      (a, b) =>
        (a.groups[0] ?? Infinity) - (b.groups[0] ?? Infinity) ||
        (a.hunks[0] ?? 0) - (b.hunks[0] ?? 0),
    )
    .map<ChangeUnit>((u, id) => ({
      id,
      groups: u.groups,
      hunks: u.hunks,
      label: unitLabel(diff, u.groups, u.hunks.length),
    }));
  return {
    diff,
    units,
    newText: resolved.newText,
    hunks: resolved.hunks,
    hasUnlocated: resolved.hunks.some((h) => !h.located),
  };
}

/** Review of a Write: one unit per change group of the block diff. */
export function buildWriteReview(oldText: string, newText: string): Review {
  const diff = blockDiff(oldText, newText);
  return {
    diff,
    units: diff.changes.map((g) => ({
      id: g.changeIndex,
      groups: [g.changeIndex],
      hunks: [],
      label: g.label,
    })),
    newText,
    hunks: [],
    hasUnlocated: false,
  };
}

/** The hunks of the accepted units, in their original order (Edit / MultiEdit result). */
export function acceptedHunks(review: Review, accepted: ReadonlySet<number>): EditHunk[] {
  const wanted = new Set<number>();
  for (const unit of review.units) {
    if (accepted.has(unit.id)) for (const h of unit.hunks) wanted.add(h);
  }
  return review.hunks.filter((h) => wanted.has(h.index)).map((h) => h.hunk);
}

/** The change-group indexes covered by the accepted units. */
export function acceptedGroups(review: Review, accepted: ReadonlySet<number>): Set<number> {
  const groups = new Set<number>();
  for (const unit of review.units) {
    if (accepted.has(unit.id)) for (const g of unit.groups) groups.add(g);
  }
  return groups;
}

/**
 * The content of a Write once only some change groups are accepted: accepted groups take the new
 * blocks, the others keep the old ones, common blocks come from the new content. Nothing
 * accepted gives the old content, everything the new content, byte for byte.
 */
export function composeWrite(diff: BlockDiff, acceptedChangeGroups: ReadonlySet<number>): string {
  const accepted = diff.changes.filter((g) => acceptedChangeGroups.has(g.changeIndex)).length;
  if (accepted === 0) return diff.oldText;
  if (accepted === diff.changes.length) return diff.newText;
  let out = '';
  let lastFromNew = true;
  for (const group of diff.groups) {
    const fromNew = group.kind === 'same' || acceptedChangeGroups.has(group.changeIndex);
    const blocks = fromNew ? group.newBlocks : group.oldBlocks;
    for (const block of blocks) out += block.gapBefore + block.raw;
    if (blocks.length > 0) lastFromNew = fromNew;
  }
  const trailing = lastFromNew ? diff.new.trailing : diff.old.trailing;
  return out + trailing;
}

/** Compose from units: `composeWrite` for the groups the accepted units cover. */
export function composeReview(review: Review, accepted: ReadonlySet<number>): string {
  return composeWrite(review.diff, acceptedGroups(review, accepted));
}
