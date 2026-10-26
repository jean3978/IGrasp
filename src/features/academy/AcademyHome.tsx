// The Academy's hub: a classroom. The tutorials of this folder are on the blackboard (one concise
// line each, details behind a button, scrolled when there are many); in front of it, Hoot teaches
// and a few owls listen at their desks. "New tutorial" opens the wizard (role, subject, options,
// confirmation); "Continue" resumes the last tutorial. Opening it spends nothing.

import { Play, Plus } from 'lucide-react';
import { useId, useMemo } from 'react';
import { Button } from '../../components/ui/Button';
import type { TutorialSummary } from '../../ipc/types';
import { selectAcademyBusy, useAcademy } from '../../stores/academy';
import { Hoot } from '../hoot/Hoot';
import type { HootState } from '../hoot/Hoot';
import { ProjectProfilePanel } from '../profile/ProjectProfilePanel';
import { Blackboard } from './TutorialBoard';

export function AcademyHome({ hootLine, motion }: { hootLine: string; motion: boolean }) {
  const failure = useAcademy((s) => s.failure);
  const library = useAcademy((s) => s.library);
  const startNew = useAcademy((s) => s.startNew);
  const helpId = useId();
  const busy = useAcademy(selectAcademyBusy);
  const resume = useMemo(
    () =>
      library
        .filter((t) => t.progress && !t.progress.graduated && t.chaptersWritten > 0)
        .sort((a, b) => (b.progress?.lastOpenedMs ?? 0) - (a.progress?.lastOpenedMs ?? 0))[0],
    [library],
  );

  return (
    <div className="academy-home">
      <header className="academy-hub-head">
        <div className="academy-hub-text">
          <h1 className="quiz-title">Hoot&apos;s Academy</h1>
          <p className="quiz-lead">
            Tutorials about this project, written from its own files: every step cites a file you
            can open, and you take them at your pace.
          </p>
        </div>
        <div className="academy-hub-cta">
          <Button
            variant="primary"
            className="academy-new"
            onClick={startNew}
            disabled={busy}
            aria-describedby={helpId}
          >
            <Plus aria-hidden /> New tutorial
          </Button>
          <span id={helpId} className="quiz-muted">
            Role, subject, options, then a confirmation: nothing is spent before you confirm.
          </span>
        </div>
      </header>

      {failure && (
        <section className="quiz-panel quiz-failure" role="alert">
          <p>{failure.message}</p>
        </section>
      )}

      {resume && <ContinueCard summary={resume} />}

      <Classroom tutorials={library} hootLine={hootLine} motion={motion} />

      <ProjectProfilePanel compact />
    </div>
  );
}

function ContinueCard({ summary }: { summary: TutorialSummary }) {
  const openTutorial = useAcademy((s) => s.openTutorial);
  const p = summary.progress;
  return (
    <section className="quiz-panel quiz-continue" aria-label="Tutorial in progress">
      <div>
        <h2 className="quiz-panel-title">Continue where you left off</h2>
        <p className="quiz-muted">
          {summary.title} · chapter {(p?.chapter ?? 0) + 1} of {summary.chapters} ·{' '}
          {p?.stepsDone ?? 0} of {summary.stepsTotal} steps · {p?.xp ?? 0} XP
        </p>
      </div>
      <Button
        variant="primary"
        onClick={() => {
          openTutorial(summary.reference);
        }}
      >
        <Play aria-hidden /> Resume
      </Button>
    </section>
  );
}

/** The owls at their desks: a palette (`hub.css`) and a pose. */
const STUDENTS: { variant: 'a' | 'b' | 'c'; state: HootState; glasses: boolean }[] = [
  { variant: 'a', state: 'idle', glasses: false },
  { variant: 'b', state: 'thinking', glasses: true },
  { variant: 'c', state: 'idle', glasses: false },
];

/** The classroom: the blackboard with the tutorials, then Hoot the teacher and the students. */
function Classroom({
  tutorials,
  hootLine,
  motion,
}: {
  tutorials: TutorialSummary[];
  hootLine: string;
  motion: boolean;
}) {
  const boardTitle = useId();
  return (
    <section className="academy-classroom" aria-labelledby={boardTitle}>
      <Blackboard tutorials={tutorials} titleId={boardTitle} />
      <div className="academy-floor">
        <div className="academy-teacher">
          <Hoot
            state="explaining"
            size={92}
            hat
            line={hootLine}
            motion={motion}
            label="Hoot, the teacher"
          />
        </div>
        <div className="academy-desks" aria-hidden>
          {STUDENTS.map((s) => (
            <div
              key={s.variant}
              className="academy-seat"
              data-variant={s.variant}
              data-glasses={s.glasses ? undefined : 'off'}
            >
              <Hoot
                state={s.state}
                size={68}
                motion={motion}
                label=""
                className="academy-student"
              />
              <span className="academy-desk" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
