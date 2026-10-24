// Whether the region-capture overlay is shown. The overlay itself (and what happens with the
// selected region) lives in `features/capture/CaptureHost`; nothing here touches a provider.

import { create } from 'zustand';
import { selectActiveTab, useTabs } from './tabs';
import { useWorkspace } from './workspace';

interface CaptureStore {
  active: boolean;
  start: () => void;
  stop: () => void;
}

export const useCapture = create<CaptureStore>()((set) => ({
  active: false,
  start() {
    set({ active: true });
  },
  stop() {
    set({ active: false });
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
