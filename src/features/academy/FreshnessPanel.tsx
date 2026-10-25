// The freshness of the open tutorial (the local check run when it opened, no token): the badge,
// and when something changed, the cited ranges that changed or went missing with the steps they
// affect. Moved citations of a private tutorial were relocated and saved; for a shared one, the
// relocation is offered as a write the user confirms.

import { BadgeCheck, CircleCheck, MoveVertical, SearchCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { FreshnessReport, Tutorial, TutorialRef } from '../../ipc/types';
import { stepTitle } from '../../lib/tutorial';
import { openSourceFile } from '../../stores/tabs';
import { selectAcademyBusy, useAcademy } from '../../stores/academy';
import { useTutorialPlayer } from '../../stores/tutorialPlayer';
import { useTutorialWrite } from '../../stores/tutorialWrite';
import { backend } from '../../ipc/client';
import { useToasts } from '../../stores/toasts';
import { errorMessage } from '../../stores/aiProvider';
import { Hoot } from '../hoot/Hoot';
import { pickLine } from '../hoot/hootLines';
import { badgeLabel } from './freshnessView';

const STATE_LABEL = { changed: 'changed', missing: 'missing', moved: 'moved' } as const;

export function FreshnessPanel({
  reference,
  tutorial,
  report,
}: {
  reference: TutorialRef;
  tutorial: Tutorial;
  report: FreshnessReport;
}) {
  const prepareWrite = useTutorialWrite((s) => s.prepare);
  const prepareReview = useAcademy((s) => s.prepareReview);
  const busy = useAcademy(selectAcademyBusy);
  const [confirming, setConfirming] = useState(false);
  const written = tutorial.chapters.some((c) => c.steps.length > 0);
  const verify = async () => {
    setConfirming(false);
    try {
      const stamped = await backend.markTutorialVerified(reference);
      if (reference.type === 'shared')
        await prepareWrite({ type: 'shared', relPath: reference.relPath }, tutorial.title, stamped);
      else await useTutorialPlayer.getState().load(reference);
    } catch (err) {
      useToasts.getState().notify('error', `Cannot mark it as verified: ${errorMessage(err)}`);
    }
  };
  const fine = report.badge.badge === 'upToDate';
  const problems = report.checks.filter(
    (c) => c.state === 'changed' || c.state === 'missing' || c.state === 'moved',
  );
  const relocated = report.relocated;
  const [hootLine] = useState(() =>
    !fine ? pickLine('outdated') : tutorial.verified ? pickLine('verified') : null,
  );
  return (
    <section
      className="academy-freshness"
      data-badge={report.badge.badge}
      aria-label="Freshness of this tutorial"
    >
      <p className="academy-freshness-badge">
        {fine ? <CircleCheck aria-hidden /> : <TriangleAlert aria-hidden />}
        <strong>{badgeLabel(report.badge)}</strong>
        <span className="quiz-muted"> · checked against the files now, without the AI</span>
      </p>
      {hootLine && (
        <Hoot state={fine ? 'cheering' : 'encouraging'} size={40} line={hootLine} motion={false} />
      )}
      {report.relocatedSaved > 0 && (
        <p className="quiz-muted" role="status">
          <MoveVertical aria-hidden className="academy-inline-icon" /> {report.relocatedSaved}{' '}
          citation{report.relocatedSaved === 1 ? '' : 's'} followed{' '}
          {report.relocatedSaved === 1 ? 'its' : 'their'} lines to where they moved.
        </p>
      )}
      {problems.length > 0 && (
        <details className="academy-freshness-details" open={!fine}>
          <summary>
            {problems.length} cited range{problems.length === 1 ? '' : 's'} to look at
          </summary>
          <ul className="academy-freshness-list">
            {problems.map((c, i) => (
              <li key={`${c.path}-${c.lines ?? ''}-${String(i)}`}>
                <button
                  type="button"
                  className="quiz-block-source"
                  disabled={c.state === 'missing'}
                  onClick={() => {
                    const [a, b] = (c.lines ?? '').split('-').map(Number);
                    openSourceFile(c.path, a || undefined, b || a || undefined);
                  }}
                >
                  {c.lines ? `${c.path}:${c.lines}` : c.path}
                </button>{' '}
                <span className="academy-tag" data-state={c.state}>
                  {c.state === 'moved'
                    ? `moved to ${String(c.firstLine)}-${String(c.lastLine)}`
                    : STATE_LABEL[c.state]}
                </span>
              </li>
            ))}
          </ul>
          {report.affected.length > 0 && (
            <>
              <p className="quiz-muted">Steps that cite them:</p>
              <ul className="academy-freshness-list">
                {report.affected.map((s) => {
                  const chapter = tutorial.chapters[s.chapter];
                  const step = chapter?.steps[s.step];
                  if (!chapter || !step) return null;
                  return (
                    <li key={`${String(s.chapter)}:${String(s.step)}`}>
                      Chapter {s.chapter + 1}, step {s.step + 1}: {stepTitle(step)}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </details>
      )}
      {tutorial.verified && (
        <p className="quiz-muted">
          <BadgeCheck aria-hidden className="academy-inline-icon" /> Verified{' '}
          {tutorial.verified.date.slice(0, 10)}
          {tutorial.verified.by ? ` by ${tutorial.verified.by}` : ''}
          {tutorial.verified.commit ? ` at ${tutorial.verified.commit.slice(0, 8)}` : ''}
        </p>
      )}
      {written && (
        <div className="academy-head-actions">
          <Button
            onClick={() => void prepareReview(reference)}
            disabled={busy}
            title="The AI rereads the tutorial against the project and proposes updates (you confirm first)"
          >
            <SearchCheck aria-hidden /> Check with the AI <AiMark />
          </Button>
          {confirming ? (
            <span className="academy-row-confirm" role="group" aria-label="Mark as verified?">
              <span className="quiz-muted">
                You confirm this tutorial is correct for the project as it is now. IGrasp records
                the date, the commit and your name.
              </span>
              <Button variant="primary" onClick={() => void verify()}>
                Mark as verified
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(true);
              }}
            >
              <BadgeCheck aria-hidden /> Mark as verified…
            </Button>
          )}
        </div>
      )}
      {relocated && reference.type === 'shared' && (
        <div className="academy-head-actions">
          <Button
            onClick={() =>
              void prepareWrite(
                { type: 'shared', relPath: reference.relPath },
                tutorial.title,
                relocated,
              )
            }
            title="Write the moved line numbers into the shared tutorial's files"
          >
            <MoveVertical aria-hidden /> Update the moved citations
          </Button>
        </div>
      )}
    </section>
  );
}
