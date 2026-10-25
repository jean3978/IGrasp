// Putting a document back at a scroll position while its content renders asynchronously (a
// restored tab, the preview replacing a review). It never fights the reader: their own scroll,
// click or key stops it.

const USER_INPUT = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;

/**
 * Sets `el.scrollTop` to `top` on every frame until it holds (the content became tall enough),
 * for at most `maxFrames` frames, or until the user takes over. `onDone` runs once when it
 * stops, whatever the reason. Returns a function that stops it.
 */
export function keepScrollTop(
  el: HTMLElement,
  top: number,
  onDone?: () => void,
  maxFrames = 60,
): () => void {
  let frames = 0;
  let handle = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(handle);
    for (const type of USER_INPUT) el.removeEventListener(type, stop);
    onDone?.();
  };
  for (const type of USER_INPUT) el.addEventListener(type, stop, { passive: true });
  const apply = () => {
    el.scrollTop = top;
    frames += 1;
    if (Math.abs(el.scrollTop - top) > 1 && frames < maxFrames) {
      handle = requestAnimationFrame(apply);
    } else {
      stop();
    }
  };
  apply();
  return stop;
}
