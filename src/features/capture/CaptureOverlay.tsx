import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { clampRect, isBigEnough, rectFromPoints, toCaptureRect } from './capture';
import type { CaptureRect } from './capture';
import './capture.css';

/** Keyboard mode: initial rectangle and step (CSS pixels). */
const KEY_RECT = { width: 200, height: 120 };
const KEY_STEP = 16;

interface CaptureOverlayProps {
  /** The element whose visible content can be captured (the preview or code scroll container). */
  container: HTMLElement;
  /** The selected rectangle, in client coordinates (at least 24 x 24). */
  onCapture: (rect: CaptureRect) => void;
  onCancel: () => void;
}

/**
 * Covers `container` with a crosshair: drag a rectangle, or use the keyboard (arrows move a
 * 200 x 120 rectangle from the centre, Shift+arrows resize it, Enter captures, Escape cancels).
 * Nothing happens until the caller receives `onCapture`; the caller unmounts the overlay.
 */
export function CaptureOverlay({ container, onCapture, onCancel }: CaptureOverlayProps) {
  const [bounds, setBounds] = useState<CaptureRect>(() =>
    toCaptureRect(container.getBoundingClientRect()),
  );
  const [rect, setRect] = useState<CaptureRect | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const update = () => {
      setBounds(toCaptureRect(container.getBoundingClientRect()));
    };
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(container);
    root.current?.focus();
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancelRef.current();
      }
    };
    document.addEventListener('keydown', onEscape, true);
    return () => {
      document.removeEventListener('keydown', onEscape, true);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [container]);

  const clampPoint = useCallback(
    (x: number, y: number) => ({
      x: Math.min(Math.max(x, bounds.x), bounds.x + bounds.width),
      y: Math.min(Math.max(y, bounds.y), bounds.y + bounds.height),
    }),
    [bounds],
  );

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = clampPoint(e.clientX, e.clientY);
    drag.current = start;
    setRect({ x: start.x, y: start.y, width: 0, height: 0 });
  };
  const onMouseMove = (e: ReactMouseEvent) => {
    const start = drag.current;
    if (!start) return;
    const p = clampPoint(e.clientX, e.clientY);
    setRect(rectFromPoints(start.x, start.y, p.x, p.y));
  };
  const onMouseUp = (e: ReactMouseEvent) => {
    const start = drag.current;
    if (!start) return;
    drag.current = null;
    const p = clampPoint(e.clientX, e.clientY);
    const done = rectFromPoints(start.x, start.y, p.x, p.y);
    if (isBigEnough(done)) {
      setRect(done);
      onCapture(done);
    } else {
      setRect(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (rect && isBigEnough(rect)) {
        e.preventDefault();
        onCapture(rect);
      }
      return;
    }
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const current =
      rect ??
      clampRect(
        {
          x: bounds.x + (bounds.width - KEY_RECT.width) / 2,
          y: bounds.y + (bounds.height - KEY_RECT.height) / 2,
          ...KEY_RECT,
        },
        bounds,
      );
    if (!rect) {
      setRect(current);
      return;
    }
    const next = e.shiftKey
      ? {
          ...current,
          width: Math.max(1, current.width + d[0]),
          height: Math.max(1, current.height + d[1]),
        }
      : { ...current, x: current.x + d[0], y: current.y + d[1] };
    setRect(clampRect(next, bounds));
  };

  return createPortal(
    <div
      ref={root}
      className="capture-overlay"
      role="application"
      tabIndex={-1}
      aria-label="Select a region. Drag with the mouse, or use the arrow keys: Shift and arrows resize, Enter captures, Escape cancels."
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onKeyDown={onKeyDown}
    >
      {rect && (
        <div
          className="capture-selection"
          data-valid={isBigEnough(rect)}
          style={{
            left: rect.x - bounds.x,
            top: rect.y - bounds.y,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}
      {!rect && (
        <p className="capture-hint">
          Drag to select a region, or use the arrow keys. Enter captures, Escape cancels.
        </p>
      )}
    </div>,
    document.body,
  );
}
