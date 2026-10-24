import type { ReactNode } from 'react';
import type { SidebarView } from '../../ipc/types';
import { useWorkspace } from '../../stores/workspace';
import { SIDEBAR_PANEL_ID, VIEW_TITLES } from './sidebarViews';

/** Renders the view selected in the activity bar. */
export function SidebarHost({ views }: { views: Record<SidebarView, ReactNode> }) {
  const view = useWorkspace((s) => s.sidebar.view);
  return (
    <aside className="sidebar" id={SIDEBAR_PANEL_ID} role="tabpanel" aria-label={VIEW_TITLES[view]}>
      {views[view]}
    </aside>
  );
}
