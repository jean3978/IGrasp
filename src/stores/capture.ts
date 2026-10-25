// How the user points the AI chat at part of a document: the region overlay (drag a rectangle,
// one selection), the text mode (highlight text like in an editor; stays on until turned off),
// and the highlight that keeps the selection visible while the chat is open. The overlay and
// what happens with a selection live in `features/capture/CaptureHost`; nothing here touches a
// provider.

import { create } from 'zustand';
import type { AiCapture } from '../ipc/types';
import { selectActiveTab, useTabs } from './tabs';
import { useWorkspace } from './workspace';

/** A box in the scroll container's content coordinates (it scrolls with the document). */
export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The selection the chat is about, painted over the document while the chat is open. */
export interface SelectionHighlight {
  tabId: string;
  kind: 'text' | 'region';
  /** The lines and their source (what the chat attaches). */
  capture: AiCapture;
  /** The line boxes of the selected text. */
  rects: ContentRect[];
  /** The dragged rectangle (a region only). */
  region: ContentRect | null;
}

interface CaptureStore {
  /** The region overlay is shown. */
  active: boolean;
  /** Releasing the mouse after highlighting text opens the chat about it. */
  textMode: boolean;
  highlight: SelectionHighlight | null;
  /** Shows the region overlay (and leaves the text mode). */
  start: () => void;
  stop: () => void;
  setTextMode: (on: boolean) => void;
  setHighlight: (highlight: SelectionHighlight | null) => void;
}

export const useCapture = create<CaptureStore>()((set) => ({
  active: false,
  textMode: false,
  highlight: null,
  start() {
    set({ active: true, textMode: false });
  },
  stop() {
    set({ active: false });
  },
  setTextMode(textMode) {
    set(textMode ? { textMode, active: false } : { textMode });
  },
  setHighlight(highlight) {
    set({ highlight });
  },
}));

const isCapturable = (s: Parameters<typeof selectActiveTab>[0]): boolean => {
  const tab = selectActiveTab(s);
  return tab !== undefined && (tab.kind === 'document' || tab.kind === 'code');
};

/** A folder is open and its active tab is a document or a code file. */
export const canCapture = (): boolean =>
  useWorkspace.getState().root !== null && isCapturable(useTabs.getState());

export const useCanCapture = (): boolean => {
  const hasRoot = useWorkspace((s) => s.root !== null);
  const capturable = useTabs(isCapturable);
  return hasRoot && capturable;
};
