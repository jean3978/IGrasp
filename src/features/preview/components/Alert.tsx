import { Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AlertType } from '../pipeline/alerts';

const ICONS: Record<AlertType, typeof Info> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
};

export function Alert({
  type,
  line,
  children,
}: {
  type: AlertType;
  /** Source line the block starts on (`data-line`, for scroll-to-line and region capture). */
  line?: number;
  children: ReactNode;
}) {
  const Icon = ICONS[type];
  return (
    <div
      className={`markdown-alert markdown-alert-${type}`}
      role="note"
      {...(line === undefined ? {} : { 'data-line': line })}
    >
      <Icon className="markdown-alert-icon" aria-hidden />
      <div className="markdown-alert-body">{children}</div>
    </div>
  );
}
