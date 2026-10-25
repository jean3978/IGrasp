import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepScrollTop } from './keepScroll';

/** A scroll container whose content becomes tall enough after `tallAfter` frames. */
function container(tallAfter: number) {
  const el = document.createElement('div');
  let frame = 0;
  let top = 0;
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      // Before the content is tall, the browser clamps the position to the top.
      top = frame >= tallAfter ? v : 0;
    },
  });
  return {
    el,
    nextFrame: () => {
      frame += 1;
    },
  };
}

describe('keepScrollTop', () => {
  let frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
  const runFrame = (c: { nextFrame: () => void }) => {
    c.nextFrame();
    const pending = frames;
    frames = [];
    for (const cb of pending) cb(0);
  };
  afterEach(() => {
    frames = [];
  });

  it('holds the position once the content is tall enough, then stops', () => {
    const c = container(3);
    const done = vi.fn();
    keepScrollTop(c.el, 1500, done);
    expect(c.el.scrollTop).toBe(0);
    for (let i = 0; i < 3; i++) runFrame(c);
    expect(c.el.scrollTop).toBe(1500);
    expect(done).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
  });

  it('stops at once when the reader scrolls, clicks or types', () => {
    const c = container(100);
    const done = vi.fn();
    keepScrollTop(c.el, 1500, done);
    c.el.dispatchEvent(new Event('wheel'));
    expect(done).toHaveBeenCalledOnce();
    runFrame(c);
    expect(frames).toHaveLength(0);
  });
});
