// Puts the three AI stores back to their state at startup (tests only).

import { useAiConversation } from '../stores/aiConversation';
import { useAiPanel } from '../stores/aiPanel';
import { useAiProvider } from '../stores/aiProvider';

export function resetAiStores(): void {
  useAiProvider.setState({
    status: null,
    capabilities: null,
    checking: false,
    providers: null,
    model: '',
    defaultModel: '',
  });
  useAiConversation.setState({
    id: null,
    createdMs: 0,
    items: [],
    resumeId: null,
    sessionModel: '',
    usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
    operationId: null,
    starting: false,
    pendingConfirm: null,
    buffered: [],
    permissions: [],
    history: null,
  });
  useAiPanel.setState({ open: false, rect: null, draft: '', historyOpen: false });
}
