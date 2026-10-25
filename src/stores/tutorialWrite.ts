// Writing a tutorial in the folder (plan §4.8): Share with the project, Save as…, and the updates
// of a shared tutorial (accepted changes, relocations, verification). Two steps, so the user sees
// the exact files before anything is written: `prepare` asks the backend for the plan (writes
// nothing), the dialog lists it, `confirm` writes. The only writes of the Academy in the folder.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import { BackendError } from '../ipc/types';
import type { Tutorial, WritePlan, WriteTarget, WrittenTutorial } from '../ipc/types';
import { errorMessage } from './aiProvider';
import { useAcademy } from './academy';
import { useTutorialPlayer } from './tutorialPlayer';
import { useToasts } from './toasts';

export interface PendingWrite {
  target: WriteTarget;
  /** The new version of a shared tutorial (`shared` target); a private one is written as stored. */
  tutorial: Tutorial | null;
  title: string;
  plan: WritePlan;
}

interface TutorialWriteState {
  pending: PendingWrite | null;
  busy: boolean;
  /** Why the plan or the write failed (shown in the dialog). */
  error: string | null;
  /** Asks for the plan and opens the confirmation (writes nothing). */
  prepare: (target: WriteTarget, title: string, tutorial?: Tutorial) => Promise<void>;
  /** Writes what the confirmation listed; resolves to where it went (null when cancelled). */
  confirm: () => Promise<WrittenTutorial | null>;
  cancel: () => void;
}

const DONE: Record<WriteTarget['type'], string> = {
  share: 'Shared with the project',
  shared: 'Shared tutorial updated',
  export: 'Tutorial saved',
};

export const useTutorialWrite = create<TutorialWriteState>((set, get) => ({
  pending: null,
  busy: false,
  error: null,

  async prepare(target, title, tutorial) {
    set({ busy: true, error: null });
    try {
      const plan = await backend.planTutorialWrite(target, tutorial);
      set({ pending: { target, tutorial: tutorial ?? null, title, plan }, busy: false });
    } catch (err) {
      set({ busy: false });
      useToasts.getState().notify('error', `Cannot share the tutorial: ${errorMessage(err)}`);
    }
  },

  async confirm() {
    const pending = get().pending;
    if (!pending || get().busy) return null;
    set({ busy: true, error: null });
    try {
      const written = await backend.writeTutorial(pending.target, pending.tutorial ?? undefined);
      set({ pending: null, busy: false });
      const where = written.readme ?? written.folder;
      useToasts
        .getState()
        .notify('info', `${DONE[pending.target.type]}: ${where}`, written.readme ?? undefined);
      void useAcademy.getState().refreshLibrary();
      // The open tutorial was the one written (a shared one updated): read it again.
      const open = useTutorialPlayer.getState().reference;
      if (open?.type === 'shared' && written.readme === open.relPath)
        void useTutorialPlayer.getState().load(open);
      return written;
    } catch (err) {
      if (err instanceof BackendError && err.code === 'SaveCancelled') {
        set({ busy: false });
        return null;
      }
      set({ busy: false, error: errorMessage(err) });
      return null;
    }
  },

  cancel() {
    if (get().busy) return;
    set({ pending: null, error: null });
  },
}));
