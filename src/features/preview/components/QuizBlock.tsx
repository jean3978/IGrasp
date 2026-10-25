// An `igrasp-quiz` block of a quiz file as a question card: the choices, then the answer, the
// hint, the explanation and the sources folded, so reading the file does not spoil the quiz.
// A block that does not parse shows as the plain code it is.

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { parseQuestionBlock } from '../../quiz/quizFile';
import { InlineCode } from '../../quiz/InlineCode';
import { openSource, sourceLabel } from '../../quiz/quizSources';

export function QuizBlock({ source, fallback }: { source: string; fallback: ReactNode }) {
  const question = parseQuestionBlock(source);
  if (!question) return <>{fallback}</>;
  const letters = 'ABCDEFGHIJ';
  return (
    <div className="quiz-block" role="group" aria-label="Quiz question">
      <ol className="quiz-block-choices">
        {question.choices.map((c, i) => (
          <li key={i}>
            <span className="quiz-block-letter" aria-hidden>
              {letters[i] ?? String(i + 1)}
            </span>
            <InlineCode text={c} />
          </li>
        ))}
      </ol>
      <details className="quiz-block-answer">
        <summary>
          <ChevronRight aria-hidden className="quiz-block-chevron" />
          Show the answer
        </summary>
        <p>
          <strong>
            {letters[question.answer] ?? String(question.answer + 1)}.{' '}
            {question.choices[question.answer]}
          </strong>
        </p>
        {question.hint && (
          <p className="quiz-block-hint">
            Hint: <InlineCode text={question.hint} />
          </p>
        )}
        {question.explanation && (
          <p>
            <InlineCode text={question.explanation} />
          </p>
        )}
        {question.sources.length > 0 && (
          <ul className="quiz-block-sources" aria-label="Sources">
            {question.sources.map((s, i) => (
              <li key={`${s.path}-${String(i)}`}>
                {s.kind === 'binary' ? (
                  <code>{s.path}</code>
                ) : (
                  <button
                    type="button"
                    className="quiz-block-source"
                    onClick={() => {
                      openSource(s);
                    }}
                  >
                    {sourceLabel(s)}
                  </button>
                )}
                {s.why && <span className="quiz-block-why"> · {s.why}</span>}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
