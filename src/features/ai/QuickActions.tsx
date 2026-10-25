// The quick actions over the message box while the chat is about a selection: each sends one
// message with the selection attached (a user action that spends tokens).

import { AiMark } from '../../components/AiMark';
import { useAiPanel } from '../../stores/aiPanel';
import { selectProviderName, selectUsable, useAiProvider } from '../../stores/aiProvider';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import { useWorkspace } from '../../stores/workspace';
import { DRAFT_PREFIX, TEXT_DRAFT_PREFIX } from '../capture/capture';
import { QUICK_ACTIONS } from './quickActionPrompts';
import { useSelectionCapture } from './selectionText';

export function QuickActions() {
  const capture = useSelectionCapture();
  const send = useAiConversation((s) => s.send);
  const busy = useAiConversation(selectBusy);
  const confirming = useAiConversation((s) => s.pendingConfirm !== null);
  const usable = useAiProvider(selectUsable);
  const providerName = useAiProvider(selectProviderName);
  const hasRoot = useWorkspace((s) => s.root !== null);
  if (!capture) return null;
  const disabled = busy || confirming || !usable || !hasRoot;
  return (
    <div className="ai-quick-actions" role="group" aria-label="Quick actions on the selection">
      <AiMark />
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          className="ai-quick"
          disabled={disabled}
          title={`${action.label} the selection (sends a message to ${providerName})`}
          onClick={() => {
            const panel = useAiPanel.getState();
            // A selection already sent goes again with the action: the action is about it.
            if (!panel.attachment) panel.setAttachment({ capture });
            if ([DRAFT_PREFIX, TEXT_DRAFT_PREFIX].includes(panel.draft.trim())) panel.setDraft('');
            void send(action.prompt, action.label);
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
