import { describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_MARGIN,
  MAX_EDGE,
  ScreenshotError,
  captureRegionImage,
  planCapture,
} from './screenshot';
import type { Bitmap, ComposePlan, RenderBackend } from './screenshot';

const container = { x: 100, y: 50, width: 800, height: 600 };

describe('planCapture', () => {
  it('adds the margin around the selection, relative to the container', () => {
    const plan = planCapture(container, { x: 300, y: 250, width: 200, height: 100 }, 1, 'red');
    expect(plan?.clip).toEqual({
      x: 200 - CAPTURE_MARGIN,
      y: 200 - CAPTURE_MARGIN,
      width: 200 + 2 * CAPTURE_MARGIN,
      height: 100 + 2 * CAPTURE_MARGIN,
    });
    expect(plan?.selection).toEqual({ x: 200, y: 200, width: 200, height: 100 });
    expect(plan?.outWidth).toBe(224);
  });

  it('clamps to the container and rejects a region outside it', () => {
    const plan = planCapture(container, { x: 90, y: 40, width: 50, height: 50 }, 1, 'red');
    expect(plan?.clip).toEqual({
      x: 0,
      y: 0,
      width: 40 + CAPTURE_MARGIN,
      height: 40 + CAPTURE_MARGIN,
    });
    expect(planCapture(container, { x: 2000, y: 0, width: 50, height: 50 }, 1, 'red')).toBeNull();
  });

  it('downscales so the long edge is at most 1568 pixels', () => {
    const plan = planCapture(container, { x: 100, y: 50, width: 800, height: 400 }, 2, 'red');
    expect(plan?.outWidth).toBe(MAX_EDGE);
    expect(plan?.outHeight).toBeLessThan(MAX_EDGE);
  });
});

function fakeBackend(pngBytes: number, fail?: 'render') {
  const encoded: string[] = [];
  const bitmap = (width: number, height: number): Bitmap => ({
    width,
    height,
    toDataURL: (type) => {
      encoded.push(type);
      return `data:${type};base64,${type === 'image/png' ? 'A'.repeat(pngBytes) : 'JPEG'}`;
    },
  });
  const compose = vi.fn((_v: Bitmap, plan: ComposePlan) => bitmap(plan.outWidth, plan.outHeight));
  const backend: RenderBackend = {
    renderViewport: () =>
      fail ? Promise.reject(new Error('boom')) : Promise.resolve(bitmap(800, 600)),
    compose,
    resize: (b) => bitmap(Math.round(b.width / 2), Math.round(b.height / 2)),
  };
  return { backend, encoded, compose };
}

function element() {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650 }) as DOMRect;
  return el;
}

describe('captureRegionImage', () => {
  const selection = { x: 300, y: 250, width: 200, height: 100 };

  it('returns a PNG with a thumbnail when it is small enough', async () => {
    const { backend, compose } = fakeBackend(400, undefined);
    const image = await captureRegionImage(element(), selection, {
      backend,
      scale: 1,
      outlineColor: 'blue',
    });
    expect(image.mediaType).toBe('image/png');
    expect(image.dataBase64).toBe('A'.repeat(400));
    expect([image.width, image.height]).toEqual([224, 124]);
    expect(image.thumbnailDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(compose.mock.calls[0]?.[1].outlineColor).toBe('blue');
  });

  it('falls back to JPEG above 1.5 MB', async () => {
    const { backend, encoded } = fakeBackend(2_100_000, undefined);
    const image = await captureRegionImage(element(), selection, { backend, scale: 1 });
    expect(image.mediaType).toBe('image/jpeg');
    expect(image.dataBase64).toBe('JPEG');
    expect(encoded).toContain('image/jpeg');
  });

  it('reports failures with a typed error', async () => {
    const { backend } = fakeBackend(10, 'render');
    await expect(
      captureRegionImage(element(), selection, { backend, scale: 1 }),
    ).rejects.toMatchObject({
      name: 'ScreenshotError',
      reason: 'render',
    });
    const outside = { x: 5000, y: 0, width: 50, height: 50 };
    await expect(
      captureRegionImage(element(), outside, { backend: fakeBackend(1).backend, scale: 1 }),
    ).rejects.toBeInstanceOf(ScreenshotError);
  });
});
