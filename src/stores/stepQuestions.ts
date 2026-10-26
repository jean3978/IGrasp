// Questions readers save on a step of a tutorial: asked in the chat about a step card (the text
// highlighted or framed on it), then saved with the answer. A private tutorial keeps it at once;
// a shared one changes in the folder only through the write confirmation (the chapter's file
// gains the question). Saved questions carry no name and no date.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import type { StepQuestion, Tutorial, TutorialRef } from '../ipc/types';
import { errorMessage } from './aiProvider';
import { useToasts } from './toasts';
import { useTutorialPlayer } from './tutorialPlayer';
import { useTutorialWrite } from './tutorialWrite';

interface StepQuestionsState {
  /**
   * Saves `question` on step `question.step` of chapter `chapter`. Resolves to true when it was
   * saved (private) or its write is waiting for the confirmation (shared).
   */
  save: (reference: TutorialRef, chapter: number, question: StepQuestion) => Promise<boolean>;
  /** Removes the `index`-th saved question of chapter `chapter`. */
  remove: (reference: TutorialRef, chapter: number, index: number) => Promise<void>;
}

/** The tutorial after the change: kept (private), or offered as a write (shared). */
async function apply(reference: TutorialRef, t: Tutorial, saved: string) {
  if (reference.type === 'shared') {
    await useTutorialWrite.getState().prepare(reference, t.title, t);
    return;
  }
  useTutorialPlayer.getState().onSaved(t);
  useToasts.getState().notify('info', saved);
}

export const useStepQuestions = create<StepQuestionsState>()(() => ({
  async save(reference, chapter, question) {
    try {
      const t = await backend.saveStepQuestion(reference, chapter, question);
      await apply(
        reference,
        t,
        'Saved on the step, without your name. It goes with the tutorial when you share it.',
      );
      return true;
    } catch (err) {
      useToasts.getState().notify('error', `Cannot save the question: ${errorMessage(err)}`);
      return false;
    }
  },

  async remove(reference, chapter, index) {
    try {
      const t = await backend.removeStepQuestion(reference, chapter, index);
      await apply(reference, t, 'Question removed from the step.');
    } catch (err) {
      useToasts.getState().notify('error', `Cannot remove the question: ${errorMessage(err)}`);
    }
  },
}));
