// The status bar item shown while an AI operation runs and the chat is closed: the operation
// belongs to the user's action, not to the window, so it stays visible and stoppable.

import { LoaderCircle } from 'lucide-react';
import { selectProviderName, useAiProvider } from '../../stores/aiProvider';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { CancelButton } from './CancelButton';
import './ai.css';

export function AiActivityItem() {
  const open = useAiPanel((s) => s.open);
  const busy = useAiConversation(selectBusy);
  const providerName = useAiProvider(selectProviderName);
  const waiting = useAiConversation((s) => s.permissions.length);
  const setOpen = useAiPanel((s) => s.setOpen);
  const cancel = useAiConversation((s) => s.cancel);
  const confirming = useAiConversation((s) => s.pendingConfirm !== null);
  if (open || (!busy && !confirming)) return null;
  return (
    <span className="statusbar-item ai-activity">
      <button
        type="button"
        className="statusbar-item statusbar-button"
        title="Open the chat"
        onClick={() => {
          setOpen(true);
        }}
      >
        <LoaderCircle className={busy ? 'spin' : ''} aria-hidden />
        {busy ? `${providerName} is working…` : 'Waiting for your confirmation'}
        {waiting > 0 && (
          <span className="ai-activity-badge" role="status">
            {waiting === 1 ? '1 permission waiting' : `${String(waiting)} permissions waiting`}
          </span>
        )}
      </button>
      {busy && (
        <CancelButton
          variant="inline"
          onCancel={() => {
            void cancel();
          }}
        />
      )}
    </span>
  );
}
