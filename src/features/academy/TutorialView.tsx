// A tutorial in the Academy: its chapters, the ones still to write, and (next) the course map and
// the chapter player.

import { ArrowLeft, PenLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import { backend } from '../../ipc/client';
import type { Tutorial, TutorialRef } from '../../ipc/types';
import { errorMessage } from '../../stores/aiProvider';
import { onTutorialSaved, selectAcademyBusy, useAcademy } from '../../stores/academy';

export function TutorialView({ reference }: { reference: TutorialRef; motion: boolean }) {
  const [tutorial, setTutorial] = useState<Tutorial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backHome = useAcademy((s) => s.backHome);
  const prepareChapter = useAcademy((s) => s.prepareChapter);
  const busy = useAcademy(selectAcademyBusy);
  const key = reference.type === 'private' ? reference.id : reference.relPath;
  useEffect(() => {
    let live = true;
    backend.getTutorial(reference).then(
      (t) => {
        if (live) setTutorial(t);
      },
      (err: unknown) => {
        if (live) setError(errorMessage(err));
      },
    );
    const off = onTutorialSaved((t) => {
      if (reference.type === 'private' && t.id === reference.id) setTutorial(t);
    });
    return () => {
      live = false;
      off();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the reference is its key

  if (error) return <p role="alert">{error}</p>;
  if (!tutorial) return <p className="quiz-muted">Opening the tutorial…</p>;
  return (
    <div className="academy-tutorial">
      <Button variant="ghost" onClick={backHome}>
        <ArrowLeft aria-hidden /> Academy
      </Button>
      <h1 className="quiz-title">{tutorial.title}</h1>
      <p className="quiz-lead">{tutorial.intro}</p>
      <ol className="academy-outline-list">
        {tutorial.chapters.map((c, i) => (
          <li
            key={c.id}
            className="academy-outline-chapter"
            data-written={c.steps.length > 0 || undefined}
          >
            <div className="academy-outline-body">
              <span className="academy-outline-number">{i + 1}</span>
              <strong>{c.title}</strong>
              <p className="quiz-muted">
                {c.goal} ·{' '}
                {c.steps.length > 0 ? `${String(c.steps.length)} steps` : 'not written yet'}
              </p>
            </div>
            {c.steps.length === 0 && reference.type === 'private' && (
              <Button disabled={busy} onClick={() => void prepareChapter(tutorial.id, i)}>
                <PenLine aria-hidden /> Write it <AiMark />
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
