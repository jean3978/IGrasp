import { Group, Panel, Separator } from 'react-resizable-panels';
import type { ReactNode } from 'react';
import { MIN_SIDEBAR_WIDTH, useWorkspace } from '../../stores/workspace';
import './shell.css';
import './views.css';

interface WorkspaceLayoutProps {
  /** Always shown at the far left, even when the sidebar is hidden (like VS Code). */
  activityBar: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
}

export function WorkspaceLayout({ activityBar, sidebar, main }: WorkspaceLayoutProps) {
  const visible = useWorkspace((s) => s.sidebar.visible);
  const widthPx = useWorkspace((s) => s.sidebar.widthPx);
  const setWidth = useWorkspace((s) => s.setSidebarWidth);

  return (
    <div className="workspace-row">
      {activityBar}
      <Group orientation="horizontal" className="workspace">
        {visible && (
          <>
            <Panel
              id="sidebar"
              defaultSize={widthPx}
              minSize={MIN_SIDEBAR_WIDTH}
              maxSize="60%"
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => {
                setWidth(size.inPixels);
              }}
            >
              {sidebar}
            </Panel>
            <Separator className="sash" aria-label="Resize the sidebar" />
          </>
        )}
        <Panel id="main" minSize={300}>
          <main className="main" id="main-content">
            {main}
          </main>
        </Panel>
      </Group>
    </div>
  );
}
