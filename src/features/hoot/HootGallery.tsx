// Development only (`?hoot=1` in the browser dev mode): Hoot's states side by side, in motion
// and still, then every moment of the quiz and the Academy with its state and its lines, for a
// visual review in each theme.

import { Hoot } from './Hoot';
import type { HootState } from './Hoot';
import { HOOT_LINES, MOMENT_STATE } from './hootLines';
import type { HootMoment } from './hootLines';

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
      <section aria-label="Moments">
        <h2>Moments</h2>
        {(Object.keys(HOOT_LINES) as HootMoment[]).map((moment) => (
          <figure key={moment} className="hoot-gallery-moment">
            <Hoot state={MOMENT_STATE[moment]} size={56} line={HOOT_LINES[moment][0] ?? ''} />
            <figcaption>
              {moment} · {MOMENT_STATE[moment]} · {HOOT_LINES[moment].length} line
              {HOOT_LINES[moment].length === 1 ? '' : 's'}
            </figcaption>
          </figure>
        ))}
      </section>
    </main>
  );
}
