// The floating AI chat panel: shown or not, where it sits, and what the composer holds. Its
// open state and geometry are saved per folder in the session (`session.ts`). Nothing here
// talks to a provider.

import { create } from 'zustand';
import type { AiPanelState, PanelRect } from '../ipc/types';

export const PANEL_MIN_WIDTH = 360;
export const PANEL_MIN_HEIGHT = 320;
export const PANEL_DEFAULT_WIDTH = 420;
export const PANEL_DEFAULT_HEIGHT = 560;
/** Space kept between the default panel and the window's right and bottom edges. */
export const PANEL_MARGIN = 16;
/** Height of the status bar, kept clear by the default position. */
const STATUSBAR_CLEARANCE = 24;
/** Pixels moved or resized per Alt+arrow press. */
export const PANEL_KEY_STEP = 24;

export interface Viewport {
  width: number;
  height: number;
}

export const windowViewport = (): Viewport => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

/** Bottom-right corner, above the status bar, at the default size (smaller in a small window). */
export function defaultRect(viewport: Viewport): PanelRect {
  const width = Math.min(PANEL_DEFAULT_WIDTH, viewport.width);
  const height = Math.min(PANEL_DEFAULT_HEIGHT, viewport.height);
  return clampRect(
    {
      x: viewport.width - width - PANEL_MARGIN,
      y: viewport.height - height - PANEL_MARGIN - STATUSBAR_CLEARANCE,
      width,
      height,
    },
    viewport,
  );
}

/**
 * Keeps a rectangle inside the window: at least the minimum size (unless the window is
 * smaller), at most the window, and entirely visible.
 */
export function clampRect(rect: PanelRect, viewport: Viewport): PanelRect {
  const vw = Math.max(0, viewport.width);
  const vh = Math.max(0, viewport.height);
  const width = Math.min(Math.max(rect.width, Math.min(PANEL_MIN_WIDTH, vw)), vw);
  const height = Math.min(Math.max(rect.height, Math.min(PANEL_MIN_HEIGHT, vh)), vh);
  const x = Math.min(Math.max(rect.x, 0), vw - width);
  const y = Math.min(Math.max(rect.y, 0), vh - height);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Which edges a resize handle moves. */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** The rectangle after dragging the `edge` handle by (dx, dy), the opposite edges fixed. */
export function resizeRect(
  start: PanelRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewport: Viewport,
): PanelRect {
  const minW = Math.min(PANEL_MIN_WIDTH, viewport.width);
  const minH = Math.min(PANEL_MIN_HEIGHT, viewport.height);
  let { x, y, width, height } = start;
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  if (edge.includes('e')) width = Math.min(Math.max(start.width + dx, minW), viewport.width - x);
  if (edge.includes('s')) height = Math.min(Math.max(start.height + dy, minH), viewport.height - y);
  if (edge.includes('w')) {
    x = Math.min(Math.max(start.x + dx, 0), right - minW);
    width = right - x;
  }
  if (edge.includes('n')) {
    y = Math.min(Math.max(start.y + dy, 0), bottom - minH);
    height = bottom - y;
  }
  return clampRect({ x, y, width, height }, viewport);
}

interface AiPanelStore {
  open: boolean;
  /** Where the panel is; null for the default corner. */
  rect: PanelRect | null;
  /** The message being written (kept while the panel is closed). */
  draft: string;
  /** The history list is shown instead of the transcript. */
  historyOpen: boolean;

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  /** Moves or resizes the panel, kept inside the window. */
  setRect: (rect: PanelRect) => void;
  /** Moves the panel by (dx, dy) pixels, from its current or default place. */
  moveBy: (dx: number, dy: number) => void;
  /** Grows or shrinks the panel by (dw, dh) pixels from its bottom-right corner. */
  resizeBy: (dw: number, dh: number) => void;
  /** Back to the default corner and size. */
  resetRect: () => void;
  /** Keeps the panel inside the window after the window changed size. */
  clampToWindow: () => void;
  setDraft: (draft: string) => void;
  setHistoryOpen: (open: boolean) => void;
  toggleHistory: () => void;
  /** The panel as the session saved it for this folder (closed and default when null). */
  restore: (state: AiPanelState | null) => void;
}

/** The rectangle the panel is shown in, resolved against the window. */
export const selectPanelRect = (s: { rect: PanelRect | null }, viewport = windowViewport()) =>
  s.rect ? clampRect(s.rect, viewport) : defaultRect(viewport);

export const useAiPanel = create<AiPanelStore>()((set, get) => ({
  open: false,
  rect: null,
  draft: '',
  historyOpen: false,

  setOpen(open) {
    if (get().open !== open) set({ open });
  },
  toggleOpen() {
    set((s) => ({ open: !s.open }));
  },
  setRect(rect) {
    const next = clampRect(rect, windowViewport());
    const current = get().rect;
    if (
      current &&
      current.x === next.x &&
      current.y === next.y &&
      current.width === next.width &&
      current.height === next.height
    ) {
      return;
    }
    set({ rect: next });
  },
  moveBy(dx, dy) {
    const rect = selectPanelRect(get());
    get().setRect({ ...rect, x: rect.x + dx, y: rect.y + dy });
  },
  resizeBy(dw, dh) {
    const rect = selectPanelRect(get());
    get().setRect(resizeRect(rect, 'se', dw, dh, windowViewport()));
  },
  resetRect() {
    set({ rect: null });
  },
  clampToWindow() {
    const { rect } = get();
    if (rect) get().setRect(rect);
  },
  setDraft(draft) {
    set({ draft });
  },
  setHistoryOpen(historyOpen) {
    set({ historyOpen });
  },
  toggleHistory() {
    set((s) => ({ historyOpen: !s.historyOpen }));
  },
  restore(state) {
    set({ open: state?.open ?? false, rect: state?.rect ?? null, historyOpen: false });
  },
}));
