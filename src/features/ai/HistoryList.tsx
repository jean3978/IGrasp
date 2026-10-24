// The conversations of this folder (app data), newest first: open one to read and continue it,
// or delete it. Listing, opening and deleting never reach a provider.

import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { VirtualRows } from '../../components/VirtualRows';
import type { ConversationSummary } from '../../ipc/types';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { relativeTime } from '../../stores/recentFiles';
import { formatCount } from './usageFormat';

const tokensOf = (c: ConversationSummary) => c.usage.inputTokens + c.usage.outputTokens;

export function HistoryList() {
  const history = useAiConversation((s) => s.history);
  const currentId = useAiConversation((s) => s.id);
  const busy = useAiConversation(selectBusy);
  const loadHistory = useAiConversation((s) => s.loadHistory);
  const load = useAiConversation((s) => s.load);
  const remove = useAiConversation((s) => s.remove);
  const setHistoryOpen = useAiPanel((s) => s.setHistoryOpen);
  const [filter, setFilter] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  // Relative dates are computed when the list is shown.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const rows = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return (history ?? []).filter((c) => {
      const text = `${c.title} ${c.model}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [history, filter]);

  const open = (c: ConversationSummary) => {
    if (busy) return;
    void load(c.id).then(() => {
      setHistoryOpen(false);
    });
  };

  return (
    <div className="ai-history" aria-label="Conversation history">
      <input
        className="text-input ai-history-filter"
        type="search"
        aria-label="Filter conversations"
        placeholder="Filter conversations"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
        }}
      />
      {busy && <p className="ai-history-note">Stop the running answer to open another one.</p>}
      <VirtualRows<ConversationSummary>
        items={rows}
        getKey={(c) => c.id}
        label="Conversations"
        className="ai-history-list"
        rowHeight={44}
        rowClass={(c) => (c.id === currentId ? 'ai-history-current' : undefined)}
        rowProps={(c) => ({
          role: 'option',
          'aria-selected': c.id === currentId,
          'aria-label': c.title,
        })}
        emptyMessage={
          history === null
            ? 'Loading…'
            : filter
              ? 'No conversation matches.'
              : 'No conversation in this folder yet.'
        }
        onActivate={open}
        onRowKey={(e, c) => {
          if (e.key === 'Delete') {
            if (confirming === c.id) void remove(c.id);
            else setConfirming(c.id);
            return true;
          }
          if (e.key === 'Escape' && confirming !== null) {
            e.stopPropagation();
            setConfirming(null);
            return true;
          }
          return false;
        }}
        renderRow={(c) => (
          <div className="ai-history-row">
            <div className="ai-history-text">
              <span className="ai-history-title">{c.title}</span>
              <span className="list-meta">
                {relativeTime(c.updatedMs, now)}
                {c.model ? ` · ${c.model}` : ''}
                {tokensOf(c) > 0 ? ` · ${formatCount(tokensOf(c))} tokens` : ''}
              </span>
            </div>
            {confirming === c.id ? (
              <span className="ai-history-confirm">
                <Button
                  variant="primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirming(null);
                    void remove(c.id);
                  }}
                >
                  Delete
                </Button>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirming(null);
                  }}
                >
                  Keep
                </Button>
              </span>
            ) : (
              <IconButton
                label={`Delete "${c.title}"`}
                className="ai-history-delete"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(c.id);
                }}
              >
                <Trash2 aria-hidden />
              </IconButton>
            )}
          </div>
        )}
      />
    </div>
  );
}
