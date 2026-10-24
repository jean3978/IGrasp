import { useEffect } from 'react';
import { backend } from '../../ipc/client';
import { useSettings } from '../../stores/settings';
import { AppLogo } from '../splash/AppLogo';
import { MenuBar } from './MenuBar';
import { ToolbarActions } from './ToolbarActions';
import { useWindowFocused } from './useWindowState';
import { WindowControls } from './WindowControls';
import './titlebar.css';

export function TitleBar({ title }: { title: string }) {
  const focused = useWindowFocused();
  const nativeFrame = useSettings((s) => s.settings.windowFrame === 'native');

  useEffect(() => {
    void backend.window.setTitle(title);
  }, [title]);

  return (
    <header
      className="titlebar"
      data-inactive={focused ? undefined : ''}
      data-tauri-drag-region={nativeFrame ? undefined : ''}
    >
      <div className="titlebar-start">
        <AppLogo className="titlebar-logo" variant="mono" />
        <MenuBar />
      </div>
      <div className="titlebar-title" data-tauri-drag-region={nativeFrame ? undefined : ''}>
        {title}
      </div>
      <div className="titlebar-end">
        <ToolbarActions />
        {!nativeFrame && <WindowControls />}
      </div>
    </header>
  );
}
