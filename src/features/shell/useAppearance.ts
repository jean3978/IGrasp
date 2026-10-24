import { useEffect } from 'react';
import { backend } from '../../ipc/client';
import type { ReadingWidth } from '../../ipc/types';
import { selectEffectiveTheme, useSettings } from '../../stores/settings';

const READING_WIDTHS: Record<ReadingWidth, string> = {
  narrow: '680px',
  medium: '860px',
  wide: '1100px',
  full: 'none',
};

/** Applies the theme, font size and reading width to the document root, and tracks the OS theme. */
export function useAppearance(): void {
  const theme = useSettings(selectEffectiveTheme);
  const fontSize = useSettings((s) => s.settings.fontSize);
  const readingWidth = useSettings((s) => s.settings.readingWidth);
  const setSystemDark = useSettings((s) => s.setSystemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty('--preview-font-size', `${fontSize}px`);
    root.style.setProperty('--reading-width', READING_WIDTHS[readingWidth]);
  }, [theme, fontSize, readingWidth]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
    };
    setSystemDark(media.matches);
    media.addEventListener('change', onChange);

    // WebKitGTK does not always report OS theme changes through matchMedia; Tauri does.
    let off: (() => void) | undefined;
    let cancelled = false;
    void backend.window.onThemeChanged(setSystemDark).then((unlisten) => {
      if (cancelled) unlisten();
      else off = unlisten;
    });
    return () => {
      cancelled = true;
      media.removeEventListener('change', onChange);
      off?.();
    };
  }, [setSystemDark]);
}
