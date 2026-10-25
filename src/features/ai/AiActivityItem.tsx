// The status bar item shown while an AI operation runs and the chat is closed: the operation
// belongs to the user's action, not to the window, so it stays visible and stoppable.

import { LoaderCircle } from 'lucide-react';
import { selectProviderName, useAiProvider } from '../../stores/aiProvider';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { CancelButton } from './CancelButton';
import { focusReview } from './reviewFocus';
import './ai.css';

export function AiActivityItem() {
  const open = useAiPanel((s) => s.open);
  const busy = useAiConversation(selectBusy);
  const providerName = useAiProvider(selectProviderName);
  const waiting = useAiConversation((s) => s.permissions.length);
  const setOpen = useAiPanel((s) => s.setOpen);
  const cancel = useAiConversation((s) => s.cancel);
  const confirming = useAiConversation((s) => s.pendingConfirm !== null);
  // A markdown edit under review: the item leads to the review instead of the chat.
  const reviewing = useAiConversation((s) => s.pendingReview?.status === 'ready');
  const showReview = useAiConversation((s) => s.showReview);
  if (open || (!busy && !confirming)) return null;
  return (
    <span className="statusbar-item ai-activity">
      <button
        type="button"
        className="statusbar-item statusbar-button"
        title={reviewing ? 'Show the proposed edit' : 'Open the chat'}
        onClick={() => {
          if (reviewing) {
            showReview();
            focusReview();
          } else setOpen(true);
        }}
      >
        <LoaderCircle className={busy ? 'spin' : ''} aria-hidden />
        {busy ? `${providerName} is working…` : 'Waiting for your confirmation'}
        {/* Part of the button's name; `AiAnnouncer` announces new requests. */}
        {waiting > 0 && <span className="visually-hidden">, </span>}
        {waiting > 0 && (
          <span className="ai-activity-badge">
            {reviewing
              ? waiting === 1
                ? '1 edit to review'
                : `1 edit to review, ${String(waiting - 1)} more waiting`
              : waiting === 1
                ? '1 permission waiting'
                : `${String(waiting)} permissions waiting`}
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
