// The conversation: messages, tool calls, automatic decisions, usage lines, then what waits on
// the user (permission prompts, the confirmation card). New item kinds (an edit under review, a
// capture) render here through `Message`.

import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { selectProviderName, useAi } from '../../stores/ai';
import { ConfirmCard } from './ConfirmCard';
import { PermissionCard } from './PermissionCard';
import { decisionText } from './timeline';
import type { ChatItem } from './timeline';
import { UsageLine } from './UsageLine';

export function Message({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return <div className="ai-msg ai-msg-user">{item.text}</div>;
    case 'assistant':
      return (
        <div className="ai-msg ai-msg-assistant">
          {item.text}
          {item.streaming && <span className="ai-cursor" aria-label="Writing" />}
        </div>
      );
    case 'tool':
      return (
        <details className={clsx('ai-tool', { 'ai-tool-error': item.isError })}>
          <summary>
            {item.summary}
            {item.result === undefined ? ' …' : item.isError ? ' — refused or failed' : ''}
          </summary>
          {item.result !== undefined && <pre className="ai-json">{item.result}</pre>}
        </details>
      );
    case 'decision':
      return (
        <div
          className={clsx('ai-notice', 'ai-decision', { 'ai-notice-error': !item.allowed })}
          role="status"
        >
          {decisionText(item)}
        </div>
      );
    case 'error':
      return (
        <div className="ai-msg ai-msg-error" role="alert">
          {item.text}
        </div>
      );
    case 'usage':
      return <UsageLine {...item} />;
    case 'notice':
      return (
        <div
          className={clsx('ai-notice', { 'ai-notice-error': item.level === 'error' })}
          role={item.level === 'error' ? 'alert' : 'status'}
        >
          {item.text}
        </div>
      );
  }
}

export function Transcript() {
  const providerName = useAi(selectProviderName);
  const items = useAi((s) => s.items);
  const permissions = useAi((s) => s.permissions);
  const pendingConfirm = useAi((s) => s.pendingConfirm);
  const confirmStart = useAi((s) => s.confirmStart);
  const cancelConfirm = useAi((s) => s.cancelConfirm);
  const listRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, permissions, pendingConfirm]);

  return (
    <div className="ai-messages" ref={listRef} aria-live="polite">
      {items.length === 0 && permissions.length === 0 && !pendingConfirm && (
        <p className="ai-empty">
          Ask {providerName} about this folder. Each message you send spends tokens; nothing runs on
          its own. Edits to markdown files are shown as a diff to accept or reject.
        </p>
      )}
      {items.map((item) => (
        <Message key={item.id} item={item} />
      ))}
      {permissions.map((p) => (
        <PermissionCard key={p.requestId} permission={p} />
      ))}
      {pendingConfirm && (
        <ConfirmCard
          title={pendingConfirm.title}
          provider={providerName}
          model={pendingConfirm.model}
          documents={pendingConfirm.documents}
          images={pendingConfirm.images}
          estimate={pendingConfirm.estimate}
          onStart={() => {
            void confirmStart();
          }}
          onCancel={cancelConfirm}
        />
      )}
    </div>
  );
}
