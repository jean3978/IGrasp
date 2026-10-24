import { useEffect, useState } from 'react';
import { backend } from '../../ipc/client';
import type { Unsubscribe } from '../../ipc/types';

/** Subscribes to a window event in an effect, unsubscribing even if the subscription resolves late. */
function useWindowListener(subscribe: () => Promise<Unsubscribe>): void {
  useEffect(() => {
    let off: Unsubscribe | undefined;
    let cancelled = false;
    void subscribe().then((unlisten) => {
      if (cancelled) unlisten();
      else off = unlisten;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [subscribe]);
}

const subscribeFocus = (set: (focused: boolean) => void) => () =>
  backend.window.onFocusChanged(set);

export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(true);
  const [subscribe] = useState(() => subscribeFocus(setFocused));
  useWindowListener(subscribe);
  return focused;
}

export function useIsMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  const [subscribe] = useState(() => () => {
    const refresh = () => {
      void backend.window.isMaximized().then(setMaximized);
    };
    refresh();
    return backend.window.onResized(refresh);
  });
  useWindowListener(subscribe);
  return maximized;
}
