import type { ActionId } from '../titlebar/menuActions';

export interface KeyBinding {
  /** `KeyboardEvent.key`, lower-cased. */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: ActionId;
}

export const KEYMAP: KeyBinding[] = [
  { key: 'o', ctrl: true, action: 'file.openFolder' },
  { key: 't', ctrl: true, action: 'go.symbol' },
  { key: 'b', ctrl: true, action: 'view.toggleSidebar' },
  { key: 'b', ctrl: true, alt: true, action: 'view.toggleRightPanel' },
  { key: ',', ctrl: true, action: 'file.settings' },
  { key: 'e', ctrl: true, shift: true, action: 'view.focusExplorer' },
  { key: 'f', ctrl: true, shift: true, action: 'view.search' },
  { key: 'r', ctrl: true, shift: true, action: 'view.recent' },
  { key: 'l', ctrl: true, shift: true, action: 'view.broken' },
  { key: 'o', ctrl: true, shift: true, action: 'view.focusOutline' },
  { key: 'f1', action: 'help.shortcuts' },
  { key: 'c', ctrl: true, alt: true, action: 'ai.chat' },
  { key: 'r', ctrl: true, alt: true, action: 'ai.capture' },
  { key: 's', ctrl: true, alt: true, action: 'ai.selectText' },
  { key: 'n', ctrl: true, alt: true, action: 'ai.newConversation' },
  { key: 'h', ctrl: true, alt: true, action: 'ai.history' },
  { key: 'a', alt: true, shift: true, action: 'ai.acceptAllChanges' },
  { key: 'r', alt: true, shift: true, action: 'ai.rejectAllChanges' },
  { key: 'f4', action: 'search.next' },
  { key: 'f4', shift: true, action: 'search.previous' },
  { key: 'arrowleft', alt: true, action: 'go.back' },
  { key: 'arrowright', alt: true, action: 'go.forward' },
  { key: '=', ctrl: true, action: 'view.zoomIn' },
  { key: '+', ctrl: true, action: 'view.zoomIn' },
  { key: '-', ctrl: true, action: 'view.zoomOut' },
  { key: '0', ctrl: true, action: 'view.zoomReset' },
  { key: 'w', ctrl: true, action: 'tabs.close' },
  { key: 'tab', ctrl: true, action: 'tabs.next' },
  { key: 'tab', ctrl: true, shift: true, action: 'tabs.previous' },
  { key: 'pagedown', ctrl: true, action: 'tabs.next' },
  { key: 'pageup', ctrl: true, action: 'tabs.previous' },
  { key: 'pageup', ctrl: true, shift: true, action: 'tabs.moveLeft' },
  { key: 'pagedown', ctrl: true, shift: true, action: 'tabs.moveRight' },
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n): KeyBinding => ({
    key: String(n),
    alt: true,
    action: `tabs.goto${n}`,
  })),
];

/** Shortcuts reserved for features of later phases: never bind them to anything else. */
export const RESERVED_SHORTCUTS = ['F2', 'Delete', 'Ctrl+S', 'Ctrl+E'];

/** Returns the action bound to a key event, if any. Modifiers must match exactly. */
export function matchBinding(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  keymap: KeyBinding[] = KEYMAP,
): ActionId | undefined {
  const key = e.key.toLowerCase();
  // Ctrl+Shift+= produces '+', so shift is ignored for punctuation zoom keys.
  const shiftInsensitive = key === '+' || key === '=';
  return keymap.find(
    (b) =>
      b.key === key &&
      Boolean(b.ctrl) === (e.ctrlKey || e.metaKey) &&
      Boolean(b.alt) === e.altKey &&
      (shiftInsensitive || Boolean(b.shift) === e.shiftKey),
  )?.action;
}
