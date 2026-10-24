// Single source of truth for user actions. Menu items, toolbar buttons and keyboard shortcuts all
// dispatch through `runAction`, so an action behaves the same wherever it is triggered from.

import { backend } from '../../ipc/client';
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../../ipc/defaults';
import type { Theme } from '../../ipc/types';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';

export type ActionId =
  'file.exit' | 'view.toggleSidebar' | 'view.zoomIn' | 'view.zoomOut' | 'view.zoomReset';

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
