import { Group, Panel, Separator } from 'react-resizable-panels';
import type { ReactNode } from 'react';
import { MIN_SIDEBAR_WIDTH, useWorkspace } from '../../stores/workspace';
import './shell.css';

interface WorkspaceLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export function WorkspaceLayout({ sidebar, main }: WorkspaceLayoutProps) {
  const visible = useWorkspace((s) => s.sidebar.visible);
  const widthPx = useWorkspace((s) => s.sidebar.widthPx);
  const setWidth = useWorkspace((s) => s.setSidebarWidth);

  return (
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
            <aside className="sidebar" aria-label="Explorer">
              {sidebar}
            </aside>
          </Panel>
          <Separator className="sash" />
        </>
      )}
      <Panel id="main" minSize={300}>
        <main className="main" id="main-content">
          {main}
        </main>
      </Panel>
    </Group>
  );
}
