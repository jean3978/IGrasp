// The message box and Send (the only control of the panel, with the quick actions, that spends
// tokens) or Stop while an operation runs. The draft lives in the panel store so it survives
// closing the panel and can be pre-filled (a selection). The box grows with its text.

import { Send } from 'lucide-react';
import { forwardRef, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { AiMark } from '../../components/AiMark';
import { IconButton } from '../../components/ui/IconButton';
import { selectProviderName, selectUsable, useAiProvider } from '../../stores/aiProvider';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { useWorkspace } from '../../stores/workspace';
import { CancelButton } from './CancelButton';

/** The message box grows up to this height, then scrolls. */
const MAX_INPUT_HEIGHT = 160;

export const Composer = forwardRef<HTMLTextAreaElement>(function Composer(_props, ref) {
  const send = useAiConversation((s) => s.send);
  const cancel = useAiConversation((s) => s.cancel);
  const busy = useAiConversation(selectBusy);
  const usable = useAiProvider(selectUsable);
  const providerName = useAiProvider(selectProviderName);
  const confirming = useAiConversation((s) => s.pendingConfirm !== null);
  const hasRoot = useWorkspace((s) => s.root !== null);
  const text = useAiPanel((s) => s.draft);
  const setText = useAiPanel((s) => s.setDraft);
  const canSend = usable && hasRoot && !busy && !confirming && text.trim().length > 0;
  const own = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = own.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, MAX_INPUT_HEIGHT))}px`;
  }, [text]);

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
      <div className="ai-input-box">
        <textarea
          ref={(el) => {
            own.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          className="ai-input"
          aria-label="Message"
          placeholder={
            usable
              ? `Message ${providerName}… (Enter to send, uses tokens)`
              : `${providerName} is unavailable`
          }
          title={busy ? 'Escape stops the answer; press it again to close the chat' : undefined}
          value={text}
          rows={1}
          disabled={!usable || !hasRoot || confirming}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <CancelButton
            className="ai-send"
            onCancel={() => {
              void cancel();
            }}
          />
        ) : (
          <IconButton
            label={`Send (uses ${providerName})`}
            className="ai-send"
            type="submit"
            disabled={!canSend}
          >
            <Send aria-hidden />
            <AiMark />
          </IconButton>
        )}
      </div>
    </form>
  );
});
