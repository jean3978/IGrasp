import type { ReactNode } from 'react';

interface ViewHeaderProps {
  title: string;
  /** Tooltip of the title (e.g. the folder path). */
  hint?: string | undefined;
  /** Icon buttons shown on the right. */
  actions?: ReactNode;
  actionsLabel?: string;
}

/** The header row of a sidebar or right-panel view: an upper-case title and view actions. */
export function ViewHeader({ title, hint, actions, actionsLabel }: ViewHeaderProps) {
  return (
    <div className="view-header">
      <h2 className="view-title" title={hint}>
        {title}
      </h2>
      {actions && (
        <div
          className="view-actions"
          role="toolbar"
          aria-label={actionsLabel ?? `${title} actions`}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
