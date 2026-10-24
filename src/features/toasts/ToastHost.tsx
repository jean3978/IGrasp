import { clsx } from 'clsx';
import { Popover } from 'radix-ui';
import { AlertCircle, FileMinus, FilePen, FilePlus, Files, Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTabs } from '../../stores/tabs';
import { batchSize, describeBatch, useToasts } from '../../stores/toasts';
import type { ChangeBatch, ChangeKind, Toast } from '../../stores/toasts';
import './toasts.css';

const KIND_ICON: Record<ChangeKind, typeof FilePlus> = {
  added: FilePlus,
  modified: FilePen,
  deleted: FileMinus,
};

const KIND_LABEL: Record<ChangeKind, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
};

const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Dismisses the toast after its duration; hovering or focusing it pauses the countdown. */
function useAutoDismiss(toast: Toast, paused: boolean) {
  const dismiss = useToasts((s) => s.dismiss);
  const remaining = useRef(toast.duration);
  const version = toast.type === 'grouped' ? toast.version : 0;

  // A grouped toast that is updated starts its countdown again.
  useEffect(() => {
    remaining.current = toast.duration;
  }, [version, toast.duration]);

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const t = window.setTimeout(() => {
      dismiss(toast.id);
    }, remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, toast.id, dismiss, version]);
}

function openFile(relPath: string) {
  useTabs.getState().openDocument(relPath);
}

function BatchDetails({ batch }: { batch: ChangeBatch }) {
  return (
    <div className="toast-details">
      {(['modified', 'added', 'deleted'] as const).map((kind) =>
        batch[kind].length === 0 ? null : (
          <section key={kind}>
            <h3>
              {KIND_LABEL[kind]} ({batch[kind].length})
            </h3>
            <ul>
              {batch[kind].map((p) => (
                <li key={p}>
                  {kind === 'deleted' ? (
                    <span className="toast-details-path">{p}</span>
                  ) : (
                    <button
                      type="button"
                      className="toast-details-path"
                      onClick={() => {
                        openFile(p);
                      }}
                    >
                      {p}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const detailsId = useToasts((s) => s.detailsId);
  const { dismiss, openDetails } = useToasts.getState();
  const detailsOpen = detailsId === toast.id;
  useAutoDismiss(toast, hovered || focused || detailsOpen);

  let icon;
  let body;
  let tone: string;
  let onActivate: (() => void) | null = null;
  if (toast.type === 'change') {
    const Icon = KIND_ICON[toast.kind];
    icon = <Icon aria-hidden />;
    tone = toast.kind;
    body = (
      <>
        <span className="toast-title">{KIND_LABEL[toast.kind]}</span>
        <span className="toast-text" title={toast.relPath}>
          {fileName(toast.relPath)}
        </span>
      </>
    );
    if (toast.kind !== 'deleted')
      onActivate = () => {
        openFile(toast.relPath);
        dismiss(toast.id);
      };
  } else if (toast.type === 'grouped') {
    icon = <Files aria-hidden />;
    tone = 'grouped';
    body = (
      <>
        <span className="toast-title">{batchSize(toast.batch)} files changed</span>
        <span className="toast-text">{describeBatch(toast.batch)}</span>
      </>
    );
    onActivate = () => {
      openDetails(detailsOpen ? null : toast.id);
    };
  } else {
    icon = toast.level === 'error' ? <AlertCircle aria-hidden /> : <Info aria-hidden />;
    tone = toast.level;
    body = <span className="toast-text toast-text-wrap">{toast.text}</span>;
  }

  const card = (
    <div
      className={clsx('toast', `toast-${tone}`)}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
    >
      <span className="toast-icon">{icon}</span>
      {onActivate ? (
        <button type="button" className="toast-body" onClick={onActivate}>
          {body}
        </button>
      ) : (
        <div className="toast-body">{body}</div>
      )}
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss notification"
        onClick={() => {
          dismiss(toast.id);
        }}
      >
        <X aria-hidden />
      </button>
    </div>
  );

  if (toast.type !== 'grouped') return card;
  return (
    <Popover.Root
      open={detailsOpen}
      onOpenChange={(open) => {
        openDetails(open ? toast.id : null);
      }}
    >
      <Popover.Anchor asChild>{card}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content className="toast-popover" side="top" align="end" sideOffset={8}>
          <BatchDetails batch={toast.batch} />
          <div className="toast-popover-actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                dismiss(toast.id);
              }}
            >
              Dismiss
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Bottom-right stack of notifications, announced politely to screen readers. */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toast-host" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} />
      ))}
    </div>
  );
}
