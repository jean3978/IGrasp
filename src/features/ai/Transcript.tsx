// The conversation: messages, tool calls, automatic decisions, usage lines, then what waits on
// the user (permission prompts, the confirmation card). New item kinds (an edit under review, a
// capture) render here through `Message`.

import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { selectProviderName, useAiProvider } from '../../stores/aiProvider';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import { ConfirmCard } from './ConfirmCard';
import { PermissionCard } from './PermissionCard';
import { decisionText } from './timeline';
import type { ChatItem } from './timeline';
import { UsageLine } from './UsageLine';

/** The provider lost the conversation: the app's copy stays, and the message can go again. */
function ResumeFailed({ prompt }: { prompt: string }) {
  const restartFromHere = useAiConversation((s) => s.restartFromHere);
  const busy = useAiConversation(selectBusy);
  const providerName = useAiProvider(selectProviderName);
  return (
    <div className="ai-notice ai-notice-error ai-resume-failed" role="alert">
      <p>
        {providerName} cannot continue this conversation any more. The transcript above stays here;
        your last message can start a new conversation that continues from it.
      </p>
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => {
          void restartFromHere(prompt);
        }}
      >
        Start a new conversation from here <AiMark />
      </Button>
    </div>
  );
}

/**
 * A permission answered without asking (settings, a conversation rule, the read-only policy):
 * "Allowed by your settings: Edit notes.md". Nothing runs invisibly.
 */
export function PermissionDecidedItem(item: {
  tool: string;
  description: string | null;
  allowed: boolean;
  reason: string;
}) {
  return (
    <div
      className={clsx('ai-notice', 'ai-decision', { 'ai-notice-error': !item.allowed })}
      role="status"
    >
      {decisionText(item)}
    </div>
  );
}

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
      return <PermissionDecidedItem {...item} />;
    case 'error':
      return (
        <div className="ai-msg ai-msg-error" role="alert">
          {item.text}
        </div>
      );
    case 'usage':
      return <UsageLine {...item} />;
    case 'resumeFailed':
      return <ResumeFailed prompt={item.prompt} />;
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
  const providerName = useAiProvider(selectProviderName);
  const items = useAiConversation((s) => s.items);
  const permissions = useAiConversation((s) => s.permissions);
  const pendingConfirm = useAiConversation((s) => s.pendingConfirm);
  const confirmStart = useAiConversation((s) => s.confirmStart);
  const cancelConfirm = useAiConversation((s) => s.cancelConfirm);
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
