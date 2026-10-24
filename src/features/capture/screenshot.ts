// Region capture, step 2: a screenshot of the selected region, taken from the DOM (not the OS):
// portable, no Tauri capability, works on Wayland, shows exactly what the preview shows.
//
// The pixel work sits behind `RenderBackend` so the geometry and the encoding choices are
// testable without a canvas (jsdom has none); `domBackend()` is the real one (modern-screenshot).

import type { CaptureRect } from './capture';

/** Context around the selection, in CSS pixels. */
export const CAPTURE_MARGIN = 12;
/** The long edge of the exported image (what the model reads well, and a bounded size). */
export const MAX_EDGE = 1568;
/** Above this many bytes of PNG, the image is exported as JPEG instead. */
export const MAX_PNG_BYTES = 1_500_000;
export const JPEG_QUALITY = 0.85;
const THUMB_EDGE = 160;
const OUTLINE_WIDTH = 2;

/** A bitmap the backend can encode. */
export interface Bitmap {
  width: number;
  height: number;
  toDataURL(type: 'image/png' | 'image/jpeg', quality?: number): string;
}

/** Where to cut, in CSS pixels relative to the container's visible box, and how big to export. */
export interface ComposePlan {
  clip: CaptureRect;
  /** The selection inside `clip`, to outline. */
  selection: CaptureRect;
  /** Render scale (device pixels per CSS pixel) of the viewport bitmap. */
  scale: number;
  /** Final size in image pixels. */
  outWidth: number;
  outHeight: number;
  outlineColor: string;
  /** Outline width in image pixels. */
  outlineWidth: number;
}

export interface RenderBackend {
  /** Renders the container's visible content (scroll position applied) at `scale`. */
  renderViewport(container: HTMLElement, scale: number): Promise<Bitmap>;
  /** Cuts `plan.clip` out of the viewport bitmap, scales it and outlines the selection. */
  compose(viewport: Bitmap, plan: ComposePlan): Bitmap;
  /** A copy whose long edge is `edge` pixels. */
  resize(bitmap: Bitmap, edge: number): Bitmap;
}

export interface CapturedImage {
  /** `image/png`, or `image/jpeg` when the PNG was too large. AiImage-compatible. */
  mediaType: string;
  dataBase64: string;
  width: number;
  height: number;
  thumbnailDataUrl: string;
}

export class ScreenshotError extends Error {
  constructor(
    readonly reason: 'empty' | 'render' | 'encode',
    message: string,
    options?: { cause: unknown },
  ) {
    super(message, options);
    this.name = 'ScreenshotError';
  }
}

export interface ScreenshotOptions {
  backend?: RenderBackend;
  /** Device pixel ratio; defaults to the window's, capped at 2. */
  scale?: number;
  /** CSS colour of the outline; defaults to the `--accent` token. */
  outlineColor?: string;
}

const cssToken = (name: string, fallback: string): string => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v === '' ? fallback : v;
};

/** The clip (selection plus margin, inside the container) and the export size. Pure. */
export function planCapture(
  container: CaptureRect,
  selection: CaptureRect,
  scale: number,
  outlineColor: string,
): ComposePlan | null {
  // Selection relative to the container, kept inside it.
  const x0 = Math.max(selection.x, container.x) - container.x;
  const y0 = Math.max(selection.y, container.y) - container.y;
  const x1 = Math.min(selection.x + selection.width, container.x + container.width) - container.x;
  const y1 = Math.min(selection.y + selection.height, container.y + container.height) - container.y;
  if (x1 <= x0 || y1 <= y0) return null;
  const cx0 = Math.max(0, x0 - CAPTURE_MARGIN);
  const cy0 = Math.max(0, y0 - CAPTURE_MARGIN);
  const cx1 = Math.min(container.width, x1 + CAPTURE_MARGIN);
  const cy1 = Math.min(container.height, y1 + CAPTURE_MARGIN);
  const clip = { x: cx0, y: cy0, width: cx1 - cx0, height: cy1 - cy0 };
  const fit = Math.min(1, MAX_EDGE / Math.max(clip.width * scale, clip.height * scale));
  return {
    clip,
    selection: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    scale,
    outWidth: Math.max(1, Math.round(clip.width * scale * fit)),
    outHeight: Math.max(1, Math.round(clip.height * scale * fit)),
    outlineColor,
    outlineWidth: OUTLINE_WIDTH,
  };
}

const base64Of = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1);
const byteSize = (base64: string): number => Math.floor((base64.length * 3) / 4);

/**
 * Takes the screenshot of `selection` (client coordinates) over `container`. Throws a
 * `ScreenshotError` when it cannot (tainted canvas, render failure, empty region): the caller
 * then attaches the text only and tells the user.
 */
export async function captureRegionImage(
  container: HTMLElement,
  selection: CaptureRect,
  options: ScreenshotOptions = {},
): Promise<CapturedImage> {
  const backend = options.backend ?? domBackend();
  const scale = options.scale ?? Math.min(window.devicePixelRatio || 1, 2);
  const box = container.getBoundingClientRect();
  const plan = planCapture(
    { x: box.left, y: box.top, width: box.width, height: box.height },
    selection,
    scale,
    options.outlineColor ?? cssToken('--accent', '#005fb8'),
  );
  if (!plan) throw new ScreenshotError('empty', 'The selected region is outside the document.');
  let image: Bitmap;
  try {
    const viewport = await backend.renderViewport(container, scale);
    image = backend.compose(viewport, plan);
  } catch (cause) {
    throw new ScreenshotError('render', 'The region could not be rendered.', { cause });
  }
  try {
    let mediaType = 'image/png';
    let dataBase64 = base64Of(image.toDataURL('image/png'));
    if (byteSize(dataBase64) > MAX_PNG_BYTES) {
      mediaType = 'image/jpeg';
      dataBase64 = base64Of(image.toDataURL('image/jpeg', JPEG_QUALITY));
    }
    const thumb = backend.resize(image, THUMB_EDGE);
    return {
      mediaType,
      dataBase64,
      width: image.width,
      height: image.height,
      thumbnailDataUrl: thumb.toDataURL('image/png'),
    };
  } catch (cause) {
    // A canvas tainted by a cross-origin image refuses to export.
    throw new ScreenshotError('encode', 'The image could not be exported.', { cause });
  }
}

/** The real backend: modern-screenshot (loaded on first use) and 2D canvases. */
export function domBackend(): RenderBackend {
  const wrap = (canvas: HTMLCanvasElement): Bitmap => canvas;
  const asCanvas = (b: Bitmap): HTMLCanvasElement => b as HTMLCanvasElement;
  const newCanvas = (w: number, h: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    ctx.imageSmoothingQuality = 'high';
    return { canvas, ctx };
  };
  return {
    async renderViewport(container, scale) {
      const { domToCanvas } = await import('modern-screenshot');
      const width = container.clientWidth;
      const height = container.clientHeight;
      // The clone starts unscrolled: let its content overflow and shift it by the scroll offset,
      // so the canvas (sized to the visible box) shows what is on screen.
      const canvas = await domToCanvas(container, {
        width,
        height,
        scale,
        backgroundColor: cssToken('--bg-editor', '#ffffff'),
        style: {
          overflow: 'visible',
          height: 'auto',
          minHeight: `${String(height)}px`,
          transform: `translate(${String(-container.scrollLeft)}px, ${String(-container.scrollTop)}px)`,
        },
      });
      return wrap(canvas);
    },
    compose(viewport, plan) {
      const { canvas, ctx } = newCanvas(plan.outWidth, plan.outHeight);
      const k = plan.scale;
      ctx.drawImage(
        asCanvas(viewport),
        plan.clip.x * k,
        plan.clip.y * k,
        plan.clip.width * k,
        plan.clip.height * k,
        0,
        0,
        plan.outWidth,
        plan.outHeight,
      );
      const sx = plan.outWidth / plan.clip.width;
      const sy = plan.outHeight / plan.clip.height;
      const w = plan.outlineWidth;
      ctx.strokeStyle = plan.outlineColor;
      ctx.lineWidth = w;
      ctx.strokeRect(
        (plan.selection.x - plan.clip.x) * sx + w / 2,
        (plan.selection.y - plan.clip.y) * sy + w / 2,
        plan.selection.width * sx - w,
        plan.selection.height * sy - w,
      );
      return wrap(canvas);
    },
    resize(bitmap, edge) {
      const ratio = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const { canvas, ctx } = newCanvas(
        Math.max(1, Math.round(bitmap.width * ratio)),
        Math.max(1, Math.round(bitmap.height * ratio)),
      );
      ctx.drawImage(asCanvas(bitmap), 0, 0, canvas.width, canvas.height);
      return wrap(canvas);
    },
  };
}
