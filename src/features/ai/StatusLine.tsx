// The provider's status: version and account, or the problem with its own help and Check again.
// Shared by the chat panel and the AI section of the settings.

import { clsx } from 'clsx';
import { RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useAi } from '../../stores/ai';

export function StatusLine({
  showSession = true,
  showCheckAgain = false,
}: {
  /** Shows the conversation's session and token totals (the chat panel). */
  showSession?: boolean;
  /** Offers Check again even when the provider is fine (the settings page). */
  showCheckAgain?: boolean;
}) {
  const status = useAi((s) => s.status);
  const checking = useAi((s) => s.checking);
  const checkStatus = useAi((s) => s.checkStatus);
  const resumeId = useAi((s) => s.resumeId);
  const usage = useAi((s) => s.usage);
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
  if (checking && !status) return <div className="ai-status">Checking the AI provider…</div>;
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
