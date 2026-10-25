// Development only (`?hoot=1` in the browser dev mode): Hoot's states side by side, in motion
// and still, for a visual review in each theme.

import { Hoot } from './Hoot';
import type { HootState } from './Hoot';

const STATES: HootState[] = ['idle', 'thinking', 'cheering', 'explaining', 'encouraging'];

export function HootGallery() {
  return (
    <main className="hoot-gallery">
      {[true, false].map((motion) => (
        <section key={String(motion)} aria-label={motion ? 'In motion' : 'Still'}>
          <h2>{motion ? 'In motion' : 'Still (reduced motion)'}</h2>
          <div className="hoot-gallery-row">
            {STATES.map((state) => (
              <figure key={state}>
                <Hoot state={state} size={120} motion={motion} />
                <figcaption>{state}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
      <div className="hoot-gallery-row">
        <Hoot state="explaining" size={96} line="Close. Here is what the code does:" />
        <Hoot state="idle" size={40} />
      </div>
    </main>
  );
}
