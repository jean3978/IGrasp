import { useEffect, useState } from 'react';
import { Tooltip } from 'radix-ui';
import { backend } from './ipc/client';
import { StatusBar } from './features/shell/StatusBar';
import { WorkspaceLayout } from './features/shell/WorkspaceLayout';
import { useAppearance } from './features/shell/useAppearance';
import { useGlobalShortcuts } from './features/shortcuts/useGlobalShortcuts';
import { SplashOverlay } from './features/splash/SplashOverlay';
import { ResizeHandles } from './features/titlebar/ResizeHandles';
import { TitleBar } from './features/titlebar/TitleBar';
import { WelcomeScreen } from './features/welcome/WelcomeScreen';
import { platform } from './lib/platform';
import { ExplorerPanel } from './features/explorer/ExplorerPanel';
import { startEventBridge } from './stores/eventBridge';
import { useSettings } from './stores/settings';
import { useWorkspace } from './stores/workspace';
import './features/shell/shell.css';

export function App() {
  useAppearance();
  useGlobalShortcuts();
  const load = useSettings((s) => s.load);
  const nativeFrame = useSettings((s) => s.settings.windowFrame === 'native');
  const root = useWorkspace((s) => s.root);
  const [ready, setReady] = useState(false);
  // Replaced by tabs in the next step.
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void startEventBridge().then((unsubscribe) => {
      if (cancelled) unsubscribe();
      else off = unsubscribe;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  useEffect(() => {
    load()
      .catch((err: unknown) => {
        console.error('Cannot load settings', err);
      })
      .finally(() => {
        setReady(true);
      });
  }, [load]);

  // The window starts hidden; show it once the theme is applied so it never flashes white.
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      void backend.window.show();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [ready]);

  const title = root ? `${root.name} — IGrasp` : 'IGrasp';

  return (
    <Tooltip.Provider delayDuration={600}>
      <div className="app">
        <a className="skip-link" href="#main-content">
          Skip to document
        </a>
        <TitleBar title={title} />
        <div className="app-body">
          {root ? (
            <WorkspaceLayout
              sidebar={
                <ExplorerPanel
                  activePath={selected}
                  onOpen={(path) => {
                    setSelected(path);
                  }}
                />
              }
              main={<h1>{selected ?? root.name}</h1>}
            />
          ) : (
            <WelcomeScreen />
          )}
        </div>
        <StatusBar />
        {platform === 'linux' && !nativeFrame && <ResizeHandles />}
      </div>
      <SplashOverlay ready={ready} />
    </Tooltip.Provider>
  );
}
