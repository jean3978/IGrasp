// The confirmation of a write in the folder: where, and every file (new, changed, unchanged,
// removed), before anything is written. Nothing is written until the button is pressed.

import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { PlannedState } from '../../ipc/types';
import { useTutorialWrite } from '../../stores/tutorialWrite';

const STATE_LABEL: Record<PlannedState, string> = {
  new: 'new',
  changed: 'changed',
  unchanged: 'unchanged',
};

const kb = (bytes: number) => `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;

export function WriteConfirmDialog() {
  const pending = useTutorialWrite((s) => s.pending);
  const busy = useTutorialWrite((s) => s.busy);
  const error = useTutorialWrite((s) => s.error);
  const confirm = useTutorialWrite((s) => s.confirm);
  const cancel = useTutorialWrite((s) => s.cancel);
  const plan = pending?.plan;
  const kind = pending?.target.type;
  const unchanged =
    plan !== undefined &&
    plan.removed.length === 0 &&
    plan.files.every((f) => f.state === 'unchanged');
  return (
    <Dialog.Root
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        {pending && plan && (
          <Dialog.Content className="dialog academy-write-dialog">
            <Dialog.Close className="dialog-close" aria-label="Close">
              <X aria-hidden />
            </Dialog.Close>
            <Dialog.Title className="dialog-title">
              {kind === 'share'
                ? 'Share with the project'
                : kind === 'export'
                  ? 'Save a copy'
                  : 'Update the shared tutorial'}
            </Dialog.Title>
            <Dialog.Description className="quiz-muted">
              {kind === 'export' ? (
                <>
                  “{pending.title}” is saved as markdown files in a folder you choose next. Your
                  private copy stays as it is.
                </>
              ) : (
                <>
                  “{pending.title}” is written as markdown files in{' '}
                  <code>{plan.folder || 'the folder'}/</code>, where everyone working on the project
                  can read it (and commit it). Nothing else in the folder changes.
                </>
              )}
            </Dialog.Description>
            <ul className="academy-write-files" aria-label="Files">
              {plan.files.map((f) => (
                <li key={f.name} data-state={f.state}>
                  <code>{f.name}</code>
                  <span className="academy-tag">{STATE_LABEL[f.state]}</span>
                  <span className="quiz-muted">{kb(f.bytes)}</span>
                </li>
              ))}
              {plan.removed.map((name) => (
                <li key={name} data-state="removed">
                  <code>{name}</code>
                  <span className="academy-tag academy-tag-warn">removed</span>
                </li>
              ))}
            </ul>
            {unchanged && (
              <p className="quiz-muted" role="status">
                The files in the folder are already this version.
              </p>
            )}
            {error && (
              <p className="academy-write-error" role="alert">
                {error}
              </p>
            )}
            <div className="academy-write-actions">
              <Button variant="ghost" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void confirm()}
                disabled={busy || (unchanged && kind !== 'export')}
              >
                {kind === 'share' ? 'Share' : kind === 'export' ? 'Choose a folder…' : 'Write'}
              </Button>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
