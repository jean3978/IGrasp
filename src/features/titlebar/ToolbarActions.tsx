import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  FolderOpen,
  PanelLeft,
  PanelRight,
  Search,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { AiMark } from '../../components/AiMark';
import { IconButton } from '../../components/ui/IconButton';
import { selectCanGoBack, selectCanGoForward, useHistory } from '../../stores/history';
import { useSettings } from '../../stores/settings';
import { fileName } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { actions, runAction } from './menuActions';
import type { ActionId } from './menuActions';
import { ThemeMenu } from './ThemeMenu';

/** A toolbar button for an action: its label, shortcut and AI mark come from the action. */
export function ActionButton({
  id,
  label,
  pressed,
  disabled,
  className,
  children,
}: {
  id: ActionId;
  label?: string;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const action = actions[id];
  return (
    <IconButton
      {...(className ? { className } : {})}
      label={label ?? action.label}
      {...(action.shortcut ? { shortcut: action.shortcut } : {})}
      {...(pressed === undefined ? {} : { pressed })}
      disabled={disabled ?? false}
      data-action={id}
      onClick={() => {
        runAction(id);
      }}
    >
      {children}
      {(action.usesAi || action.aiFeature) && (
        <AiMark variant={action.usesAi ? 'uses' : 'feature'} />
      )}
    </IconButton>
  );
}

function HistoryButtons() {
  const canGoBack = useHistory(selectCanGoBack);
  const canGoForward = useHistory(selectCanGoForward);
  const backTo = useHistory((s) => s.entries[s.position - 1]?.relPath);
  const forwardTo = useHistory((s) => s.entries[s.position + 1]?.relPath);
  return (
    <>
      <ActionButton
        id="go.back"
        label={backTo ? `Back to ${fileName(backTo)}` : 'Back'}
        disabled={!canGoBack}
      >
        <ArrowLeft aria-hidden />
      </ActionButton>
      <ActionButton
        id="go.forward"
        label={forwardTo ? `Forward to ${fileName(forwardTo)}` : 'Forward'}
        disabled={!canGoForward}
      >
        <ArrowRight aria-hidden />
      </ActionButton>
      <span className="toolbar-separator" aria-hidden />
    </>
  );
}

export function ToolbarActions() {
  const sidebarVisible = useWorkspace((s) => s.sidebar.visible);
  const rightPanelVisible = useWorkspace((s) => s.rightPanel.visible);
  const hasRoot = useWorkspace((s) => s.root !== null);
  const muted = useSettings((s) => s.settings.toastsMuted);

  return (
    <div className="toolbar" role="toolbar" aria-label="Window toolbar">
      {hasRoot && <HistoryButtons />}
      {hasRoot && (
        <ActionButton id="go.symbol" label="Search Everything">
          <Search aria-hidden />
        </ActionButton>
      )}
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
