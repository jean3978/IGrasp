// A permission the provider asks for: what it would do, and the user's answer (Allow, Deny, or
// Allow for this conversation for anything but an edit). A proposed edit is shown as a line diff to accept or reject as a whole (the inline review in the preview
// takes over markdown edits in a later step; this card stays the fallback).

import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { ProposedEdit } from '../../ipc/types';
import { selectProviderName, useAiProvider } from '../../stores/aiProvider';
import { REJECTION_MESSAGE, useAiConversation } from '../../stores/aiConversation';
import type { PendingPermission } from '../../stores/aiConversation';
import { diffStats, lineDiff } from './diff';
import type { DiffLine } from './diff';

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

export function PermissionCard({ permission }: { permission: PendingPermission }) {
  const respond = useAiConversation((s) => s.respond);
  const allowForConversation = useAiConversation((s) => s.allowForConversation);
  const providerName = useAiProvider(selectProviderName);
  const allow = () => {
    void respond(permission.requestId, { behavior: 'allow', updatedEdit: null });
  };
  const deny = () => {
    void respond(permission.requestId, { behavior: 'deny', message: REJECTION_MESSAGE });
  };
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
