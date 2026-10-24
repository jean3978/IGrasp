import { useEffect, useState } from 'react';
import { AppLogo } from './AppLogo';
import './splash.css';

const MIN_DURATION_MS = 1200;
const REDUCED_MOTION_MS = 400;
const FADE_MS = 300;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Full-window overlay playing the logo animation while the app starts. It stays at least
 * MIN_DURATION_MS (so the animation completes) and until `ready`, then fades out and unmounts.
 */
export function SplashOverlay({ ready }: { ready: boolean }) {
  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);
  const [reduced] = useState(prefersReducedMotion);
  const leaving = ready && minElapsed;

  useEffect(() => {
    const t = window.setTimeout(
      () => {
        setMinElapsed(true);
      },
      reduced ? REDUCED_MOTION_MS : MIN_DURATION_MS,
    );
    return () => {
      window.clearTimeout(t);
    };
  }, [reduced]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => {
      setGone(true);
    }, FADE_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [leaving]);

  if (gone) return null;
  return (
    <div
      className="splash"
      data-leaving={leaving ? '' : undefined}
      data-reduced={reduced ? '' : undefined}
      role="presentation"
    >
      <AppLogo className="splash-logo" title="IGrasp" />
      <div className="splash-name" aria-hidden>
        IGrasp
      </div>
    </div>
  );
}
