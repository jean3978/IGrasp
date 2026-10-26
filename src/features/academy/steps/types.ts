// What every step component receives from the chapter player.

import type { Citation, StepAnswer } from '../../../ipc/types';
import type { StepOutcome } from '../academyEngine';
import type { SourceStatus } from './stepUtils';

export interface StepProps {
  /** `"<chapter id>:<index>"`: the step's key in the progress (and the React key). */
  stepKey: string;
  /** The step was completed before (a re-read). */
  done: boolean;
  /** How an interactive step was answered before. */
  answer: StepAnswer | undefined;
  /** The step's citations (the first is "Read more →"). */
  sources: Citation[];
  /** Per citation label (`path:lines`), whether it changed or went missing. */
  sourceStatus: Record<string, SourceStatus>;
  first: boolean;
  motion: boolean;
  /** Completes the step; the player moves on unless `stay`. */
  onComplete: (outcome: StepOutcome, stay?: boolean) => void;
  onNext: () => void;
  onPrevious: () => void;
  /** Back to the course map. */
  onEscape: () => void;
}
