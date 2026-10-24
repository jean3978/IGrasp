import { useEffect, useState } from 'react';
import { Tooltip } from 'radix-ui';
import { backend } from './ipc/client';
import { AboutDialog } from './features/about/AboutDialog';
import { ExplorerPanel } from './features/explorer/ExplorerPanel';
import { BrokenLinksPanel } from './features/links/BrokenLinksPanel';
import { RecentChangesPanel } from './features/recent/RecentChangesPanel';
import { SearchPanel } from './features/search/SearchPanel';
import { PanelSection, RightPanel } from './features/rightpanel/RightPanel';
import { ActivityBar } from './features/shell/ActivityBar';
import { SidebarHost } from './features/shell/SidebarHost';
import { StatusBar } from './features/shell/StatusBar';
import { WorkspaceLayout } from './features/shell/WorkspaceLayout';
import { useAppearance } from './features/shell/useAppearance';
import { useGlobalShortcuts } from './features/shortcuts/useGlobalShortcuts';
import { SplashOverlay } from './features/splash/SplashOverlay';
import { TabBar } from './features/tabs/TabBar';
import { TabContent } from './features/tabs/TabContent';
import { ToastHost } from './features/toasts/ToastHost';
import { ResizeHandles } from './features/titlebar/ResizeHandles';
import { TitleBar } from './features/titlebar/TitleBar';
import { WelcomeScreen } from './features/welcome/WelcomeScreen';
import { platform } from './lib/platform';
import { startEventBridge } from './stores/eventBridge';
import { flushSession, startSessionSync } from './stores/session';
import { useSettings } from './stores/settings';
import { fileName, selectActiveTab, tabLabel, useTabs } from './stores/tabs';
import { useWorkspace } from './stores/workspace';
import './features/shell/shell.css';

function useWindowTitle(): string {
  const root = useWorkspace((s) => s.root);
  const tab = useTabs(selectActiveTab);
  const tabs = useTabs((s) => s.tabs);
  if (!root) return 'IGrasp';
  if (!tab) return `${root.name} — IGrasp`;
  const name = tab.relPath ? fileName(tab.relPath) : tabLabel(tab, tabs).title;
  return `${name} — ${root.name} — IGrasp`;
}

export function App() {
  useAppearance();
  useGlobalShortcuts();
  const load = useSettings((s) => s.load);
  const nativeFrame = useSettings((s) => s.settings.windowFrame === 'native');
  const root = useWorkspace((s) => s.root);
  const activePath = useTabs((s) => selectActiveTab(s)?.relPath ?? null);
  const openDocument = useTabs((s) => s.openDocument);
  const hasTabs = useTabs((s) => s.tabs.length > 0);
  const title = useWindowTitle();
  const [ready, setReady] = useState(false);

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

  // Save the session as it changes, and once more when the window closes.
  useEffect(() => {
    const stopSync = startSessionSync();
    let offClose: (() => void) | undefined;
    let cancelled = false;
    void backend.window.onCloseRequested(flushSession).then((off) => {
      if (cancelled) off();
      else offClose = off;
    });
    return () => {
      cancelled = true;
      stopSync();
      offClose?.();
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

  // "Native window frame" setting: let the OS draw the title bar and borders.
  useEffect(() => {
    if (ready) void backend.window.setDecorations(nativeFrame);
  }, [ready, nativeFrame]);

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
              activityBar={<ActivityBar />}
              sidebar={
                <SidebarHost
                  views={{
                    explorer: <ExplorerPanel activePath={activePath} onOpen={openDocument} />,
                    search: <SearchPanel />,
                    recent: <RecentChangesPanel />,
                    broken: <BrokenLinksPanel />,
                  }}
                />
              }
              main={
                <>
                  <TabBar />
                  <TabContent />
                </>
              }
              rightPanel={
                <RightPanel>
                  <PanelSection title="Outline" grow>
                    <div className="panel-empty">No headings.</div>
                  </PanelSection>
                  <PanelSection title="Backlinks">
                    <div className="panel-empty">No other document links here.</div>
                  </PanelSection>
                </RightPanel>
              }
            />
          ) : hasTabs ? (
            // Settings and the shortcuts reference also work without an open folder.
            <main className="main standalone" id="main-content">
              <TabBar />
              <TabContent />
            </main>
          ) : (
            <WelcomeScreen />
          )}
        </div>
        <StatusBar />
        {platform === 'linux' && !nativeFrame && <ResizeHandles />}
      </div>
      <ToastHost />
      <AboutDialog />
      <SplashOverlay ready={ready} />
    </Tooltip.Provider>
  );
}
