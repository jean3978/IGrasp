import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { onEffect, playEffect } from './effects';
import { EffectsCanvas } from './EffectsCanvas';

describe('effect triggers', () => {
  it('start from the centre of the element, only while a canvas listens', () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 40 }) as DOMRect;
    const listener = vi.fn();
    playEffect('confetti', el);
    const off = onEffect(listener);
    playEffect('confetti', el);
    playEffect('ring', null);
    off();
    playEffect('sparks', el);
    expect(listener.mock.calls).toEqual([['confetti', 60, 40]]);
  });

  it('mount a canvas that draws nothing without a 2D context', () => {
    const { container } = render(<EffectsCanvas />);
    expect(container.querySelector('canvas.quiz-effects')).not.toBeNull();
    expect(() => {
      playEffect('confetti', container.querySelector('canvas'));
    }).not.toThrow();
  });
});
