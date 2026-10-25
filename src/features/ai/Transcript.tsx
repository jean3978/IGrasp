// The conversation: messages, tool calls, automatic decisions, usage lines, then what waits on
// the user (permission prompts, the confirmation card). New item kinds (an edit under review, a
// selection) render here through `Message`. An answer shows in one piece when it is complete,
// rendered like a document (the preview's sanitized pipeline); until then an animated "…"
// says the provider is working.

import { clsx } from 'clsx';
import { Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { selectProviderName, useAiProvider } from '../../stores/aiProvider';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import { useWorkspace } from '../../stores/workspace';
import { MarkdownPreview } from '../preview/MarkdownPreview';
import { useMarkdown } from '../preview/useMarkdown';
import { ConfirmCard } from './ConfirmCard';
import { PermissionCard } from './PermissionCard';
import { answerAfter, captureLabel, decisionText } from './timeline';
import { useStepQuestions } from '../../stores/stepQuestions';
import { BookmarkPlus, Check } from 'lucide-react';
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
    <div className={clsx('ai-notice', 'ai-decision', { 'ai-notice-error': !item.allowed })}>
      {decisionText(item)}
    </div>
  );
}

/** The selection the message is about: its place in the document and its text. */
export function CaptureItem(item: Extract<ChatItem, { kind: 'capture' }>) {
  const label = captureLabel(item);
  const shown = item.selection ?? item.text;
  return (
    <details className="ai-capture" open={shown.length < 400}>
      <summary>
        {item.selection === undefined ? 'Selected region' : 'Selected text'}: {label}
      </summary>
      {item.selection !== undefined ? (
        <pre className="ai-capture-text">{item.selection}</pre>
      ) : item.text ? (
        <pre className="ai-capture-text">{item.text}</pre>
      ) : (
        <p className="ai-capture-empty">No text in the region.</p>
      )}
    </details>
  );
}

/**
 * The step of a tutorial a message is about, with what was pointed at; once answered, "Save to
 * this step" keeps the question and the answer on the step (without the reader's name).
 */
export function StepItem(item: Extract<ChatItem, { kind: 'step' }>) {
  const answer = useAiConversation((s) => answerAfter(s.items, item.id));
  const busy = useAiConversation(selectBusy);
  const markStepSaved = useAiConversation((s) => s.markStepSaved);
  const save = useStepQuestions((s) => s.save);
  const canSave = !item.saved && !busy && answer !== '';
  return (
    <div className="ai-capture ai-step-item" role="group" aria-label={`About ${item.label}`}>
      <p className="ai-step-label">About {item.label}</p>
      {item.quote && <pre className="ai-capture-text">{item.quote}</pre>}
      {item.saved ? (
        <p className="ai-step-saved" role="status">
          <Check aria-hidden /> Saved on the step
        </p>
      ) : (
        answer !== '' && (
          <Button
            variant="ghost"
            disabled={!canSave}
            title="Keep this question and the answer on the step, without your name"
            onClick={() =>
              void save(item.tutorial, item.chapter, {
                step: item.step,
                ...(item.quote ? { quote: item.quote } : {}),
                question: item.question,
                answer,
              }).then((ok) => {
                if (ok) markStepSaved(item.id);
              })
            }
          >
            <BookmarkPlus aria-hidden /> Save to this step
          </Button>
        )
      )}
    </div>
  );
}

/** The provider's avatar beside its answers and the typing indicator. */
function Avatar() {
  return (
    <span className="ai-avatar ai-avatar-small" aria-hidden>
      <Sparkles />
    </span>
  );
}

/** A complete answer, rendered like a document (plain text until the render is ready). */
function AssistantText({ text }: { text: string }) {
  // Its own cache: answers must not push the open documents' renders out.
  const { rendered } = useMarkdown(text, 'chat');
  const rootPath = useWorkspace((s) => s.root?.path ?? '');
  return (
    <div className="ai-row ai-row-assistant">
      <Avatar />
      <div className="ai-msg ai-msg-assistant">
        {rendered ? (
          <div className="ai-markdown">
            <MarkdownPreview rendered={rendered} rootPath={rootPath} />
          </div>
        ) : (
          <div className="ai-plain">{text}</div>
        )}
      </div>
    </div>
  );
}

/** Three dots while the provider works on its answer. */
export function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="ai-row ai-row-assistant ai-typing-row">
      <Avatar />
      <div
        className="ai-msg ai-msg-assistant ai-typing"
        role="img"
        aria-label={`${name} is writing`}
      >
        <span className="ai-typing-dot" />
        <span className="ai-typing-dot" />
        <span className="ai-typing-dot" />
      </div>
    </div>
  );
}

/** An answer still being written, shown as it stands while a card waits on the user. */
function PartialText({ text }: { text: string }) {
  return (
    <div className="ai-row ai-row-assistant">
      <Avatar />
      <div className="ai-msg ai-msg-assistant ai-plain ai-msg-partial">{text}</div>
    </div>
  );
}

export function Message({
  item,
  showPartial = false,
}: {
  item: ChatItem;
  /** A permission or confirmation card waits: the answer so far explains what is asked. */
  showPartial?: boolean;
}) {
  switch (item.kind) {
    case 'user':
      return <div className="ai-msg ai-msg-user">{item.text}</div>;
    case 'assistant':
      // Shown in one piece once complete; the typing indicator stands for it until then, except
      // when the user must decide on a card: then what is written so far explains it.
      if (!item.streaming) return <AssistantText text={item.text} />;
      return showPartial && item.text.trim() !== '' ? <PartialText text={item.text} /> : null;
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
    case 'capture':
      return <CaptureItem {...item} />;
    case 'step':
      return <StepItem {...item} />;
    case 'notice':
      return (
        <div
          className={clsx('ai-notice', { 'ai-notice-error': item.level === 'error' })}
          role={item.level === 'error' ? 'alert' : undefined}
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
  const busy = useAiConversation(selectBusy);
  const listRef = useRef<HTMLDivElement>(null);
  const typing = busy && permissions.length === 0 && !pendingConfirm;

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, permissions, pendingConfirm, typing]);

  return (
    // No live region here: streamed text would be read word by word. `AiAnnouncer` says what
    // happens instead.
    <div className="ai-messages" ref={listRef}>
      {items.length === 0 && permissions.length === 0 && !pendingConfirm && (
        <div className="ai-empty">
          <span className="ai-avatar ai-avatar-large" aria-hidden>
            <Sparkles />
          </span>
          <p className="ai-empty-title">Ask {providerName} about this project</p>
          <p>
            Highlight text with the cursor tool, or drag a region, and the chat opens next to it.
            Each message you send spends tokens; nothing runs on its own. Edits to markdown files
            are shown as a diff to accept or reject.
          </p>
        </div>
      )}
      {items.map((item) => (
        <Message
          key={item.id}
          item={item}
          showPartial={permissions.length > 0 || pendingConfirm !== null}
        />
      ))}
      {permissions.map((p) => (
        <PermissionCard key={p.requestId} permission={p} />
      ))}
      {typing && <TypingIndicator name={providerName} />}
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
