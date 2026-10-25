// The tutorial being read (plan §6.2): the tutorial and the reader's progress, the course map or
// the open chapter and step, completing steps (XP, streak, chapters, graduation through
// `academyEngine`), and the progress saved after every step. All local: reading never calls the
// AI.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { Tutorial, TutorialProgress, TutorialRef } from '../ipc/types';
import {
  completeStep,
  emptyProgress,
  resumeStep,
  updatedSince,
} from '../features/academy/academyEngine';
import type { StepOutcome } from '../features/academy/academyEngine';
import { errorMessage } from './aiProvider';
import { onTutorialSaved } from './academy';
import { useToasts } from './toasts';

/** The last thing that happened, for the effects and the announcements. */
export interface PlayerEvent {
  kind: 'gain' | 'chapterDone' | 'graduated' | 'streak';
  xp: number;
  /** Increases on every event, so the same kind twice is still a change. */
  seq: number;
}

interface PlayerState {
  reference: TutorialRef | null;
  tutorial: Tutorial | null;
  progress: TutorialProgress | null;
  error: string | null;
  /** The open chapter (index); null shows the course map. */
  chapter: number | null;
  step: number;
  /** Steps completed before they changed ("updated since you read it"). */
  updated: Set<string>;
  event: PlayerEvent | null;
  /** The graduation screen is shown (once, when the last chapter completes). */
  graduation: boolean;

  load: (reference: TutorialRef) => Promise<void>;
  openChapter: (index: number) => void;
  showMap: () => void;
  goto: (step: number) => void;
  next: () => void;
  previous: () => void;
  /** Completes the step on screen; moves on unless `stay`. */
  complete: (outcome: StepOutcome, stay?: boolean) => void;
  closeGraduation: () => void;
  /** The tutorial was saved (a chapter written, a proposal accepted): shown at once. */
  onSaved: (t: Tutorial) => void;
  close: () => void;
}

const keyOf = (r: TutorialRef) => (r.type === 'private' ? r.id : r.relPath);

export const useTutorialPlayer = create<PlayerState>()((set, get) => {
  let seq = 0;
  /** Saves are chained so an older progress never overwrites a newer one. */
  let saving: Promise<void> = Promise.resolve();
  const save = (p: TutorialProgress) => {
    saving = saving
      .then(() => backend.saveTutorialProgress(p))
      .catch((err: unknown) => {
        useToasts.getState().notify('error', `Cannot save your progress: ${errorMessage(err)}`);
      });
  };

  return {
    reference: null,
    tutorial: null,
    progress: null,
    error: null,
    chapter: null,
    step: 0,
    updated: new Set(),
    event: null,
    graduation: false,

    async load(reference) {
      const same = get().reference && keyOf(get().reference as TutorialRef) === keyOf(reference);
      set({ reference, error: null, ...(same ? {} : { tutorial: null, progress: null }) });
      try {
        const tutorial = await backend.getTutorial(reference);
        const saved = await backend.getTutorialProgress(tutorial.id);
        const now = Date.now();
        const progress = { ...(saved ?? emptyProgress(tutorial.id, now)), lastOpenedMs: now };
        save(progress);
        if (get().reference !== reference) return;
        set({
          tutorial,
          progress,
          updated: updatedSince(tutorial, progress),
          chapter: same ? get().chapter : null,
          step: same ? get().step : 0,
          graduation: false,
        });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    openChapter(index) {
      const { tutorial, progress } = get();
      const c = tutorial?.chapters[index];
      if (!tutorial || !progress || !c || c.steps.length === 0) return;
      const step =
        progress.chapter === index && progress.step < c.steps.length
          ? progress.step
          : resumeStep(c, progress);
      const next = { ...progress, chapter: index, step, lastOpenedMs: Date.now() };
      set({ chapter: index, step, progress: next });
      save(next);
    },

    showMap() {
      set({ chapter: null });
    },

    goto(step) {
      const { tutorial, chapter, progress } = get();
      const c = chapter === null ? undefined : tutorial?.chapters[chapter];
      if (!c || !progress || step < 0 || step >= c.steps.length) return;
      set({ step, progress: { ...progress, step } });
    },

    next() {
      const { tutorial, chapter, step } = get();
      const c = chapter === null ? undefined : tutorial?.chapters[chapter];
      if (!c) return;
      if (step + 1 < c.steps.length) get().goto(step + 1);
      else set({ chapter: null });
    },

    previous() {
      get().goto(get().step - 1);
    },

    complete(outcome, stay = false) {
      const { tutorial, progress, chapter, step } = get();
      if (!tutorial || !progress || chapter === null) return;
      const done = completeStep(tutorial, progress, chapter, step, outcome, Date.now());
      const event: PlayerEvent | null = done.graduated
        ? { kind: 'graduated', xp: done.gained, seq: ++seq }
        : done.chapterDone
          ? { kind: 'chapterDone', xp: done.gained, seq: ++seq }
          : done.streakMilestone
            ? { kind: 'streak', xp: done.gained, seq: ++seq }
            : done.gained > 0
              ? { kind: 'gain', xp: done.gained, seq: ++seq }
              : get().event;
      set({
        progress: done.progress,
        updated: updatedSince(tutorial, done.progress),
        event,
        graduation: get().graduation || done.graduated,
      });
      save(done.progress);
      if (!stay) {
        if (done.chapterDone || done.graduated) set({ chapter: null });
        else get().next();
      }
    },

    closeGraduation() {
      set({ graduation: false, chapter: null });
    },

    onSaved(t) {
      const { tutorial, progress } = get();
      if (!tutorial || tutorial.id !== t.id) return;
      set({ tutorial: t, updated: progress ? updatedSince(t, progress) : new Set() });
    },

    close() {
      set({
        reference: null,
        tutorial: null,
        progress: null,
        error: null,
        chapter: null,
        step: 0,
        updated: new Set(),
        event: null,
        graduation: false,
      });
    },
  };
});

onTutorialSaved((t) => {
  useTutorialPlayer.getState().onSaved(t);
});
