// The questions readers saved on a step, under its card: what they pointed at, their question
// and the answer, without any name. A reader asks one by highlighting text of the step (or
// framing part of it) and writing in the chat; the chat's "Save to this step" keeps it here.

import { MessageCircleQuestion, TextCursor, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { StepQuestion, TutorialRef } from '../../ipc/types';
import { useStepQuestions } from '../../stores/stepQuestions';
import { runAction } from '../titlebar/menuActions';
import { StepMarkdown } from './steps/common';

export function StepQuestions({
  reference,
  chapter,
  step,
  questions,
}: {
  reference: TutorialRef;
  chapter: number;
  step: number;
  /** Every saved question of the chapter (the index is what removing needs). */
  questions: StepQuestion[];
}) {
  const remove = useStepQuestions((s) => s.remove);
  const mine = questions.map((q, index) => ({ q, index })).filter(({ q }) => q.step === step);
  return (
    <section className="academy-questions" aria-label="Questions from readers">
      {mine.length > 0 && (
        <details open={mine.length <= 2}>
          <summary>
            <MessageCircleQuestion aria-hidden className="academy-inline-icon" />{' '}
            {mine.length === 1
              ? '1 question from a reader'
              : `${String(mine.length)} questions from readers`}
          </summary>
          <ul className="academy-questions-list">
            {mine.map(({ q, index }) => (
              <li key={index}>
                {q.quote && <blockquote className="academy-question-quote">{q.quote}</blockquote>}
                <p className="academy-question-text">
                  <strong>Q.</strong> {q.question}
                </p>
                <StepMarkdown
                  text={q.answer}
                  className="academy-markdown academy-question-answer"
                />
                <Button
                  variant="ghost"
                  aria-label={`Remove the question “${q.question}”`}
                  title={
                    reference.type === 'shared'
                      ? 'Remove it from the shared tutorial (you confirm the write)'
                      : 'Remove it from this tutorial'
                  }
                  onClick={() => void remove(reference, chapter, index)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="academy-questions-ask">
        <Button
          variant="ghost"
          onClick={() => {
            runAction('ai.selectText');
          }}
          title="Highlight text of this step, then write your question in the chat (Ctrl+Alt+S; Ctrl+Alt+R frames a region)"
        >
          <TextCursor aria-hidden /> Ask about this step
        </Button>
      </p>
    </section>
  );
}
