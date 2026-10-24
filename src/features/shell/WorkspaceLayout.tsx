import { Group, Panel, Separator } from 'react-resizable-panels';
import type { ReactNode } from 'react';
import { MIN_RIGHT_PANEL_WIDTH, MIN_SIDEBAR_WIDTH, useWorkspace } from '../../stores/workspace';
import './shell.css';
import './views.css';

interface WorkspaceLayoutProps {
  /** Always shown at the far left, even when the sidebar is hidden (like VS Code). */
  activityBar: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
  rightPanel: ReactNode;
}

export function WorkspaceLayout({ activityBar, sidebar, main, rightPanel }: WorkspaceLayoutProps) {
  const visible = useWorkspace((s) => s.sidebar.visible);
  const widthPx = useWorkspace((s) => s.sidebar.widthPx);
  const setWidth = useWorkspace((s) => s.setSidebarWidth);
  const rightVisible = useWorkspace((s) => s.rightPanel.visible);
  const rightWidthPx = useWorkspace((s) => s.rightPanel.widthPx);
  const setRightWidth = useWorkspace((s) => s.setRightPanelWidth);
  const setRightVisible = useWorkspace((s) => s.setRightPanelVisible);

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
        {rightVisible && (
          <>
            <Separator className="sash" aria-label="Resize the right panel" />
            <Panel
              id="right"
              defaultSize={rightWidthPx}
              minSize={MIN_RIGHT_PANEL_WIDTH}
              maxSize="50%"
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => {
                // Dragging the panel closed hides it, like the toggle.
                if (size.inPixels < 1) setRightVisible(false);
                else setRightWidth(size.inPixels);
              }}
            >
              {rightPanel}
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}
