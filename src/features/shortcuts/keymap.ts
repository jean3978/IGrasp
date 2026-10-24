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
  { key: 'b', ctrl: true, action: 'view.toggleSidebar' },
  { key: '=', ctrl: true, action: 'view.zoomIn' },
  { key: '+', ctrl: true, action: 'view.zoomIn' },
  { key: '-', ctrl: true, action: 'view.zoomOut' },
  { key: '0', ctrl: true, action: 'view.zoomReset' },
];

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
