// While a generation runs: Hoot thinking, what the AI reads, a retry when questions did not
// check out, the round being written, the elapsed time and Stop.

import { Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useQuiz } from '../../stores/quiz';
import { Hoot } from '../hoot/Hoot';
import { pickLine } from '../hoot/hootLines';
import { formatElapsed } from './quizFormat';

export function GenerationScreen({ motion }: { motion: boolean }) {
  const generation = useQuiz((s) => s.generation);
  const cancel = useQuiz((s) => s.cancel);
  const running = useQuiz((s) => s.operationId !== null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const lastRead = generation?.activity[generation.activity.length - 1];
  const attempt = generation?.attempt;
  // A new line when the AI reads another file or a retry starts.
  const line = useMemo(
    () =>
      attempt
        ? pickLine('retrying')
        : lastRead
          ? pickLine('reading', { file: lastRead.replace(/^\w+\s+/, '') })
          : pickLine('thinking'),
    [lastRead, attempt],
  );
  if (!generation) return null;
  const { round } = generation;
  return (
    <div className="quiz-generating" aria-busy="true">
      <Hoot
        state="thinking"
        size={140}
        line={line}
        motion={motion}
        label="Hoot is writing questions"
      />
      <div className="quiz-generating-text">
        <h2 className="quiz-panel-title">
          {round
            ? `Round ${String(round.number)} of ${String(round.of)} at level ${String(round.level)}`
            : generation.kind === 'keepGoing'
              ? 'Writing more questions'
              : 'Writing your quiz'}
        </h2>
        <ul className="quiz-activity" aria-label="What the AI reads">
          {generation.activity.map((a, i) => (
            <li key={`${a}-${String(i)}`}>{a}</li>
          ))}
        </ul>
        <p className="quiz-muted" role="status">
          {generation.filesRead > 0 ? `${String(generation.filesRead)} files read · ` : ''}
          {formatElapsed(now - generation.startedMs)}
        </p>
        {attempt && (
          <p className="quiz-attempt" role="status">
            Checking the questions… retry {attempt.number - 1} of {attempt.of - 1}: {attempt.reason}
          </p>
        )}
        <Button onClick={() => void cancel()} disabled={!running}>
          <Square aria-hidden /> Stop
        </Button>
      </div>
    </div>
  );
}
