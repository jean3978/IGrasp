// The end of a quiz: the score, the level reached, the best streak, the time and the usage (or
// "no AI call" on a replay), Hoot, every question with your answer and its sources, and what to
// do next: save the results, play the same questions again (no AI), keep going (AI) or start a
// new quiz.

import { clsx } from 'clsx';
import { ChevronRight, FilePlus2, Plus, RotateCcw, Save, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import { selectQuizBusy, useQuiz } from '../../stores/quiz';
import { UsageLine } from '../ai/UsageLine';
import { Hoot } from '../hoot/Hoot';
import { pickLine } from '../hoot/hootLines';
import { InlineCode } from './InlineCode';
import { LevelFlames } from './LevelFlames';
import { openSource, sourceLabel } from './quizSources';
import { formatElapsed } from './quizFormat';

/** At this share of right answers, Hoot cheers. */
export const CHEER_FROM = 0.7;

function ScoreRing({ score, total, motion }: { score: number; total: number; motion: boolean }) {
  const [counted, setCounted] = useState(0);
  // The count-up, only with motion; without it the score shows at once.
  const shown = motion ? counted : score;
  useEffect(() => {
    if (!motion) return;
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      setCounted(Math.min(n, score));
      if (n >= score) clearInterval(timer);
    }, 90);
    return () => {
      clearInterval(timer);
    };
  }, [score, motion]);
  const share = total === 0 ? 0 : shown / total;
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="quiz-ring" role="img" aria-label={`${String(score)} of ${String(total)} right`}>
      <svg viewBox="0 0 100 100" width="132" height="132" aria-hidden>
        <circle className="quiz-ring-track" cx="50" cy="50" r={r} />
        <circle
          className="quiz-ring-value"
          cx="50"
          cy="50"
          r={r}
          strokeDasharray={`${String(c * share)} ${String(c)}`}
        />
      </svg>
      <span className="quiz-ring-text" aria-hidden>
        <strong>{shown}</strong>/{total}
      </span>
    </div>
  );
}

export function ResultsScreen({
  motion,
  onSaveResults,
  onSaveQuiz,
}: {
  motion: boolean;
  onSaveResults?: () => void;
  /** Save quiz… (not for a quiz played from a file: it is already one). */
  onSaveQuiz?: () => void;
}) {
  const record = useQuiz((s) => s.record);
  const failure = useQuiz((s) => s.failure);
  const playAgain = useQuiz((s) => s.playAgain);
  const keepGoing = useQuiz((s) => s.keepGoing);
  const newQuiz = useQuiz((s) => s.newQuiz);
  const busy = useQuiz(selectQuizBusy);
  const [line] = useState(() => {
    const share = record && record.answers.length > 0 ? record.score / record.answers.length : 0;
    return pickLine(share >= CHEER_FROM ? 'resultsHigh' : 'resultsLow');
  });
  // The Next button that led here is gone: focus the results so a screen reader reads them.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  if (!record) return null;
  const answered = record.answers.length;
  const share = answered === 0 ? 0 : record.score / answered;
  const generated = record.origin.type === 'generated';
  const elapsed = (record.finishedMs ?? record.startedMs) - record.startedMs;

  return (
    <div className="quiz-results">
      <section className="quiz-results-top">
        <ScoreRing score={record.score} total={answered} motion={motion} />
        <div className="quiz-results-facts">
          <h2 className="quiz-title" ref={titleRef} tabIndex={-1}>
            <span className="visually-hidden">
              Results: {record.score} of {answered} right.{' '}
            </span>
            {record.subjectTitle}
          </h2>
          <p className="quiz-results-line">
            Level reached <LevelFlames level={record.level} /> · best streak {record.bestStreak} ·{' '}
            {formatElapsed(elapsed)}
          </p>
          {generated ? (
            <div className="quiz-results-usage">
              <UsageLine
                inputTokens={record.usage.inputTokens}
                outputTokens={record.usage.outputTokens}
                costUsd={record.usage.costUsd}
                durationMs={record.durationMs}
              />
              {(record.attempts > record.rounds || record.rounds > 1) && (
                <span className="quiz-muted">
                  {record.rounds > 1 ? `${String(record.rounds)} rounds` : ''}
                  {record.rounds > 1 && record.attempts > record.rounds ? ' · ' : ''}
                  {record.attempts > record.rounds ? `${String(record.attempts)} attempts` : ''}
                </span>
              )}
            </div>
          ) : (
            <p className="quiz-muted">Replayed: no AI call.</p>
          )}
          {record.materialNote && <p className="quiz-note">{record.materialNote}</p>}
          {record.suggestedSubjects.length > 0 && (
            <p className="quiz-muted">
              Subjects that may work better: {record.suggestedSubjects.join(' · ')}
            </p>
          )}
          {failure && (
            <p className="quiz-note" role="alert">
              {failure.message}
            </p>
          )}
        </div>
        <Hoot
          state={share >= CHEER_FROM ? 'cheering' : 'encouraging'}
          size={110}
          line={line}
          motion={motion}
        />
      </section>

      <div className="quiz-results-actions">
        {onSaveResults && (
          <Button onClick={onSaveResults}>
            <Save aria-hidden /> Save results…
          </Button>
        )}
        {onSaveQuiz && record.origin.type !== 'file' && (
          <Button onClick={onSaveQuiz} title="A file anyone can replay without the AI">
            <Share2 aria-hidden /> Save quiz…
          </Button>
        )}
        <Button onClick={() => void playAgain()} title="The same questions again, without the AI">
          <RotateCcw aria-hidden /> Play again
        </Button>
        {record.origin.type === 'generated' && (
          <Button onClick={() => void keepGoing()} disabled={busy}>
            <FilePlus2 aria-hidden /> Keep going <AiMark />
          </Button>
        )}
        <Button variant="primary" onClick={newQuiz}>
          <Plus aria-hidden /> New quiz
        </Button>
      </div>

      <ol className="quiz-review" aria-label="Your answers">
        {record.answers.map((a) => {
          const q = record.questions.find((x) => x.id === a.questionId);
          if (!q) return null;
          return (
            <li
              key={a.questionId}
              className={clsx(
                'quiz-review-item',
                a.correct ? 'quiz-review-right' : 'quiz-review-wrong',
              )}
            >
              <details>
                <summary>
                  <ChevronRight aria-hidden className="quiz-review-chevron" />
                  <span className="quiz-review-mark">{a.correct ? 'Right' : 'Missed'}</span>
                  <span className="quiz-review-question">
                    <InlineCode text={q.question} />
                  </span>
                </summary>
                <p>
                  Your answer: <strong>{q.choices[a.chosen] ?? '?'}</strong>
                  {!a.correct && (
                    <>
                      {' '}
                      · correct: <strong>{q.choices[q.answer]}</strong>
                    </>
                  )}
                  {a.usedHint && <span className="quiz-muted"> · with hint</span>}
                </p>
                <p className="quiz-explanation">
                  <InlineCode text={q.explanation} />
                </p>
                <ul className="quiz-sources">
                  {q.sources.map((s, i) => (
                    <li key={`${s.path}-${String(i)}`}>
                      {s.kind === 'binary' ? (
                        <span className="quiz-source quiz-source-binary">{s.path}</span>
                      ) : (
                        <button
                          type="button"
                          className="quiz-source"
                          onClick={() => {
                            openSource(s);
                          }}
                        >
                          <span className="quiz-source-path">{sourceLabel(s)}</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
