// One question as a card: the choices as big buttons (1–5, or True / False), the hint, and once
// answered the reveal: right or wrong, the explanation, and the sources ("Read more →" opens the
// file at its lines). Props only (no store), so the tutorials embed it as their Quick check.
// Keys while focus is inside the card: 1–5 or T/F answer, H shows the hint, L opens the cited
// files (Look it up), Enter goes on,
// Escape leaves.

import { clsx } from 'clsx';
import { ArrowRight, BookOpen, Check, Lightbulb, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { QuizQuestion } from '../../ipc/types';
import type { SourceNote } from './quizFile';
import { openSource, sourceLabel } from './quizSources';
import { InlineCode } from './InlineCode';
import { LevelFlames } from './LevelFlames';

export interface QuestionCardProps {
  question: QuizQuestion;
  /** 1-based position and the number of questions. */
  number: number;
  total: number;
  chosen: number | null;
  usedHint: boolean;
  onChoose: (choice: number) => void;
  onHint: () => void;
  /** "Look it up": opens the cited files; absent when the question cites none to read. */
  onLookUp?: () => void;
  lookedUp?: boolean;
  /** Enter after the reveal (the focused button does the same). */
  onNext?: () => void;
  onEscape?: () => void;
  /** Hoot's line for the reveal ("Nailed it."). */
  verdictLine?: string | null;
  /** Per source path, how it differs from when a quiz file was written. */
  sourceNotes?: Record<string, SourceNote['state']>;
  /** The buttons after the reveal (Next, Next round, See results). */
  actions?: ReactNode;
}

const isTrueFalse = (q: QuizQuestion) => q.kind === 'trueFalse';

export function QuestionCard(props: QuestionCardProps) {
  const { question, number, total, chosen, usedHint, onChoose, onHint, onNext, onEscape } = props;
  const revealed = chosen !== null;
  const correct = revealed && chosen === question.answer;
  const firstChoice = useRef<HTMLButtonElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);

  // A new question: focus its first choice. After the reveal: focus the reveal panel's action.
  useEffect(() => {
    firstChoice.current?.focus();
  }, [question.id]);
  useEffect(() => {
    if (revealed) revealRef.current?.querySelector<HTMLElement>('.quiz-next')?.focus();
  }, [revealed]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // Keys of the Look it up window bubble here through its portal: they are not the card's.
    if (!e.currentTarget.contains(e.target as Node)) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      e.stopPropagation();
      onEscape?.();
      return;
    }
    if (revealed) {
      const onButton = (e.target as HTMLElement).tagName === 'BUTTON';
      if ((key === 'enter' || key === ' ') && !onButton) {
        e.preventDefault();
        onNext?.();
      }
      return;
    }
    if (key === 'h') {
      e.preventDefault();
      onHint();
      return;
    }
    if (key === 'l' && props.onLookUp) {
      e.preventDefault();
      props.onLookUp();
      return;
    }
    if (isTrueFalse(question) && (key === 't' || key === 'f')) {
      e.preventDefault();
      onChoose(key === 't' ? 0 : 1);
      return;
    }
    const n = Number(key);
    if (Number.isInteger(n) && n >= 1 && n <= question.choices.length) {
      e.preventDefault();
      onChoose(n - 1);
    }
  };

  return (
    <article
      className={clsx('quiz-card', {
        'quiz-card-right': revealed && correct,
        'quiz-card-wrong': revealed && !correct,
      })}
      aria-labelledby={`quiz-q-${question.id}`}
      onKeyDown={onKeyDown}
    >
      <header className="quiz-card-header">
        <span className="quiz-card-count">
          Question {number} of {total}
        </span>
        <LevelFlames level={question.difficulty} label="Difficulty" small />
      </header>
      <h2 className="quiz-question" id={`quiz-q-${question.id}`}>
        <InlineCode text={question.question} />
      </h2>
      {usedHint && (
        <p className="quiz-hint" role="note">
          <Lightbulb aria-hidden /> <InlineCode text={question.hint} />
        </p>
      )}
      <div
        className={clsx('quiz-choices', { 'quiz-choices-tf': isTrueFalse(question) })}
        role="group"
        aria-label="Choices"
      >
        {question.choices.map((choice, i) => {
          const isAnswer = i === question.answer;
          const picked = chosen === i;
          const key = isTrueFalse(question) ? (i === 0 ? 'T' : 'F') : String(i + 1);
          return (
            <button
              key={choice}
              ref={i === 0 ? firstChoice : undefined}
              type="button"
              className={clsx('quiz-choice', {
                'quiz-choice-right': revealed && isAnswer,
                'quiz-choice-wrong': revealed && picked && !isAnswer,
                'quiz-choice-dim': revealed && !picked && !isAnswer,
              })}
              aria-pressed={picked}
              aria-keyshortcuts={key}
              disabled={revealed}
              onClick={() => {
                onChoose(i);
              }}
            >
              <kbd className="quiz-choice-key">{key}</kbd>
              <span className="quiz-choice-text">
                <InlineCode text={choice} />
              </span>
              {revealed && isAnswer && <Check aria-label="correct answer" />}
              {revealed && picked && !isAnswer && <X aria-label="your answer" />}
            </button>
          );
        })}
      </div>
      {!revealed && (
        <div className="quiz-card-tools">
          <button
            type="button"
            className="quiz-hint-button"
            onClick={onHint}
            disabled={usedHint}
            aria-keyshortcuts="H"
          >
            <Lightbulb aria-hidden /> {usedHint ? 'Hint shown' : 'Hint'}
          </button>
          {props.onLookUp && (
            <button
              type="button"
              className="quiz-hint-button quiz-look-button"
              onClick={props.onLookUp}
              aria-keyshortcuts="L"
              title="Open the files this question is about (L)"
            >
              <BookOpen aria-hidden /> {props.lookedUp ? 'Look again' : 'Look it up'}
            </button>
          )}
        </div>
      )}
      {revealed && (
        <div className="quiz-reveal" ref={revealRef}>
          <p
            className={clsx('quiz-verdict', correct ? 'quiz-verdict-right' : 'quiz-verdict-wrong')}
          >
            {correct ? <Check aria-hidden /> : <ArrowRight aria-hidden />}
            {props.verdictLine ?? (correct ? 'Correct.' : 'Not this time.')}
          </p>
          <p className="quiz-explanation">
            <InlineCode text={question.explanation} />
          </p>
          {question.sources.length > 0 && (
            <ul className="quiz-sources" aria-label="Sources">
              {question.sources.map((s, i) => {
                const note = props.sourceNotes?.[s.path];
                return (
                  <li key={`${s.path}-${String(i)}`}>
                    {s.kind === 'binary' || note === 'missing' ? (
                      <span className="quiz-source quiz-source-binary">{s.path}</span>
                    ) : (
                      <button
                        type="button"
                        className="quiz-source"
                        onClick={() => {
                          openSource(s);
                        }}
                      >
                        {i === 0 ? 'Read more → ' : ''}
                        <span className="quiz-source-path">{sourceLabel(s)}</span>
                      </button>
                    )}
                    {s.why && <span className="quiz-source-why"> · {s.why}</span>}
                    {note && (
                      <span className="quiz-source-note">
                        {' · '}
                        {note === 'missing'
                          ? 'this file is not in the folder'
                          : 'the source changed since this quiz was written'}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {props.actions && <div className="quiz-reveal-actions">{props.actions}</div>}
        </div>
      )}
    </article>
  );
}
