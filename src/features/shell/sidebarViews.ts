import type { SidebarView } from '../../ipc/types';

export const VIEW_TITLES: Record<SidebarView, string> = {
  explorer: 'Explorer',
  search: 'Search',
  recent: 'Recent Changes',
  broken: 'Broken Links',
};

/** DOM id of the sidebar panel, controlled by the activity bar tabs. */
export const SIDEBAR_PANEL_ID = 'sidebar-view';
