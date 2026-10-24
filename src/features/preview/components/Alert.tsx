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

export function Alert({ type, children }: { type: AlertType; children: ReactNode }) {
  const Icon = ICONS[type];
  return (
    <div className={`markdown-alert markdown-alert-${type}`} role="note">
      <Icon className="markdown-alert-icon" aria-hidden />
      <div className="markdown-alert-body">{children}</div>
    </div>
  );
}
