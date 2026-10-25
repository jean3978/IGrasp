// The provider's status: version and account, or the problem with its own help and Check again.
// Shared by the chat panel (a one-line subtitle under its title, and the problem block under
// the header) and the AI section of the settings.

import { clsx } from 'clsx';
import { RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useAiProvider } from '../../stores/aiProvider';
import { useAiConversation } from '../../stores/aiConversation';
import './ai.css';

export function StatusLine({
  showSession = true,
  showCheckAgain = false,
  part = 'all',
}: {
  /** Shows the conversation's session and token totals (the chat panel). */
  showSession?: boolean;
  /** Offers Check again even when the provider is fine (the settings page). */
  showCheckAgain?: boolean;
  /** `summary`: the one-line subtitle of the chat. `problem`: only what is missing. */
  part?: 'all' | 'summary' | 'problem';
}) {
  const status = useAiProvider((s) => s.status);
  const checking = useAiProvider((s) => s.checking);
  const checkStatus = useAiProvider((s) => s.checkStatus);
  const resumeId = useAiConversation((s) => s.resumeId);
  const sessionModel = useAiConversation((s) => s.sessionModel);
  const usage = useAiConversation((s) => s.usage);
  const checkAgain = (
    <Button
      onClick={() => {
        void checkStatus(true);
      }}
      disabled={checking}
    >
      <RefreshCw aria-hidden /> Check again
    </Button>
  );

  if (part === 'summary') {
    if (!status) {
      return <span className="ai-subtitle">{checking ? 'Checking…' : ''}</span>;
    }
    if (status.problem !== null) {
      return <span className="ai-subtitle ai-subtitle-problem">Unavailable</span>;
    }
    const tokens = usage.inputTokens + usage.outputTokens;
    const details = [
      status.version,
      status.account ?? 'signed in',
      `session ${resumeId ? resumeId.slice(0, 8) : 'new'}`,
      tokens > 0 ? `${String(tokens)} tokens` : null,
      usage.costUsd !== null && usage.costUsd > 0 ? `$${usage.costUsd.toFixed(4)}` : null,
    ].filter((d): d is string => d !== null && d !== '');
    const text = `${status.displayName} ${details.join(' · ')}${status.plan ? ` (${status.plan})` : ''}`;
    return (
      <span className="ai-subtitle" title={text}>
        <span className="ai-online" aria-hidden />
        {details.join(' · ')}
        {sessionModel && (
          <span className="ai-session-model" title="The model this conversation runs with">
            {` · ${sessionModel}`}
          </span>
        )}
      </span>
    );
  }

  if (checking && !status) {
    return part === 'problem' ? null : <div className="ai-status">Checking the AI provider…</div>;
  }
  if (!status) return showCheckAgain ? <div className="ai-status">{checkAgain}</div> : null;
  if (status.problem !== null) {
    return (
      <div className="ai-status ai-status-problem" role="alert">
        <p>
          {status.problem}
          {status.help ? ` ${status.help}` : ''}
        </p>
        {checkAgain}
      </div>
    );
  }
  if (part === 'problem') return null;
  const tokens = usage.inputTokens + usage.outputTokens;
  return (
    <div className={clsx('ai-status', 'ai-status-ok', { 'ai-status-row': showCheckAgain })}>
      <span>
        {status.displayName} {status.version ?? ''} · {status.account ?? 'signed in'}
        {status.plan ? ` (${status.plan})` : ''}
        {showSession && ` · session ${resumeId ? resumeId.slice(0, 8) : 'new'}`}
        {showSession && tokens > 0 ? ` · ${String(tokens)} tokens` : ''}
        {showSession && usage.costUsd !== null && usage.costUsd > 0
          ? ` · $${usage.costUsd.toFixed(4)}`
          : ''}
      </span>
      {showCheckAgain && checkAgain}
    </div>
  );
}
