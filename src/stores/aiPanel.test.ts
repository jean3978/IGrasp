import { beforeEach, describe, expect, it } from 'vitest';
import {
  PANEL_DEFAULT_HEIGHT,
  PANEL_DEFAULT_WIDTH,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  clampRect,
  defaultRect,
  resizeRect,
  selectPanelRect,
  useAiPanel,
} from './aiPanel';

const big = { width: 1600, height: 1000 };

beforeEach(() => {
  useAiPanel.setState({ open: false, rect: null, draft: '' });
});

describe('panel geometry', () => {
  it('starts in the bottom-right corner at the default size', () => {
    const rect = defaultRect(big);
    expect(rect.width).toBe(PANEL_DEFAULT_WIDTH);
    expect(rect.height).toBe(PANEL_DEFAULT_HEIGHT);
    expect(rect.x + rect.width).toBeLessThan(big.width);
    expect(rect.x + rect.width).toBeGreaterThan(big.width - 40);
    expect(rect.y + rect.height).toBeLessThan(big.height);
    // A window smaller than the default: the panel fits.
    expect(defaultRect({ width: 300, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
  });

  it('keeps the panel inside the window, between the minimum and the window size', () => {
    expect(clampRect({ x: -50, y: -20, width: 100, height: 100 }, big)).toEqual({
      x: 0,
      y: 0,
      width: PANEL_MIN_WIDTH,
      height: PANEL_MIN_HEIGHT,
    });
    expect(clampRect({ x: 1500, y: 900, width: 500, height: 400 }, big)).toEqual({
      x: 1100,
      y: 600,
      width: 500,
      height: 400,
    });
    expect(clampRect({ x: 0, y: 0, width: 5000, height: 5000 }, big)).toEqual({
      x: 0,
      y: 0,
      ...big,
    });
  });

  it('resizes from any edge with the opposite edges fixed', () => {
    const start = { x: 400, y: 300, width: 500, height: 400 };
    expect(resizeRect(start, 'se', 50, 20, big)).toEqual({ ...start, width: 550, height: 420 });
    expect(resizeRect(start, 'nw', -100, -50, big)).toEqual({
      x: 300,
      y: 250,
      width: 600,
      height: 450,
    });
    // Shrinking from the left stops at the minimum width; the right edge stays.
    const narrow = resizeRect(start, 'w', 400, 0, big);
    expect(narrow.width).toBe(PANEL_MIN_WIDTH);
    expect(narrow.x + narrow.width).toBe(900);
    // Growing past the window stops at its edge.
    expect(resizeRect(start, 'e', 5000, 0, big).width).toBe(big.width - 400);
  });

  it('moves by steps from the default place and remembers the place', () => {
    const before = selectPanelRect(useAiPanel.getState());
    useAiPanel.getState().moveBy(-24, -24);
    expect(useAiPanel.getState().rect).toEqual({ ...before, x: before.x - 24, y: before.y - 24 });
    useAiPanel.getState().moveBy(-10_000, 0);
    expect(useAiPanel.getState().rect?.x).toBe(0);
    useAiPanel.getState().resetRect();
    expect(useAiPanel.getState().rect).toBeNull();
  });

  it('restores the state a session saved', () => {
    useAiPanel.getState().restore({ open: true, rect: { x: 1, y: 2, width: 400, height: 350 } });
    expect(useAiPanel.getState()).toMatchObject({ open: true, rect: { x: 1, y: 2 } });
    useAiPanel.getState().restore(null);
    expect(useAiPanel.getState()).toMatchObject({ open: false, rect: null });
  });
});
