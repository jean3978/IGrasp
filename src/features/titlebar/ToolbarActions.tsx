import { Bell, BellOff, FolderOpen, PanelLeft, PanelRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';
import { actions, runAction } from './menuActions';
import type { ActionId } from './menuActions';
import { ThemeMenu } from './ThemeMenu';

function ActionButton({
  id,
  label,
  pressed,
  children,
}: {
  id: ActionId;
  label?: string;
  pressed?: boolean;
  children: ReactNode;
}) {
  const action = actions[id];
  return (
    <IconButton
      label={label ?? action.label}
      {...(action.shortcut ? { shortcut: action.shortcut } : {})}
      {...(pressed === undefined ? {} : { pressed })}
      onClick={() => {
        runAction(id);
      }}
    >
      {children}
    </IconButton>
  );
}

export function ToolbarActions() {
  const sidebarVisible = useWorkspace((s) => s.sidebar.visible);
  const rightPanelVisible = useWorkspace((s) => s.rightPanel.visible);
  const hasRoot = useWorkspace((s) => s.root !== null);
  const muted = useSettings((s) => s.settings.toastsMuted);

  return (
    <div className="toolbar" role="toolbar" aria-label="Window toolbar">
      <ActionButton id="file.openFolder" label="Open Folder">
        <FolderOpen aria-hidden />
      </ActionButton>
      <ActionButton id="view.toggleSidebar" pressed={sidebarVisible}>
        <PanelLeft aria-hidden />
      </ActionButton>
      {hasRoot && (
        <ActionButton id="view.toggleRightPanel" pressed={rightPanelVisible}>
          <PanelRight aria-hidden />
        </ActionButton>
      )}
      <ActionButton
        id="view.muteToasts"
        label={muted ? 'Unmute notifications' : 'Mute notifications'}
        pressed={muted}
      >
        {muted ? <BellOff aria-hidden /> : <Bell aria-hidden />}
      </ActionButton>
      <ThemeMenu />
    </div>
  );
}
