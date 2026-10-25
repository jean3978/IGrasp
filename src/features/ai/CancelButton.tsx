// Props only (no store): Stop for a running AI operation, wherever it is shown.

import { Square } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';

export interface CancelButtonProps {
  onCancel: () => void;
  /** Accessible name and tooltip. */
  label?: string;
  /** `inline` is a small text button for the status bar; `icon` fits the composer. */
  variant?: 'icon' | 'inline';
  className?: string;
}

export function CancelButton({
  onCancel,
  label = 'Stop',
  variant = 'icon',
  className,
}: CancelButtonProps) {
  if (variant === 'inline') {
    return (
      <button
        type="button"
        className={`statusbar-item statusbar-button ${className ?? ''}`.trim()}
        aria-label={label}
        title={label}
        onClick={onCancel}
      >
        <Square aria-hidden />
        {label}
      </button>
    );
  }
  return (
    <IconButton label={label} {...(className ? { className } : {})} onClick={onCancel}>
      <Square aria-hidden />
    </IconButton>
  );
}
