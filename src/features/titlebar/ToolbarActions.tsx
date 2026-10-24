import { PanelLeft } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';
import { useWorkspace } from '../../stores/workspace';
import { actions, runAction } from './menuActions';
import { ThemeMenu } from './ThemeMenu';

export function ToolbarActions() {
  const sidebarVisible = useWorkspace((s) => s.sidebar.visible);

  return (
    <div className="toolbar" role="toolbar" aria-label="Window toolbar">
      <IconButton
        label={actions['view.toggleSidebar'].label}
        {...(actions['view.toggleSidebar'].shortcut
          ? { shortcut: actions['view.toggleSidebar'].shortcut }
          : {})}
        pressed={sidebarVisible}
        onClick={() => {
          runAction('view.toggleSidebar');
        }}
      >
        <PanelLeft aria-hidden />
      </IconButton>
      <ThemeMenu />
    </div>
  );
}
