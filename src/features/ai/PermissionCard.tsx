// A permission the provider asks for: what it would do, and the user's answer (Allow, Deny, or
// Allow for this conversation for anything but an edit). A markdown edit inside the folder is
// reviewed in the preview (`EditCard` points to it); any other proposed edit is shown as a line
// diff to accept or reject as a whole.

import { clsx } from 'clsx';
import { Check, Eye } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { ProposedEdit } from '../../ipc/types';
import { selectProviderName, useAiProvider } from '../../stores/aiProvider';
import { REJECTION_MESSAGE, useAiConversation } from '../../stores/aiConversation';
import type { PendingPermission, PendingReview } from '../../stores/aiConversation';
import { diffStats, lineDiff } from './diff';
import type { DiffLine } from './diff';
import { focusReview } from './reviewFocus';

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="ai-diff">
      {lines.map((line, i) => (
        <div key={i} className={clsx('ai-diff-line', `ai-diff-${line.type}`)}>
          <span className="ai-diff-sign" aria-hidden>
            {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
          </span>
          {line.type !== 'same' && (
            <span className="visually-hidden">{line.type === 'add' ? 'Added: ' : 'Removed: '}</span>
          )}
          <span className="ai-diff-text">{line.text || ' '}</span>
        </div>
      ))}
    </pre>
  );
}

/** The whole-edit line diff card. */
export function LineDiffCard({
  edit,
  onAccept,
  onReject,
}: {
  edit: ProposedEdit;
  onAccept: () => void;
  onReject: () => void;
}) {
  const hunks = edit.hunks.map((h) => lineDiff(h.oldText, h.newText));
  const stats = diffStats(hunks.flat());
  return (
    <section className="ai-permission" aria-label={`Proposed edit to ${baseName(edit.path)}`}>
      <header className="ai-permission-header">
        <span className="ai-permission-title">
          {edit.wholeFile ? 'Proposed new content' : 'Proposed edit'} · {edit.path}
        </span>
        <span className="ai-diff-stats">
          <span className="ai-diff-added">+{stats.added}</span>{' '}
          <span className="ai-diff-removed">−{stats.removed}</span>
        </span>
      </header>
      {hunks.map((hunk, i) => (
        <DiffView key={i} lines={hunk} />
      ))}
      <footer className="ai-permission-actions">
        <Button variant="primary" onClick={onAccept}>
          <Check aria-hidden /> Accept
        </Button>
        <Button onClick={onReject}>Reject</Button>
      </footer>
    </section>
  );
}

/**
 * A markdown edit reviewed in the preview: what it changes, "Review in preview", and the answers
 * for the whole edit (the review itself decides per change).
 */
export function EditCard({ review }: { review: PendingReview }) {
  const providerName = useAiProvider(selectProviderName);
  const showReview = useAiConversation((s) => s.showReview);
  const acceptAll = useAiConversation((s) => s.acceptAllChanges);
  const rejectAll = useAiConversation((s) => s.rejectAllChanges);
  const units = review.review?.units ?? [];
  const decided = units.filter((u) => u.id in review.decisions).length;
  const loading = review.status === 'loading';
  const what = review.isNew
    ? `a new file ${review.path}`
    : `${units.length === 1 ? '1 change' : `${String(units.length)} changes`} to ${review.path}`;
  return (
    <section
      className="ai-permission ai-edit-card"
      aria-label={`Proposed edit to ${baseName(review.path)}`}
    >
      <header className="ai-permission-header">
        <span className="ai-permission-title">
          {loading ? `Preparing the review of ${review.path}…` : `${providerName} proposes ${what}`}
        </span>
        {!loading && units.length > 1 && (
          <span className="ai-diff-stats">
            {String(decided)} of {String(units.length)} decided
          </span>
        )}
      </header>
      <footer className="ai-permission-actions">
        <Button
          variant="primary"
          disabled={loading}
          onClick={() => {
            showReview();
            focusReview();
          }}
        >
          <Eye aria-hidden /> Review in preview
        </Button>
        <Button
          disabled={loading}
          onClick={() => {
            void acceptAll();
          }}
        >
          <Check aria-hidden /> Accept all
        </Button>
        <Button
          disabled={loading}
          onClick={() => {
            void rejectAll();
          }}
        >
          Reject all
        </Button>
      </footer>
    </section>
  );
}

export function PermissionCard({ permission }: { permission: PendingPermission }) {
  const respond = useAiConversation((s) => s.respond);
  const allowForConversation = useAiConversation((s) => s.allowForConversation);
  const providerName = useAiProvider(selectProviderName);
  const review = useAiConversation((s) =>
    s.pendingReview?.requestId === permission.requestId && s.pendingReview.status !== 'fallback'
      ? s.pendingReview
      : null,
  );
  const allow = () => {
    void respond(permission.requestId, { behavior: 'allow', updatedEdit: null });
  };
  const deny = () => {
    void respond(permission.requestId, { behavior: 'deny', message: REJECTION_MESSAGE });
  };
  if (review) return <EditCard review={review} />;
  // Non-markdown or outside-root edits, and markdown edits the preview cannot review.
  const edit = permission.proposedEdit;
  if (edit) return <LineDiffCard edit={edit} onAccept={allow} onReject={deny} />;
  return (
    <section className="ai-permission" aria-label={`Permission for ${permission.tool}`}>
      <header className="ai-permission-header">
        <span className="ai-permission-title">
          {providerName} wants to use {permission.tool}
          {permission.description ? `: ${permission.description}` : ''}
        </span>
      </header>
      <details className="ai-permission-input">
        <summary>Details</summary>
        <pre className="ai-json">{JSON.stringify(permission.input, null, 2)}</pre>
      </details>
      <footer className="ai-permission-actions">
        <Button
          title={`Allows ${permission.tool} without asking again until New conversation`}
          onClick={() => {
            void allowForConversation(permission.requestId);
          }}
        >
          Allow for this conversation
        </Button>
        <Button variant="primary" onClick={allow}>
          Allow
        </Button>
        <Button onClick={deny}>Deny</Button>
      </footer>
    </section>
  );
}
