// Single source of truth for user actions. Menu items, toolbar buttons and keyboard shortcuts all
// dispatch through `runAction`, so an action behaves the same wherever it is triggered from.

import { backend } from '../../ipc/client';
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../../ipc/defaults';
import type { SidebarView, Theme } from '../../ipc/types';
import { useHistory } from '../../stores/history';
import { useQuickOpen } from '../../stores/quickOpen';
import { useSearch } from '../../stores/search';
import { useRecent } from '../../stores/recent';
import { useSettings } from '../../stores/settings';
import { useTabs } from '../../stores/tabs';
import { useToasts } from '../../stores/toasts';
import { useTree } from '../../stores/tree';
import { useUi } from '../../stores/ui';
import { useWorkspace } from '../../stores/workspace';
import { useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';

export type ActionId =
  | 'file.openFolder'
  | 'file.closeFolder'
  | 'file.clearRecent'
  | 'file.settings'
  | 'file.exit'
  | 'edit.copy'
  | 'edit.selectAll'
  | 'view.toggleSidebar'
  | 'view.focusExplorer'
  | 'view.search'
  | 'view.recent'
  | 'view.broken'
  | 'view.toggleRightPanel'
  | 'view.focusOutline'
  | 'go.symbol'
  | 'search.next'
  | 'search.previous'
  | 'go.back'
  | 'go.forward'
  | 'view.showDotfiles'
  | 'view.showIgnored'
  | 'view.muteToasts'
  | 'help.shortcuts'
  | 'ai.chat'
  | 'ai.newConversation'
  | 'ai.history'
  | 'ai.acceptAllChanges'
  | 'ai.rejectAllChanges'
  | 'help.about'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.zoomReset'
  | 'tabs.close'
  | 'tabs.next'
  | 'tabs.previous'
  | 'tabs.moveLeft'
  | 'tabs.moveRight'
  | `tabs.goto${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

const activeTabId = () => useTabs.getState().activeId;

const gotoActions = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [
    `tabs.goto${String(n)}`,
    {
      label: n === 9 ? 'Go to Last Tab' : `Go to Tab ${String(n)}`,
      shortcut: `Alt+${String(n)}`,
      run: () => {
        useTabs.getState().activateIndex(n);
      },
    },
  ]),
) as Record<`tabs.goto${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`, ActionDef>;

interface ActionDef {
  label: string;
  /** Display form of the keyboard shortcut. */
  shortcut?: string;
  /** The action can start an AI operation (spends tokens): its controls show the AI marker. */
  usesAi?: boolean;
  /** The action opens the AI feature without spending anything: its controls show the marker. */
  aiFeature?: boolean;
  run(): void | Promise<void>;
}

const DEFAULT_FONT_SIZE = 16;

function setFontSize(size: number) {
  const fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
  return useSettings.getState().update({ fontSize });
}

/** Shows a sidebar view and focuses its main element once it is mounted. */
function showView(view: SidebarView, focusSelector: string) {
  if (!useWorkspace.getState().root) return;
  useWorkspace.getState().setSidebarView(view);
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`#sidebar-view ${focusSelector}`);
    (
      el ?? document.querySelector<HTMLElement>('#sidebar-view [tabindex], #sidebar-view button')
    )?.focus();
  });
}

/** The active tab shows the markdown edit under review. */
function reviewShown(): boolean {
  const review = useAiConversation.getState().pendingReview;
  const tab = useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId);
  return review?.status === 'ready' && tab?.kind === 'document' && tab.relPath === review.path;
}

/** The preview of the active tab, if any. */
const activePreview = () => document.querySelector<HTMLElement>('.tab-content .markdown-body');

export const actions: Record<ActionId, ActionDef> = {
  ...gotoActions,
  'file.settings': {
    label: 'Settings',
    shortcut: 'Ctrl+,',
    run: () => {
      useTabs.getState().openSpecial('settings');
    },
  },
  'edit.copy': {
    label: 'Copy',
    shortcut: 'Ctrl+C',
    run: async () => {
      const text = window.getSelection()?.toString() ?? '';
      if (text) await navigator.clipboard.writeText(text);
    },
  },
  'edit.selectAll': {
    label: 'Select All',
    shortcut: 'Ctrl+A',
    run: () => {
      const preview = activePreview();
      const selection = window.getSelection();
      if (!preview || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(preview);
      selection.removeAllRanges();
      selection.addRange(range);
    },
  },
  'view.focusExplorer': {
    label: 'Explorer',
    shortcut: 'Ctrl+Shift+E',
    run: () => {
      showView('explorer', '.file-tree');
    },
  },
  'view.search': {
    label: 'Search',
    shortcut: 'Ctrl+Shift+F',
    run: () => {
      // Selected text (one line) becomes the query, like VS Code.
      const selected = window.getSelection()?.toString().trim() ?? '';
      if (selected !== '' && !/[\r\n]/.test(selected) && selected.length <= 200) {
        useSearch.getState().setQuery(selected);
        void useSearch.getState().run();
      }
      showView('search', '.search-input');
    },
  },
  'view.recent': {
    label: 'Recent Changes',
    shortcut: 'Ctrl+Shift+R',
    run: () => {
      showView('recent', '.recent-list');
    },
  },
  'view.broken': {
    label: 'Broken Links',
    shortcut: 'Ctrl+Shift+L',
    run: () => {
      showView('broken', '.broken-list');
    },
  },
  'view.showDotfiles': {
    label: 'Show Dotfiles',
    run: () => useTree.getState().setShowDotfiles(!useTree.getState().showDotfiles),
  },
  'view.showIgnored': {
    label: 'Show Ignored Files',
    run: () => useTree.getState().setShowIgnored(!useTree.getState().showIgnored),
  },
  'ai.chat': {
    label: 'AI Chat',
    shortcut: 'Ctrl+Alt+C',
    aiFeature: true,
    run: () => {
      if (!useWorkspace.getState().root) return;
      useAiPanel.getState().toggleOpen();
    },
  },
  'ai.newConversation': {
    label: 'New AI Conversation',
    shortcut: 'Ctrl+Alt+N',
    run: () => {
      // Saves the current one in the history; starts nothing.
      if (!useWorkspace.getState().root || !useAiPanel.getState().open) return;
      useAiConversation.getState().newConversation();
      useAiPanel.getState().setHistoryOpen(false);
    },
  },
  'ai.history': {
    label: 'AI Conversation History',
    shortcut: 'Ctrl+Alt+H',
    run: () => {
      if (!useWorkspace.getState().root || !useAiPanel.getState().open) return;
      useAiPanel.getState().toggleHistory();
    },
  },
  // Review mode: answering a permission spends nothing (the operation is already running).
  'ai.acceptAllChanges': {
    label: 'Accept All Proposed Changes',
    shortcut: 'Alt+Shift+A',
    run: () => {
      if (reviewShown()) return useAiConversation.getState().acceptAllChanges();
    },
  },
  'ai.rejectAllChanges': {
    label: 'Reject All Proposed Changes',
    shortcut: 'Alt+Shift+R',
    run: () => {
      if (reviewShown()) return useAiConversation.getState().rejectAllChanges();
    },
  },
  'help.shortcuts': {
    label: 'Keyboard Shortcuts',
    shortcut: 'F1',
    run: () => {
      useTabs.getState().openSpecial('shortcuts');
    },
  },
  'help.about': {
    label: 'About IGrasp',
    run: () => {
      useUi.getState().setAboutOpen(true);
    },
  },
  'tabs.close': {
    label: 'Close Tab',
    shortcut: 'Ctrl+W',
    run: () => {
      const id = activeTabId();
      if (id) useTabs.getState().close(id);
    },
  },
  'tabs.next': {
    label: 'Next Tab',
    shortcut: 'Ctrl+Tab',
    run: () => {
      useTabs.getState().cycle(1);
    },
  },
  'tabs.previous': {
    label: 'Previous Tab',
    shortcut: 'Ctrl+Shift+Tab',
    run: () => {
      useTabs.getState().cycle(-1);
    },
  },
  'tabs.moveLeft': {
    label: 'Move Tab Left',
    shortcut: 'Ctrl+Shift+PageUp',
    run: () => {
      const id = activeTabId();
      if (id) useTabs.getState().move(id, -1);
    },
  },
  'tabs.moveRight': {
    label: 'Move Tab Right',
    shortcut: 'Ctrl+Shift+PageDown',
    run: () => {
      const id = activeTabId();
      if (id) useTabs.getState().move(id, 1);
    },
  },
  'file.openFolder': {
    label: 'Open Folder…',
    shortcut: 'Ctrl+O',
    run: () => useWorkspace.getState().openFolderDialog(),
  },
  'file.closeFolder': {
    label: 'Close Folder',
    run: () => useWorkspace.getState().closeRoot(),
  },
  'file.clearRecent': {
    label: 'Clear Recently Opened',
    run: () => useRecent.getState().clear(),
  },
  'file.exit': {
    label: 'Exit',
    shortcut: 'Alt+F4',
    run: () => backend.window.close(),
  },
  'view.toggleSidebar': {
    label: 'Toggle Sidebar',
    shortcut: 'Ctrl+B',
    run: () => {
      useWorkspace.getState().toggleSidebar();
    },
  },
  'go.symbol': {
    label: 'Go to File or Heading…',
    shortcut: 'Ctrl+T',
    run: () => {
      if (useWorkspace.getState().root) useQuickOpen.getState().openDialog();
    },
  },
  'search.next': {
    label: 'Next Search Result',
    shortcut: 'F4',
    run: () => {
      useSearch.getState().step(1);
    },
  },
  'search.previous': {
    label: 'Previous Search Result',
    shortcut: 'Shift+F4',
    run: () => {
      useSearch.getState().step(-1);
    },
  },
  'go.back': {
    label: 'Back',
    shortcut: 'Alt+Left',
    run: () => {
      useHistory.getState().back();
    },
  },
  'go.forward': {
    label: 'Forward',
    shortcut: 'Alt+Right',
    run: () => {
      useHistory.getState().forward();
    },
  },
  'view.focusOutline': {
    label: 'Focus Outline',
    shortcut: 'Ctrl+Shift+O',
    run: () => {
      if (!useWorkspace.getState().root) return;
      useWorkspace.getState().setRightPanelVisible(true);
      // The panel mounts on the next frame when it was hidden.
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.outline-filter')?.focus();
      });
    },
  },
  'view.toggleRightPanel': {
    label: 'Toggle Right Panel',
    shortcut: 'Ctrl+Alt+B',
    run: () => {
      useWorkspace.getState().toggleRightPanel();
    },
  },
  'view.muteToasts': {
    label: 'Mute Notifications',
    run: () => {
      const muted = useSettings.getState().settings.toastsMuted;
      if (muted) useToasts.getState().resetMutedCount();
      return useSettings.getState().update({ toastsMuted: !muted });
    },
  },
  'view.zoomIn': {
    label: 'Zoom In',
    shortcut: 'Ctrl+=',
    run: () => setFontSize(useSettings.getState().settings.fontSize + 1),
  },
  'view.zoomOut': {
    label: 'Zoom Out',
    shortcut: 'Ctrl+-',
    run: () => setFontSize(useSettings.getState().settings.fontSize - 1),
  },
  'view.zoomReset': {
    label: 'Reset Zoom',
    shortcut: 'Ctrl+0',
    run: () => setFontSize(DEFAULT_FONT_SIZE),
  },
};

export function runAction(id: ActionId): void {
  try {
    const result = actions[id].run();
    if (result instanceof Promise) {
      result.catch((err: unknown) => {
        console.error(`Action ${id} failed`, err);
      });
    }
  } catch (err) {
    console.error(`Action ${id} failed`, err);
  }
}

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'high-contrast', label: 'High Contrast' },
  { value: 'system', label: 'Follow System' },
];

export function setTheme(theme: Theme): void {
  useSettings
    .getState()
    .update({ theme })
    .catch((err: unknown) => {
      console.error('Cannot save the theme', err);
    });
}

export function isTheme(value: string): value is Theme {
  return THEME_OPTIONS.some((o) => o.value === value);
}
