// Props only (no store): the chat, the quiz and the tutorials show the same usage line.

import { usageText } from './usageFormat';
import type { UsageValues } from './usageFormat';

export type UsageLineProps = UsageValues;

export function UsageLine(props: UsageLineProps) {
  // Not a live region: the chat's `AiAnnouncer` reads it once when the answer ends.
  return <div className="ai-usage">{usageText(props)}</div>;
}
