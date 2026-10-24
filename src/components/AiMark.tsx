import { Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { useAiProvider } from '../stores/aiProvider';
import { useSettings } from '../stores/settings';
import './aiMark.css';

/** `uses`: the control spends tokens. `feature`: it opens the AI feature, which is free. */
export type AiMarkVariant = 'uses' | 'feature';

/**
 * The small sparkle that tells the user a control belongs to the AI feature. The provider's
 * name comes from its status (or, before the first check, from the provider list, which never
 * probes anything), so no provider is named in code.
 */
export function AiMark({ variant = 'uses' }: { variant?: AiMarkVariant }) {
  const statusName = useAiProvider((s) => s.status?.displayName);
  const providers = useAiProvider((s) => s.providers);
  const providerId = useSettings((s) => s.settings.ai.provider);
  const loadProviders = useAiProvider((s) => s.loadProviders);
  useEffect(() => {
    if (providers === null) void loadProviders();
  }, [providers, loadProviders]);
  const name = statusName ?? providers?.find((p) => p.id === providerId)?.displayName;
  const tooltip =
    variant === 'feature'
      ? `Opening the chat is free; sending a message uses ${name ?? 'AI'}`
      : name
        ? `Uses AI (${name})`
        : 'Uses AI';
  return (
    <span
      className="ai-mark"
      role="img"
      aria-label="Uses AI"
      title={tooltip}
      data-ai-mark={variant}
    >
      <Sparkles aria-hidden />
    </span>
  );
}
