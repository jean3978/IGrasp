import { useEffect } from 'react';
import { runAction } from '../titlebar/menuActions';
import { matchBinding } from './keymap';

/** Dispatches application shortcuts from anywhere in the window. */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const action = matchBinding(e);
      if (!action) return;
      e.preventDefault();
      runAction(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
