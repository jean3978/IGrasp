// A question being played: progress, level flames, the streak, Hoot reacting, the question card
// and what comes next (the next question, the next adaptive round, or the results).

import { clsx } from 'clsx';
import { ArrowRight, Flame, Home } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { afterReveal, useQuiz } from '../../stores/quiz';
import { Hoot } from '../hoot/Hoot';
import type { HootState } from '../hoot/Hoot';
import { pickLine } from '../hoot/hootLines';
import { LevelFlames } from './LevelFlames';
import { QuestionCard } from './QuestionCard';

/** How long Hoot cheers or encourages before it explains. */
export const REACTION_MS = 1000;

export function QuestionScreen({ motion }: { motion: boolean }) {
  const sourceNotes = useQuiz((s) => s.sourceNotes);
  const record = useQuiz((s) => s.record);
  const engine = useQuiz((s) => s.engine);
  const answer = useQuiz((s) => s.answer);
  const hint = useQuiz((s) => s.hint);
  const next = useQuiz((s) => s.next);
  const nextRound = useQuiz((s) => s.nextRound);
  const goHome = useQuiz((s) => s.goHome);
  const after = useQuiz(afterReveal);
  /** The question whose reaction is over: Hoot explains it. */
  const [explained, setExplained] = useState<string | null>(null);

  const question = record?.questions.find((q) => q.id === engine?.current) ?? null;
  const chosen = engine?.chosen ?? null;
  const noteList = question ? sourceNotes[question.id] : undefined;
  const notes = noteList && Object.fromEntries(noteList.map((n) => [n.path, n.state]));
  const answered = record?.answers.length ?? 0;
  const right = question !== null && chosen === question.answer;
  const lastAnswer = record?.answers[record.answers.length - 1];
  const level = engine?.level ?? 0;
  const streak = engine?.streak ?? 0;
  const levelUp =
    chosen !== null &&
    lastAnswer?.questionId === question?.id &&
    level > (lastAnswer?.levelAt ?? level);

  // Hoot's line for an answer: a level up, a streak, or right or wrong.
  const line = useMemo(() => {
    if (chosen === null) return null;
    if (levelUp) return pickLine('levelUp');
    if (right && streak >= 3) return pickLine('streak', { n: streak });
    return pickLine(right ? 'right' : 'wrong');
    // A new answer (or a new question) picks a new line, nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, question?.id]);

  // After the reaction, Hoot explains.
  useEffect(() => {
    if (chosen === null || !question) return;
    const id = question.id;
    const timer = setTimeout(() => {
      setExplained(id);
    }, REACTION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [chosen, question]);

  const hoot: HootState =
    chosen === null
      ? 'idle'
      : explained === question?.id
        ? 'explaining'
        : right
          ? 'cheering'
          : 'encouraging';
  const announcement =
    chosen === null || !question
      ? ''
      : `${right ? 'Correct' : `Not this time: the answer is ${question.choices[question.answer] ?? ''}`}. Level ${String(level)} of 5.${streak >= 2 ? ` Streak ${String(streak)}.` : ''}`;

  if (!record || !engine) return null;
  if (!question) return null;
  const total = record.questions.length;
  const position = engine.asked.indexOf(question.id) + 1;

  const actions =
    after === 'nextRound' ? (
      <Button variant="primary" className="quiz-next" onClick={() => void nextRound()}>
        Next round <AiMark /> <ArrowRight aria-hidden />
      </Button>
    ) : (
      <Button variant="primary" className="quiz-next" onClick={next}>
        {after === 'next' ? 'Next' : 'See results'} <ArrowRight aria-hidden />
      </Button>
    );

  return (
    <div className="quiz-play">
      <header className="quiz-play-header">
        <IconButton label="Back to the quiz home (Escape)" onClick={goHome}>
          <Home aria-hidden />
        </IconButton>
        <div
          className="quiz-progress"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answered}
          aria-valuetext={`${String(answered)} of ${String(total)} answered`}
        >
          {/* In the order played: the answers, the current question, then what is left. */}
          {record.questions.map((q, i) => {
            const a = record.answers[i];
            return (
              <span
                key={q.id}
                className={clsx('quiz-dot', {
                  'quiz-dot-right': a?.correct === true,
                  'quiz-dot-wrong': a?.correct === false,
                  'quiz-dot-current': i === answered && chosen === null,
                })}
                aria-hidden
              />
            );
          })}
        </div>
        <LevelFlames level={engine.level} />
        <span
          className={clsx('quiz-streak', {
            'quiz-streak-shown': streak >= 2,
            'quiz-streak-hot': streak >= 3,
            'quiz-streak-blazing': streak >= 5,
          })}
          aria-hidden={streak < 2}
        >
          <Flame aria-hidden /> {streak} in a row
        </span>
        <span className="quiz-subject-name" title={record.subjectTitle}>
          {record.subjectTitle}
        </span>
      </header>
      <div className="quiz-stage">
        <div className="quiz-stage-hoot">
          <Hoot
            state={hoot}
            size={110}
            line={line}
            announce={false}
            motion={motion}
            label={`Hoot is ${hoot}`}
          />
        </div>
        <QuestionCard
          question={question}
          number={position}
          total={total}
          chosen={chosen}
          usedHint={engine.usedHint}
          onChoose={answer}
          onHint={hint}
          onNext={() => {
            if (after === 'nextRound') void nextRound();
            else next();
          }}
          onEscape={goHome}
          {...(notes ? { sourceNotes: notes } : {})}
          actions={actions}
        />
      </div>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
