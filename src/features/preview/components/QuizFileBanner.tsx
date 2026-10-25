// The top of a quiz file in the preview: what it is and "Play this quiz", which opens the Quiz
// tab and replays it without the AI. Shown instead of the front matter card (its hashes are
// noise to a reader).

import { Play } from 'lucide-react';
import { HootIcon } from '../../hoot/HootIcon';
import { Button } from '../../../components/ui/Button';
import { useQuiz } from '../../../stores/quiz';
import { useTabs } from '../../../stores/tabs';

export interface QuizFileFacts {
  title: string | null;
  subject: string | null;
  questions: number;
}

export function QuizFileBanner({ relPath, facts }: { relPath: string; facts: QuizFileFacts }) {
  return (
    <section className="quiz-file-banner" aria-label="Quiz file">
      <HootIcon className="quiz-file-banner-icon" />
      <div className="quiz-file-banner-text">
        <strong>{facts.subject ?? facts.title ?? 'A quiz'}</strong>
        <span>
          A quiz written for this project, {facts.questions} question
          {facts.questions === 1 ? '' : 's'}. It plays without the AI.
        </span>
      </div>
      {relPath !== '' && (
        <Button
          variant="primary"
          onClick={() => {
            useTabs.getState().openSpecial('quiz');
            void useQuiz.getState().playFile(relPath);
          }}
        >
          <Play aria-hidden /> Play this quiz
        </Button>
      )}
    </section>
  );
}
