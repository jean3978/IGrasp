// The questions readers saved on a step, under its card: what they pointed at, their question
// and the answer, without any name. Below them, the way to ask one, said in words: the chat
// opens about the whole step, or about the words the reader highlights on it (the text mode,
// with a hint while it is on). Once answered, the chat offers to keep it here.

import { Highlighter, MessageCircleQuestion, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { StepQuestion, TutorialRef } from '../../ipc/types';
import { useCapture } from '../../stores/capture';
import { useStepQuestions } from '../../stores/stepQuestions';
import { askAboutStep } from '../capture/stepCapture';
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
      <AskAboutStep />
    </section>
  );
}

function AskAboutStep() {
  const highlighting = useCapture((s) => s.textMode);
  const hintId = 'academy-ask-help';
  return (
    <div className="academy-ask" data-highlighting={highlighting ? 'true' : undefined}>
      <MessageCircleQuestion aria-hidden className="academy-ask-icon" />
      <div className="academy-ask-body">
        <p className="academy-ask-title">Something unclear in this step?</p>
        <p id={hintId} className="academy-ask-help">
          Ask the AI in the chat: about the whole step, or highlight the words that puzzle you
          first. Nothing is sent until you press Send.
        </p>
        <div className="academy-ask-actions">
          <Button
            variant="secondary"
            aria-describedby={hintId}
            onClick={(e) => {
              const card = e.currentTarget.closest('article.academy-step');
              if (card) askAboutStep(card, e.currentTarget);
            }}
          >
            <MessageCircleQuestion aria-hidden /> Ask about this step
          </Button>
          <Button
            variant="ghost"
            aria-pressed={highlighting}
            title="Ctrl+Alt+S (Ctrl+Alt+R frames a region instead)"
            onClick={() => {
              runAction('ai.selectText');
            }}
          >
            <Highlighter aria-hidden />{' '}
            {highlighting ? 'Stop highlighting' : 'Highlight words to ask'}
          </Button>
        </div>
        {highlighting && (
          <p className="academy-ask-hint" role="status">
            Now select the words you are asking about with the mouse: the chat opens when you
            release it. Escape stops.
          </p>
        )}
      </div>
    </div>
  );
}
