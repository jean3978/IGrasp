import { clsx } from 'clsx';
import { Check, Plus, RefreshCw, Send, Sparkles, Square, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import type { ProposedEdit } from '../../ipc/types';
import {
  REJECTION_MESSAGE,
  selectBusy,
  selectProviderName,
  selectUsable,
  useAi,
} from '../../stores/ai';
import type { PendingPermission } from '../../stores/ai';
import { useWorkspace } from '../../stores/workspace';
import { diffStats, lineDiff } from './diff';
import type { DiffLine } from './diff';
import { decisionText } from './timeline';
import type { ChatItem } from './timeline';
import './ai.css';

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

function EditCard({
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

function PermissionCard({ permission }: { permission: PendingPermission }) {
  const respond = useAi((s) => s.respond);
  const providerName = useAi(selectProviderName);
  const allow = () => {
    void respond(permission.requestId, { behavior: 'allow', updatedEdit: null });
  };
  const deny = () => {
    void respond(permission.requestId, { behavior: 'deny', message: REJECTION_MESSAGE });
  };
  const edit = permission.proposedEdit;
  if (edit) return <EditCard edit={edit} onAccept={allow} onReject={deny} />;
  return (
    <section className="ai-permission" aria-label={`Permission for ${permission.tool}`}>
      <header className="ai-permission-header">
        <span className="ai-permission-title">
          {providerName} wants to use {permission.tool}
          {permission.description ? `: ${permission.description}` : ''}
        </span>
      </header>
      <pre className="ai-json">{JSON.stringify(permission.input, null, 2)}</pre>
      <footer className="ai-permission-actions">
        <Button variant="primary" onClick={allow}>
          Allow
        </Button>
        <Button onClick={deny}>Deny</Button>
      </footer>
    </section>
  );
}

function Message({ item }: { item: ChatItem }) {
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

function ModelPicker() {
  const model = useAi((s) => s.model);
  const setModel = useAi((s) => s.setModel);
  const capabilities = useAi((s) => s.capabilities);
  const models = capabilities?.models ?? [];
  const busy = useAi(selectBusy);
  const isPreset = models.some((m) => m.id === model);
  const [custom, setCustom] = useState(false);
  const showCustom = custom || (!isPreset && model !== '');
  return (
    <span className="ai-model">
      <select
        className="ai-select"
        aria-label="Model"
        value={showCustom ? 'custom' : model}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value === 'custom') {
            setCustom(true);
          } else {
            setCustom(false);
            setModel(e.target.value);
          }
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value="custom">custom…</option>
      </select>
      {showCustom && (
        <input
          className="text-input ai-model-input"
          aria-label="Model id"
          placeholder="model id"
          defaultValue={isPreset ? '' : model}
          disabled={busy}
          onBlur={(e) => {
            setModel(e.target.value);
          }}
        />
      )}
    </span>
  );
}

function StatusLine() {
  const status = useAi((s) => s.status);
  const checking = useAi((s) => s.checking);
  const checkStatus = useAi((s) => s.checkStatus);
  const resumeId = useAi((s) => s.resumeId);
  const usage = useAi((s) => s.usage);
  if (checking && !status) return <div className="ai-status">Checking the AI provider…</div>;
  if (!status) return null;
  if (status.problem !== null) {
    return (
      <div className="ai-status ai-status-problem" role="alert">
        <p>
          {status.problem}
          {status.help ? ` ${status.help}` : ''}
        </p>
        <Button
          onClick={() => {
            void checkStatus();
          }}
          disabled={checking}
        >
          <RefreshCw aria-hidden /> Check again
        </Button>
      </div>
    );
  }
  const tokens = usage.inputTokens + usage.outputTokens;
  return (
    <div className="ai-status ai-status-ok">
      {status.displayName} {status.version ?? ''} · {status.account ?? 'signed in'}
      {status.plan ? ` (${status.plan})` : ''} · session {resumeId ? resumeId.slice(0, 8) : 'new'}
      {tokens > 0 ? ` · ${String(tokens)} tokens` : ''}
      {usage.costUsd !== null && usage.costUsd > 0 ? ` · $${usage.costUsd.toFixed(4)}` : ''}
    </div>
  );
}

function Composer() {
  const send = useAi((s) => s.send);
  const cancel = useAi((s) => s.cancel);
  const busy = useAi(selectBusy);
  const usable = useAi(selectUsable);
  const providerName = useAi(selectProviderName);
  const hasRoot = useWorkspace((s) => s.root !== null);
  const [text, setText] = useState('');
  const canSend = usable && hasRoot && !busy && text.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    void send(text);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="ai-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        className="ai-input"
        aria-label="Message"
        placeholder={
          usable
            ? `Ask ${providerName} about this project… (Enter to send, uses tokens)`
            : `${providerName} is unavailable`
        }
        value={text}
        rows={2}
        disabled={!usable || !hasRoot}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {busy ? (
        <IconButton
          label="Stop"
          className="ai-send"
          onClick={() => {
            void cancel();
          }}
        >
          <Square aria-hidden />
        </IconButton>
      ) : (
        <IconButton
          label={`Send (uses ${providerName})`}
          className="ai-send"
          type="submit"
          disabled={!canSend}
        >
          <Send aria-hidden />
        </IconButton>
      )}
    </form>
  );
}

export function AiChatDialog() {
  const open = useAi((s) => s.open);
  const setOpen = useAi((s) => s.setOpen);
  const status = useAi((s) => s.status);
  const checking = useAi((s) => s.checking);
  const checkStatus = useAi((s) => s.checkStatus);
  const providerName = useAi(selectProviderName);
  const items = useAi((s) => s.items);
  const permissions = useAi((s) => s.permissions);
  const newConversation = useAi((s) => s.newConversation);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !status && !checking) void checkStatus();
  }, [open, status, checking, checkStatus]);

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, permissions]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
      <Dialog.Portal>
        <Dialog.Content
          className="ai-dialog"
          aria-describedby={undefined}
          onInteractOutside={(e) => {
            // A floating panel: reading the document behind it must not close it.
            e.preventDefault();
          }}
        >
          <header className="ai-header">
            <Dialog.Title className="ai-title">
              <Sparkles aria-hidden /> {providerName}
            </Dialog.Title>
            <ModelPicker />
            <IconButton
              label="New conversation"
              onClick={() => {
                newConversation();
              }}
            >
              <Plus aria-hidden />
            </IconButton>
            <Dialog.Close asChild>
              <IconButton label="Close">
                <X aria-hidden />
              </IconButton>
            </Dialog.Close>
          </header>
          <StatusLine />
          <div className="ai-messages" ref={listRef} aria-live="polite">
            {items.length === 0 && permissions.length === 0 && (
              <p className="ai-empty">
                Proof of concept: the chat talks to {providerName} in the open folder. Each message
                you send spends tokens; nothing runs on its own. Edits to markdown files are shown
                as a diff to accept or reject.
              </p>
            )}
            {items.map((item) => (
              <Message key={item.id} item={item} />
            ))}
            {permissions.map((p) => (
              <PermissionCard key={p.requestId} permission={p} />
            ))}
          </div>
          <Composer />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
