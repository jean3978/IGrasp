// A markdown edit reviewed in the preview (plan §6.9): the change units of the proposed edit
// against the current content, and the answer the provider gets from the user's decisions.
// Pure functions: the conversation store holds the review, `InlineEditReview` shows it.

import { acceptedHunks, buildEditReview, buildWriteReview, composeReview } from '../diff/changes';
import type { Review } from '../diff/changes';
import { canRenderDiff } from '../diff/limits';
import type { PermissionDecision, ProposedEdit } from '../../ipc/types';

export type UnitDecision = 'accepted' | 'rejected';

/**
 * The review of `edit` over the current content, or null when it cannot be reviewed in the
 * preview (a hunk is not in the file, the file is too large to render): the chat then shows the
 * whole-edit line diff.
 */
export function prepareReview(edit: ProposedEdit, oldContent: string): Review | null {
  let review: Review;
  if (edit.wholeFile) {
    const content = edit.hunks[0]?.newText;
    if (content === undefined || edit.hunks.length !== 1) return null;
    review = buildWriteReview(oldContent, content);
  } else {
    review = buildEditReview(oldContent, edit.hunks);
  }
  if (review.hasUnlocated || review.units.length === 0) return null;
  if (!canRenderDiff(oldContent, review.newText)) return null;
  return review;
}

/** The units the user accepted. */
export function acceptedUnits(decisions: Readonly<Record<number, UnitDecision>>): Set<number> {
  return new Set(
    Object.entries(decisions)
      .filter(([, d]) => d === 'accepted')
      .map(([id]) => Number(id)),
  );
}

/**
 * The answer for the accepted units: everything accepted runs the tool as proposed, a subset
 * runs it on the accepted hunks (Edit / MultiEdit) or on the composed content (Write), nothing
 * accepted is a rejection.
 */
export function reviewDecision(
  edit: ProposedEdit,
  review: Review,
  accepted: ReadonlySet<number>,
  rejectionMessage: string,
): PermissionDecision {
  const count = review.units.filter((u) => accepted.has(u.id)).length;
  if (count === 0) return { behavior: 'deny', message: rejectionMessage };
  if (count === review.units.length) return { behavior: 'allow', updatedEdit: null };
  const hunks = edit.wholeFile
    ? [{ oldText: '', newText: composeReview(review, accepted) }]
    : acceptedHunks(review, accepted);
  return { behavior: 'allow', updatedEdit: { ...edit, hunks } };
}

/** "Applied 2 of 3 changes to docs/a.md", for the transcript. */
export function reviewOutcome(path: string, total: number, accepted: number): string {
  if (accepted === 0) {
    return total === 1
      ? `Rejected the change to ${path}.`
      : `Rejected the ${String(total)} changes to ${path}.`;
  }
  if (accepted === total) {
    return total === 1
      ? `Applied the change to ${path}.`
      : `Applied the ${String(total)} changes to ${path}.`;
  }
  return `Applied ${String(accepted)} of ${String(total)} changes to ${path}.`;
}
