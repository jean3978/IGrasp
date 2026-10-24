import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplashOverlay } from './SplashOverlay';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SplashOverlay', () => {
  it('stays for the minimum duration, then fades out and unmounts', () => {
    const { container } = render(<SplashOverlay ready />);
    expect(screen.getByRole('img', { name: 'IGrasp' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(container.querySelector('.splash')).not.toHaveAttribute('data-leaving');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector('.splash')).toHaveAttribute('data-leaving');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(container.querySelector('.splash')).toBeNull();
  });

  it('waits for the app to be ready', () => {
    const { container, rerender } = render(<SplashOverlay ready={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(container.querySelector('.splash')).not.toHaveAttribute('data-leaving');
    rerender(<SplashOverlay ready />);
    expect(container.querySelector('.splash')).toHaveAttribute('data-leaving');
  });
});
