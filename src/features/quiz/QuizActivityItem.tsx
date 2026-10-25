// The status bar item shown while a quiz is being written and the Quiz tab is not active: the
// operation belongs to the user's action, so it stays visible and stoppable.

import { LoaderCircle } from 'lucide-react';
import { useQuiz, selectQuizBusy } from '../../stores/quiz';
import { useTabs } from '../../stores/tabs';
import { CancelButton } from '../ai/CancelButton';

export function QuizActivityItem() {
  const busy = useQuiz(selectQuizBusy);
  const cancel = useQuiz((s) => s.cancel);
  const onTab = useTabs((s) => s.activeId === 'tab-quiz');
  if (!busy || onTab) return null;
  return (
    <span className="statusbar-item ai-activity">
      <button
        type="button"
        className="statusbar-item statusbar-button"
        title="Show the quiz"
        onClick={() => {
          useTabs.getState().openSpecial('quiz');
        }}
      >
        <LoaderCircle className="spin" aria-hidden />
        Writing a quiz…
      </button>
      <CancelButton
        variant="inline"
        onCancel={() => {
          void cancel();
        }}
      />
    </span>
  );
}
