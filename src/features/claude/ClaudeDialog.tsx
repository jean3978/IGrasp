import { clsx } from 'clsx';
import { Check, Plus, RefreshCw, Send, Sparkles, Square, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import {
  MODEL_PRESETS,
  REJECTION_MESSAGE,
  selectBusy,
  selectUsable,
  useClaude,
} from '../../stores/claude';
import type { PendingPermission } from '../../stores/claude';
import { useWorkspace } from '../../stores/workspace';
import { diffStats } from './diff';
import type { DiffLine } from './diff';
import { displayPath, proposedEdit } from './edits';
import { baseName } from './stream';
import type { ChatItem } from './stream';
import './claude.css';

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="claude-diff">
      {lines.map((line, i) => (
        <div key={i} className={clsx('claude-diff-line', `claude-diff-${line.type}`)}>
          <span className="claude-diff-sign" aria-hidden>
            {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
          </span>
          <span className="claude-diff-text">{line.text || ' '}</span>
        </div>
      ))}
    </pre>
  );
}

function PermissionCard({ permission }: { permission: PendingPermission }) {
  const respond = useClaude((s) => s.respond);
  const root = useWorkspace((s) => s.root?.path ?? null);
  const edit = proposedEdit(permission);
  const allow = () => {
    void respond(permission.requestId, { behavior: 'allow', updatedInput: permission.input });
  };
  const deny = () => {
    void respond(permission.requestId, { behavior: 'deny', message: REJECTION_MESSAGE });
  };

  if (edit) {
    const all = edit.hunks.flat();
    const stats = diffStats(all);
    const file = displayPath(edit.file, root);
    return (
      <section className="claude-permission" aria-label={`Proposed edit to ${baseName(file)}`}>
        <header className="claude-permission-header">
          <span className="claude-permission-title">
            {edit.whole ? 'Proposed new content' : 'Proposed edit'} · {file}
          </span>
          <span className="claude-diff-stats">
            <span className="claude-diff-added">+{stats.added}</span>{' '}
            <span className="claude-diff-removed">−{stats.removed}</span>
          </span>
        </header>
        {edit.hunks.map((hunk, i) => (
          <DiffView key={i} lines={hunk} />
        ))}
        <footer className="claude-permission-actions">
          <Button variant="primary" onClick={allow}>
            <Check aria-hidden /> Accept
          </Button>
          <Button onClick={deny}>Reject</Button>
        </footer>
      </section>
    );
  }

  return (
    <section className="claude-permission" aria-label={`Permission for ${permission.toolName}`}>
      <header className="claude-permission-header">
        <span className="claude-permission-title">
          Claude wants to use {permission.toolName}
          {permission.description ? `: ${permission.description}` : ''}
        </span>
      </header>
      <pre className="claude-json">{JSON.stringify(permission.input, null, 2)}</pre>
      <footer className="claude-permission-actions">
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
      return <div className="claude-msg claude-msg-user">{item.text}</div>;
    case 'assistant':
      return (
        <div className="claude-msg claude-msg-assistant">
          {item.text}
          {item.streaming && <span className="claude-cursor" aria-label="Claude is writing" />}
        </div>
      );
    case 'tool':
      return (
        <details className={clsx('claude-tool', { 'claude-tool-error': item.isError })}>
          <summary>
            {item.summary}
            {item.result === undefined ? ' …' : item.isError ? ' — refused or failed' : ''}
          </summary>
          {item.result !== undefined && <pre className="claude-json">{item.result}</pre>}
        </details>
      );
    case 'result':
      return (
        <div className="claude-msg claude-msg-error" role="alert">
          {item.text}
        </div>
      );
    case 'notice':
      return (
        <div
          className={clsx('claude-notice', { 'claude-notice-error': item.level === 'error' })}
          role={item.level === 'error' ? 'alert' : 'status'}
        >
          {item.text}
        </div>
      );
  }
}

function ModelPicker() {
  const model = useClaude((s) => s.model);
  const setModel = useClaude((s) => s.setModel);
  const busy = useClaude(selectBusy);
  const isPreset = (MODEL_PRESETS as readonly string[]).includes(model);
  const [custom, setCustom] = useState(!isPreset);
  return (
    <span className="claude-model">
      <select
        className="claude-select"
        aria-label="Model"
        value={custom ? 'custom' : model}
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
        {MODEL_PRESETS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value="custom">custom…</option>
      </select>
      {custom && (
        <input
          className="text-input claude-model-input"
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
  const status = useClaude((s) => s.status);
  const checking = useClaude((s) => s.checking);
  const checkStatus = useClaude((s) => s.checkStatus);
  const sessionId = useClaude((s) => s.sessionId);
  const costUsd = useClaude((s) => s.costUsd);
  if (checking && !status) return <div className="claude-status">Checking the Claude CLI…</div>;
  if (!status) return null;
  if (status.problem !== null) {
    return (
      <div className="claude-status claude-status-problem" role="alert">
        <p>{status.problem}</p>
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
  return (
    <div className="claude-status claude-status-ok">
      claude {status.version ?? '?'} · {status.email ?? 'logged in'}
      {status.subscription ? ` (${status.subscription})` : ''} · session{' '}
      {sessionId ? sessionId.slice(0, 8) : 'new'}
      {costUsd > 0 ? ` · $${costUsd.toFixed(4)}` : ''}
    </div>
  );
}

function Composer() {
  const send = useClaude((s) => s.send);
  const cancel = useClaude((s) => s.cancel);
  const busy = useClaude(selectBusy);
  const usable = useClaude(selectUsable);
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
      className="claude-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        className="claude-input"
        aria-label="Message to Claude"
        placeholder={
          usable ? 'Ask Claude about this project… (Enter to send)' : 'Claude is unavailable'
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
          className="claude-send"
          onClick={() => {
            void cancel();
          }}
        >
          <Square aria-hidden />
        </IconButton>
      ) : (
        <IconButton label="Send" className="claude-send" type="submit" disabled={!canSend}>
          <Send aria-hidden />
        </IconButton>
      )}
    </form>
  );
}

export function ClaudeDialog() {
  const open = useClaude((s) => s.open);
  const setOpen = useClaude((s) => s.setOpen);
  const status = useClaude((s) => s.status);
  const checking = useClaude((s) => s.checking);
  const checkStatus = useClaude((s) => s.checkStatus);
  const items = useClaude((s) => s.items);
  const permissions = useClaude((s) => s.permissions);
  const newConversation = useClaude((s) => s.newConversation);
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
          className="claude-dialog"
          aria-describedby={undefined}
          onInteractOutside={(e) => {
            // A floating panel: reading the document behind it must not close it.
            e.preventDefault();
          }}
        >
          <header className="claude-header">
            <Dialog.Title className="claude-title">
              <Sparkles aria-hidden /> Claude
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
          <div className="claude-messages" ref={listRef} aria-live="polite">
            {items.length === 0 && permissions.length === 0 && (
              <p className="claude-empty">
                Proof of concept: the chat talks to your installed <code>claude</code> CLI, in the
                open folder. Edits to markdown files are shown as a diff to accept or reject.
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
