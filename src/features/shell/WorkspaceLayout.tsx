import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { MIN_RIGHT_PANEL_WIDTH, MIN_SIDEBAR_WIDTH, useWorkspace } from '../../stores/workspace';
import './shell.css';
import './views.css';

/**
 * The user is resizing a panel: a sash is dragged, or focused (arrow keys). Other size changes
 * come from the layout itself (the window got smaller) and are not the user's width.
 */
const userResizing = (): boolean =>
  document.querySelector('.sash[data-separator="active"]') !== null ||
  (document.activeElement?.classList.contains('sash') ?? false);

/**
 * A panel whose width the store keeps (the user's width, saved in the session).
 * - A drag reports each width to the store; handing that width back as `defaultSize` made the
 *   group lay itself out again and ended the drag after its first step. So `defaultSize` is the
 *   width when the panel is shown.
 * - A width that changes elsewhere (a restored session) is applied with `resize`, and so is the
 *   stored width after the window changes size (the group would otherwise keep a percentage).
 */
function useStoredWidth(widthPx: number, shown: boolean) {
  const panelRef = usePanelRef();
  const [defaultSize, setDefaultSize] = useState(widthPx);
  const [wasShown, setWasShown] = useState(shown);
  if (shown !== wasShown) {
    setWasShown(shown);
    if (shown) setDefaultSize(widthPx);
  }
  useEffect(() => {
    if (!shown) return;
    const apply = () => {
      const panel = panelRef.current;
      if (!panel) return;
      let size: number;
      try {
        size = panel.getSize().inPixels;
      } catch {
        // Just shown: the group has not laid it out yet, and it starts at `defaultSize`.
        return;
      }
      // 0: collapsed or not laid out; resizing would reopen or collapse it on its own.
      if (size > 0 && Math.abs(size - widthPx) >= 1) panel.resize(widthPx);
    };
    apply();
    // After the group has followed the window: the width the constraints allow.
    let frame = 0;
    const onWindow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    window.addEventListener('resize', onWindow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onWindow);
    };
  }, [panelRef, widthPx, shown]);
  return { panelRef, defaultSize };
}

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
  const sidebarSize = useStoredWidth(widthPx, visible);
  const rightSize = useStoredWidth(rightWidthPx, rightVisible);

  return (
    <div className="workspace-row">
      {activityBar}
      <Group orientation="horizontal" className="workspace">
        {visible && (
          <>
            <Panel
              id="sidebar"
              panelRef={sidebarSize.panelRef}
              defaultSize={sidebarSize.defaultSize}
              minSize={MIN_SIDEBAR_WIDTH}
              maxSize="60%"
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => {
                if (userResizing()) setWidth(size.inPixels);
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
              panelRef={rightSize.panelRef}
              defaultSize={rightSize.defaultSize}
              minSize={MIN_RIGHT_PANEL_WIDTH}
              maxSize="50%"
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => {
                // Dragging the panel closed hides it, like the toggle.
                if (size.inPixels < 1) setRightVisible(false);
                else if (userResizing()) setRightWidth(size.inPixels);
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
