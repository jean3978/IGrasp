import type { ReactNode } from 'react';
import { THEME_OPTIONS } from '../titlebar/menuActions';
import { useSettings } from '../../stores/settings';

export function StatusBar({ start }: { start?: ReactNode }) {
  const theme = useSettings((s) => s.settings.theme);
  const themeLabel = THEME_OPTIONS.find((o) => o.value === theme)?.label ?? theme;

  return (
    <footer className="statusbar" aria-label="Status bar">
      <div className="statusbar-start">{start}</div>
      <div className="statusbar-end">
        <span className="statusbar-item">{themeLabel}</span>
      </div>
    </footer>
  );
}
