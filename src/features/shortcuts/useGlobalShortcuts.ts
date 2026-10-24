import { useEffect } from 'react';
import { runAction } from '../titlebar/menuActions';
import { matchBinding } from './keymap';

/** Mouse buttons 4 and 5 (`MouseEvent.button` 3 and 4): back and forward. */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

/** Dispatches application shortcuts and the mouse back/forward buttons from anywhere. */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const action = matchBinding(e);
      if (!action) return;
      // Also stops Alt+Left/Right from navigating the webview's own history.
      e.preventDefault();
      runAction(action);
    };
    // The webview would navigate its history on these buttons: prevent it on every phase.
    const swallow = (e: MouseEvent) => {
      if (e.button === MOUSE_BACK || e.button === MOUSE_FORWARD) e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === MOUSE_BACK) runAction('go.back');
      else if (e.button === MOUSE_FORWARD) runAction('go.forward');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', swallow, true);
    window.addEventListener('auxclick', swallow, true);
    window.addEventListener('mouseup', onMouseUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', swallow, true);
      window.removeEventListener('auxclick', swallow, true);
      window.removeEventListener('mouseup', onMouseUp, true);
    };
  }, []);
}
