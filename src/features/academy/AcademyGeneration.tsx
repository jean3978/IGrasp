// While a tutorial operation runs: Hoot thinking, what the AI reads, the chapter being written,
// a retry when steps did not check out, the elapsed time, the chapters already written (readable
// at once) and Stop.

import { BookOpen, Check, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useAcademy } from '../../stores/academy';
import { Hoot } from '../hoot/Hoot';
import { pickLine } from '../hoot/hootLines';
import { formatElapsed } from '../quiz/quizFormat';

export function AcademyGeneration({ motion }: { motion: boolean }) {
  const generation = useAcademy((s) => s.generation);
  const tutorial = useAcademy((s) => s.tutorial);
  const cancel = useAcademy((s) => s.cancel);
  const openTutorial = useAcademy((s) => s.openTutorial);
  const running = useAcademy((s) => s.operationId !== null);
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
  const stage = generation?.stage;
  const line = useMemo(
    () =>
      attempt
        ? pickLine('checkingSteps')
        : lastRead
          ? pickLine('reading', { file: lastRead.replace(/^\w+\s+/, '') })
          : stage
            ? pickLine('writing')
            : pickLine('outline'),
    [lastRead, attempt, stage],
  );
  if (!generation) return null;
  const written = generation.written;
  return (
    <div className="quiz-generating" aria-busy="true">
      <Hoot state="thinking" size={140} line={line} motion={motion} label="Hoot is writing" />
      <div className="quiz-generating-text">
        <h2 className="quiz-panel-title" role="status">
          {stage
            ? `Chapter ${String(stage.number)} of ${String(stage.of)}: ${stage.label}`
            : generation.kind === 'outline'
              ? 'Planning the outline'
              : generation.kind === 'review'
                ? 'Checking the tutorial against the project'
                : 'Writing the chapters'}
        </h2>
        <ul className="quiz-activity" aria-label="What the AI reads">
          {generation.activity.map((a, i) => (
            <li key={`${a}-${String(i)}`}>{a}</li>
          ))}
        </ul>
        <p className="quiz-muted">
          {generation.filesRead > 0 ? `${String(generation.filesRead)} files read · ` : ''}
          {formatElapsed(now - generation.startedMs)}
        </p>
        {attempt && (
          <p className="quiz-attempt" role="status">
            Checking the steps… retry {attempt.number - 1} of {attempt.of - 1}: {attempt.reason}
          </p>
        )}
        {written.length > 0 && tutorial && (
          <div className="academy-written">
            <ul aria-label="Chapters written">
              {written.map((id) => (
                <li key={id}>
                  <Check aria-hidden /> {tutorial.chapters.find((c) => c.id === id)?.title ?? id}
                </li>
              ))}
            </ul>
            <Button
              variant="primary"
              onClick={() => {
                openTutorial({ type: 'private', id: tutorial.id });
              }}
            >
              <BookOpen aria-hidden /> Start reading
            </Button>
          </div>
        )}
        <Button onClick={() => void cancel()} disabled={!running}>
          <Square aria-hidden /> Stop
        </Button>
      </div>
    </div>
  );
}
