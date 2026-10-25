// The confirmation before a large AI operation. Props only (no store) so the quiz and the
// tutorials, which always confirm, can embed it with their own inputs. Nothing starts before
// Start; Escape cancels.

import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { AiSizeEstimate } from '../../ipc/types';
import { formatSize } from '../code/codeLines';
import { BUCKET_LABEL, confirmSummary, formatCount } from './usageFormat';

export interface ConfirmCardProps {
  /** What is about to happen, e.g. "Send message". */
  title: string;
  /** Display name of the provider, from its status. */
  provider: string;
  /** Model id or alias; empty for the provider's default. */
  model: string;
  /** What the operation will read. */
  documents: { path: string; bytes: number }[];
  images: number;
  estimate: AiSizeEstimate;
  onStart: () => void;
  onCancel: () => void;
}

export function ConfirmCard(props: ConfirmCardProps) {
  const { title, documents, estimate, onStart, onCancel } = props;
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    startRef.current?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };
  return (
    <section
      className="ai-confirm"
      role="group"
      aria-label={`Confirm: ${title}`}
      onKeyDown={onKeyDown}
    >
      <header className="ai-confirm-header">
        <span className="ai-confirm-title">{title}</span>
        <span className={`ai-confirm-bucket ai-confirm-${estimate.bucket}`}>
          {BUCKET_LABEL[estimate.bucket]}
        </span>
      </header>
      <p className="ai-confirm-summary">{confirmSummary(props)}</p>
      {documents.length > 0 && (
        <ul className="ai-confirm-docs" aria-label="Documents to read">
          {documents.map((d) => (
            <li key={d.path}>
              <span className="ai-confirm-path">{d.path}</span>
              <span className="ai-confirm-size">{formatSize(d.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="ai-confirm-estimate">
        About {formatCount(estimate.approxTokens)} tokens will be used.
      </p>
      <footer className="ai-confirm-actions">
        <Button ref={startRef} variant="primary" onClick={onStart}>
          Start <AiMark />
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </footer>
    </section>
  );
}
