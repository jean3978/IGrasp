import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hoot } from './Hoot';
import { HOOT_LINES, MOMENT_STATE, pickLine } from './hootLines';
import type { HootMoment } from './hootLines';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Hoot', () => {
  it('is a named picture with its state on the root', () => {
    const { container, rerender } = render(<Hoot state="thinking" label="Hoot is thinking" />);
    expect(screen.getByRole('img', { name: 'Hoot is thinking' })).toBeInTheDocument();
    expect(container.querySelector('.hoot')?.getAttribute('data-state')).toBe('thinking');
    rerender(<Hoot state="cheering" />);
    expect(container.querySelector('.hoot')?.getAttribute('data-state')).toBe('cheering');
    // No ids: several Hoots can share a page.
    expect(container.querySelector('[id]')).toBeNull();
  });

  it('keeps still without motion and blinks when idle with motion', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Hoot state="idle" motion={false} />);
    expect(container.querySelector('.hoot')?.classList.contains('hoot-still')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(container.querySelector('[data-blink]')).toBeNull();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    rerender(<Hoot state="idle" />);
    act(() => {
      vi.advanceTimersByTime(5050);
    });
    expect(container.querySelector('[data-blink]')).not.toBeNull();
  });

  it('shows its line, announced only when asked', () => {
    const { rerender } = render(<Hoot line="Nailed it." />);
    expect(screen.getByText('Nailed it.')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Hoot line="Nailed it." announce />);
    expect(screen.getByText('Nailed it.')).toHaveAttribute('aria-live', 'polite');
  });
});

describe("Hoot's lines", () => {
  it('never repeats the line just said for a moment', () => {
    for (const moment of Object.keys(HOOT_LINES) as HootMoment[]) {
      let previous = pickLine(moment);
      for (let i = 0; i < 20; i++) {
        const line = pickLine(moment);
        if (HOOT_LINES[moment].length > 1) expect(line).not.toBe(previous);
        previous = line;
      }
      expect(MOMENT_STATE[moment]).toBeDefined();
    }
  });

  it('fills in the file and the count, with no emoji', () => {
    expect(pickLine('reading', { file: 'src/main.ts' }, () => 0)).toContain('src/main.ts');
    expect(pickLine('streak', { n: 3 }, () => 0)).toMatch(/^3 /);
    const all = Object.values(HOOT_LINES).flat().join(' ');
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
