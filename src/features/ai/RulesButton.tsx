// The panel header's "Rules" popover: what "Allow for this conversation" allowed so far, each
// with a ✕. Shown only while the conversation has rules; New conversation clears them.

import { ShieldCheck, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { IconButton } from '../../components/ui/IconButton';
import { useAiConversation } from '../../stores/aiConversation';
import { KIND_LABEL } from './permissionKinds';

export function RulesButton() {
  const rules = useAiConversation((s) => s.rules);
  const removeRule = useAiConversation((s) => s.removeRule);
  if (rules.length === 0) return null;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton label={`Rules of this conversation (${String(rules.length)})`}>
          <ShieldCheck aria-hidden />
          <span className="ai-rules-count">{rules.length}</span>
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ai-rules-popover"
          side="bottom"
          align="end"
          sideOffset={4}
          aria-label="Rules of this conversation"
          onKeyDown={(e) => {
            // Escape closes the popover only, not the panel behind it.
            if (e.key === 'Escape') e.stopPropagation();
          }}
        >
          <p className="ai-rules-title">Allowed without asking until New conversation</p>
          <ul className="ai-rules-list">
            {rules.map((rule) => (
              <li key={`${rule.tool}:${rule.kind}`}>
                <span>
                  <strong>{rule.tool}</strong> · {KIND_LABEL[rule.kind]}
                </span>
                <IconButton
                  label={`Stop allowing ${rule.tool}`}
                  onClick={() => {
                    removeRule(rule);
                  }}
                >
                  <X aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
