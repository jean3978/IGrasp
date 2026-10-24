import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import './rightpanel.css';

interface SectionProps {
  title: string;
  /** Shown after the title, e.g. a count. */
  badge?: ReactNode;
  /** Icon buttons shown on the right of the header. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** Takes the remaining height when open (the other sections keep their content height). */
  grow?: boolean;
  children: ReactNode;
}

/** A collapsible section of the right panel, with a chevron header like VS Code's views. */
export function PanelSection({
  title,
  badge,
  actions,
  defaultOpen = true,
  grow = false,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section
      className={clsx('panel-section', { 'panel-section-grow': grow && open })}
      aria-label={title}
    >
      <div className="panel-section-header">
        <button
          type="button"
          className="panel-section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <ChevronRight className={clsx('panel-chevron', { open })} aria-hidden />
          <span className="panel-section-title">{title}</span>
          {badge !== undefined && <span className="panel-section-badge">{badge}</span>}
        </button>
        {open && actions && <div className="panel-section-actions">{actions}</div>}
      </div>
      {open && (
        <div className="panel-section-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

/** The right panel: sections about the active document (Outline, Backlinks). */
export function RightPanel({ children }: { children: ReactNode }) {
  return (
    <aside className="right-panel" aria-label="Document panel">
      {children}
    </aside>
  );
}
