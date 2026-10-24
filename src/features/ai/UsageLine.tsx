// Props only (no store): the chat, the quiz and the tutorials show the same usage line.

import { usageText } from './usageFormat';
import type { UsageValues } from './usageFormat';

export type UsageLineProps = UsageValues;

export function UsageLine(props: UsageLineProps) {
  return (
    <div className="ai-usage" role="status">
      {usageText(props)}
    </div>
  );
}
