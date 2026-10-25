// Hoot's welcome when the Academy tab opens: Hoot pops up, its mortarboard drops on its head,
// "Welcome to Hoot's Academy", then the screen fades into the hub (about two seconds). A click or
// any key skips it. Not shown when the effects are off or the system asks for reduced motion,
// nor when the tab opens on a tutorial (from a shared tutorial's banner). Decorative: the hub
// under it is already there for assistive technologies.

import { useEffect, useState } from 'react';
import { useAcademy } from '../../stores/academy';
import { Hoot } from '../hoot/Hoot';

/** How long the welcome shows, then how long it takes to fade (ms). */
export const WELCOME_MS = 1800;
export const WELCOME_FADE_MS = 450;

export function AcademyWelcome({ motion }: { motion: boolean }) {
  const welcome = useAcademy((s) => s.welcome);
  const onHome = useAcademy((s) => s.screen === 'home');
  const endWelcome = useAcademy((s) => s.endWelcome);
  const [leaving, setLeaving] = useState(false);
  const show = welcome && motion && onHome;

  // Nothing to play: the welcome is used up at once.
  useEffect(() => {
    if (welcome && !show) endWelcome();
  }, [welcome, show, endWelcome]);

  useEffect(() => {
    if (!show) return;
    const fade = setTimeout(() => {
      setLeaving(true);
    }, WELCOME_MS);
    const done = setTimeout(endWelcome, WELCOME_MS + WELCOME_FADE_MS);
    const skip = () => {
      setLeaving(true);
      clearTimeout(fade);
      clearTimeout(done);
      setTimeout(endWelcome, WELCOME_FADE_MS / 2);
    };
    window.addEventListener('keydown', skip, { once: true });
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
      window.removeEventListener('keydown', skip);
    };
  }, [show, endWelcome]);

  if (!show) return null;
  return (
    <div
      className="academy-welcome"
      data-leaving={leaving ? 'true' : undefined}
      aria-hidden
      onClick={() => {
        setLeaving(true);
        setTimeout(endWelcome, WELCOME_FADE_MS / 2);
      }}
    >
      <div className="academy-welcome-stage">
        <span className="academy-welcome-spark" data-i="1" />
        <span className="academy-welcome-spark" data-i="2" />
        <span className="academy-welcome-spark" data-i="3" />
        <span className="academy-welcome-spark" data-i="4" />
        <Hoot state="cheering" size={150} hat label="" className="academy-welcome-hoot" />
        <p className="academy-welcome-eyebrow">Welcome to</p>
        <p className="academy-welcome-title">Hoot&apos;s Academy</p>
        <p className="academy-welcome-lead">Learn this project from its own files.</p>
      </div>
    </div>
  );
}
