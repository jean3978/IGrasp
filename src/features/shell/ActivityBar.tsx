import { clsx } from 'clsx';
import { Files, History, Search, Unlink } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useRef } from 'react';
import { Tooltip } from 'radix-ui';
import type { SidebarView } from '../../ipc/types';
import { useWorkspace } from '../../stores/workspace';
import { actions } from '../titlebar/menuActions';
import type { ActionId } from '../titlebar/menuActions';
import { SIDEBAR_PANEL_ID, VIEW_TITLES } from './sidebarViews';

interface ViewDef {
  view: SidebarView;
  action: ActionId;
  icon: ReactNode;
}

const SIDEBAR_VIEWS: ViewDef[] = [
  { view: 'explorer', action: 'view.focusExplorer', icon: <Files aria-hidden /> },
  { view: 'search', action: 'view.search', icon: <Search aria-hidden /> },
  { view: 'recent', action: 'view.recent', icon: <History aria-hidden /> },
  { view: 'broken', action: 'view.broken', icon: <Unlink aria-hidden /> },
];

interface ActivityBarProps {
  /** Small counters or spinners shown on the icons, by view. */
  badges?: Partial<Record<SidebarView, ReactNode>>;
}

/** VS Code-style vertical bar switching the view shown in the sidebar. */
export function ActivityBar({ badges = {} }: ActivityBarProps) {
  const current = useWorkspace((s) => s.sidebar.view);
  const toggle = useWorkspace((s) => s.toggleSidebarView);
  const ref = useRef<HTMLDivElement>(null);

  // Arrow keys move between views (tabs pattern, vertical); Enter or Space activates.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLElement>('[role=tab]') ?? [])];
    const index = buttons.findIndex((b) => b === document.activeElement);
    if (index < 0) return;
    let target: number | null = null;
    if (e.key === 'ArrowDown') target = (index + 1) % buttons.length;
    if (e.key === 'ArrowUp') target = (index - 1 + buttons.length) % buttons.length;
    if (e.key === 'Home') target = 0;
    if (e.key === 'End') target = buttons.length - 1;
    if (target === null) return;
    e.preventDefault();
    buttons[target]?.focus();
  };

  return (
    <div
      ref={ref}
      className="activity-bar"
      role="tablist"
      aria-orientation="vertical"
      aria-label="Sidebar views"
      onKeyDown={onKeyDown}
    >
      {SIDEBAR_VIEWS.map(({ view, action, icon }) => {
        const selected = view === current;
        const shortcut = actions[action].shortcut;
        return (
          <Tooltip.Root key={view}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={SIDEBAR_PANEL_ID}
                aria-label={VIEW_TITLES[view]}
                tabIndex={selected ? 0 : -1}
                className={clsx('activity-item', { 'activity-item-active': selected })}
                onClick={() => {
                  toggle(view);
                }}
              >
                {icon}
                {badges[view]}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip" side="right" sideOffset={4}>
                {VIEW_TITLES[view]}
                {shortcut && <kbd className="tooltip-shortcut">{shortcut}</kbd>}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        );
      })}
    </div>
  );
}
