// The Academy's hub: a classroom. Hoot teaches in front of the blackboard, where the tutorials of
// this folder are listed (scrolled when there are many), and a few owls listen at their desks.
// "New tutorial" opens the wizard (subject, options, confirmation); "Continue" resumes the last
// tutorial. Opening it spends nothing.

import { BookOpen, Download, ListChecks, Play, Plus, Share2, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import type { TutorialSummary } from '../../ipc/types';
import { selectAcademyBusy, useAcademy } from '../../stores/academy';
import { useTutorialWrite } from '../../stores/tutorialWrite';
import { Hoot } from '../hoot/Hoot';
import type { HootState } from '../hoot/Hoot';
import { ProjectProfilePanel } from '../profile/ProjectProfilePanel';
import { formatWhen } from '../quiz/quizFormat';
import { badgeShort } from './freshnessView';
import { FAMILIARITY_LABEL, LENGTH_LABEL } from './labels';

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
            Subject, options, then a confirmation: nothing is spent before you confirm.
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

/** The classroom: Hoot the teacher, the blackboard with the tutorials, the students. */
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
      <div className="academy-classroom-front">
        <div className="academy-teacher">
          <Hoot
            state="explaining"
            size={112}
            hat
            line={hootLine}
            motion={motion}
            label="Hoot, the teacher"
          />
        </div>
        <Blackboard tutorials={tutorials} titleId={boardTitle} />
      </div>
      <div className="academy-desks" aria-hidden>
        {STUDENTS.map((s) => (
          <div
            key={s.variant}
            className="academy-seat"
            data-variant={s.variant}
            data-glasses={s.glasses ? undefined : 'off'}
          >
            <Hoot state={s.state} size={68} motion={motion} label="" className="academy-student" />
            <span className="academy-desk" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Blackboard({ tutorials, titleId }: { tutorials: TutorialSummary[]; titleId: string }) {
  return (
    <div className="academy-board">
      <div className="academy-board-head">
        <h2 className="academy-board-title" id={titleId}>
          Your tutorials
        </h2>
        {tutorials.length > 0 && <span className="academy-board-count">{tutorials.length}</span>}
      </div>
      {tutorials.length === 0 ? (
        <div className="academy-board-empty">
          <p>No tutorial on the board yet.</p>
          <p>
            Press <strong>New tutorial</strong> to write the first one. Tutorials stay private (in
            the app&apos;s data, never in the project) until you share one.
          </p>
        </div>
      ) : (
        <Library tutorials={tutorials} />
      )}
      <div className="academy-board-ledge" aria-hidden>
        <span className="academy-chalk-piece" />
        <span className="academy-chalk-piece" data-tone="accent" />
      </div>
    </div>
  );
}

function Library({ tutorials }: { tutorials: TutorialSummary[] }) {
  const openTutorial = useAcademy((s) => s.openTutorial);
  const reviewOutline = useAcademy((s) => s.reviewOutline);
  const deleteTutorial = useAcademy((s) => s.deleteTutorial);
  const prepareWrite = useTutorialWrite((s) => s.prepare);
  const busy = useAcademy(selectAcademyBusy);
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <ul className="academy-library-list academy-board-list" aria-label="Tutorials">
      {tutorials.map((t) => {
        const written = t.chaptersWritten;
        const p = t.progress;
        const key = t.reference.type === 'private' ? t.reference.id : t.reference.relPath;
        return (
          <li key={key} className="academy-row">
            <button
              type="button"
              className="academy-row-main"
              onClick={() => {
                if (written === 0 && t.reference.type === 'private')
                  void reviewOutline(t.reference.id);
                else openTutorial(t.reference);
              }}
              disabled={busy && written === 0}
            >
              <BookOpen aria-hidden className="academy-row-icon" />
              <span className="academy-row-title">
                {t.title}
                {p?.graduated && <span className="academy-tag academy-tag-done">graduated</span>}
                <span className="academy-tag">
                  {t.reference.type === 'shared' ? `shared · ${t.reference.relPath}` : 'private'}
                </span>
                {t.sharedAs && <span className="academy-tag">shared as {t.sharedAs}</span>}
                {t.freshness && t.freshness.badge !== 'upToDate' && (
                  <span className="academy-tag academy-tag-warn">{badgeShort(t.freshness)}</span>
                )}
                {p && p.updated > 0 && (
                  <span className="academy-tag academy-tag-warn">
                    {p.updated} updated since you read {p.updated === 1 ? 'it' : 'them'}
                  </span>
                )}
                {t.verified && (
                  <span className="academy-tag academy-tag-done">
                    verified {t.verified.date.slice(0, 10)}
                  </span>
                )}
              </span>
              <span className="academy-row-meta">
                {FAMILIARITY_LABEL[t.familiarity]} · {LENGTH_LABEL[t.length].name} ·{' '}
                {written === t.chapters
                  ? `${String(t.chapters)} chapters`
                  : written === 0
                    ? `outline only (${String(t.chapters)} chapters)`
                    : `${String(written)} of ${String(t.chapters)} chapters written`}
                {p
                  ? ` · ${String(p.stepsDone)} of ${String(t.stepsTotal)} steps · ${String(p.xp)} XP`
                  : ''}
                {` · ${formatWhen(t.updatedMs)}`}
              </span>
            </button>
            {written === 0 && t.reference.type === 'private' && (
              <Button
                variant="ghost"
                onClick={() => void reviewOutline(key)}
                title="Review the outline"
              >
                <ListChecks aria-hidden /> Outline
              </Button>
            )}
            {t.reference.type === 'private' && written > 0 && (
              <>
                <Button
                  variant="ghost"
                  aria-label={`${t.sharedAs ? 'Update the shared copy of' : 'Share'} ${t.title}`}
                  title={
                    t.sharedAs
                      ? `Write this version again in ${t.sharedAs}`
                      : 'Share with the project: write it as markdown files in the folder'
                  }
                  onClick={() => void prepareWrite({ type: 'share', id: key }, t.title)}
                >
                  <Share2 aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Save ${t.title} as…`}
                  title="Save a copy as markdown files in a folder you choose"
                  onClick={() => void prepareWrite({ type: 'export', id: key }, t.title)}
                >
                  <Download aria-hidden />
                </Button>
              </>
            )}
            {t.reference.type === 'private' &&
              (confirming === key ? (
                <span
                  className="academy-row-confirm"
                  role="group"
                  aria-label="Delete this tutorial?"
                >
                  <Button
                    variant="primary"
                    onClick={() => {
                      setConfirming(null);
                      void deleteTutorial(key);
                    }}
                  >
                    Delete
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setConfirming(null);
                    }}
                  >
                    Keep
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  aria-label={`Delete ${t.title}`}
                  title="Delete this private tutorial and your progress in it"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(key);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              ))}
          </li>
        );
      })}
    </ul>
  );
}
