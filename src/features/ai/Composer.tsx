// The message box, the model picker and Send (the only control of the panel that spends tokens)
// or Stop while an operation runs. The draft lives in the panel store so it survives closing the
// panel and can be pre-filled (region capture).

import { Send } from 'lucide-react';
import { forwardRef } from 'react';
import type { KeyboardEvent } from 'react';
import { AiMark } from '../../components/AiMark';
import { IconButton } from '../../components/ui/IconButton';
import { selectBusy, selectProviderName, selectUsable, useAi } from '../../stores/ai';
import { useAiPanel } from '../../stores/aiPanel';
import { useWorkspace } from '../../stores/workspace';
import { CancelButton } from './CancelButton';
import { ModelPicker } from './ModelPicker';

export const Composer = forwardRef<HTMLTextAreaElement>(function Composer(_props, ref) {
  const send = useAi((s) => s.send);
  const cancel = useAi((s) => s.cancel);
  const busy = useAi(selectBusy);
  const usable = useAi(selectUsable);
  const providerName = useAi(selectProviderName);
  const confirming = useAi((s) => s.pendingConfirm !== null);
  const hasRoot = useWorkspace((s) => s.root !== null);
  const text = useAiPanel((s) => s.draft);
  const setText = useAiPanel((s) => s.setDraft);
  const canSend = usable && hasRoot && !busy && !confirming && text.trim().length > 0;

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
        ref={ref}
        className="ai-input"
        aria-label="Message"
        placeholder={
          usable
            ? `Ask ${providerName} about this project… (Enter to send, uses tokens)`
            : `${providerName} is unavailable`
        }
        title={busy ? 'Escape stops the answer; press it again to close the chat' : undefined}
        value={text}
        rows={2}
        disabled={!usable || !hasRoot || confirming}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="ai-composer-actions">
        <ModelPicker />
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
