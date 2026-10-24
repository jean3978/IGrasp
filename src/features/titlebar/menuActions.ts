// Single source of truth for user actions. Menu items, toolbar buttons and keyboard shortcuts all
// dispatch through `runAction`, so an action behaves the same wherever it is triggered from.

import { backend } from '../../ipc/client';
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../../ipc/defaults';
import type { Theme } from '../../ipc/types';
import { useRecent } from '../../stores/recent';
import { useSettings } from '../../stores/settings';
import { useTabs } from '../../stores/tabs';
import { useToasts } from '../../stores/toasts';
import { useWorkspace } from '../../stores/workspace';

export type ActionId =
  | 'file.openFolder'
  | 'file.closeFolder'
  | 'file.clearRecent'
  | 'file.exit'
  | 'view.toggleSidebar'
  | 'view.muteToasts'
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
  run(): void | Promise<void>;
}

const DEFAULT_FONT_SIZE = 16;

function setFontSize(size: number) {
  const fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
  return useSettings.getState().update({ fontSize });
}

export const actions: Record<ActionId, ActionDef> = {
  ...gotoActions,
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
