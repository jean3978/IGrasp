import { useEffect } from 'react';
import { Tooltip } from 'radix-ui';
import { StatusBar } from './features/shell/StatusBar';
import { WorkspaceLayout } from './features/shell/WorkspaceLayout';
import { useAppearance } from './features/shell/useAppearance';
import { ResizeHandles } from './features/titlebar/ResizeHandles';
import { TitleBar } from './features/titlebar/TitleBar';
import { platform } from './lib/platform';
import { useSettings } from './stores/settings';
import './features/shell/shell.css';

export function App() {
  useAppearance();
  const load = useSettings((s) => s.load);
  const nativeFrame = useSettings((s) => s.settings.windowFrame === 'native');

  useEffect(() => {
    load().catch((err: unknown) => {
      console.error('Cannot load settings', err);
    });
  }, [load]);

  return (
    <Tooltip.Provider delayDuration={600}>
      <div className="app">
        <a className="skip-link" href="#main-content">
          Skip to document
        </a>
        <TitleBar title="IGrasp" />
        <div className="app-body">
          <WorkspaceLayout sidebar={null} main={<h1>IGrasp</h1>} />
        </div>
        <StatusBar />
        {platform === 'linux' && !nativeFrame && <ResizeHandles />}
      </div>
    </Tooltip.Provider>
  );
}
