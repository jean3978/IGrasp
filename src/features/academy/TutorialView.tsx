// A tutorial in the Academy: the header (title, XP), then the course map, a chapter, or the
// graduation. Opening it and reading it are local; the effects follow the reader's progress
// (confetti on a completed chapter, a ring on a streak) and every gain is announced.

import { ArrowLeft, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import type { TutorialRef } from '../../ipc/types';
import { useAcademy } from '../../stores/academy';
import { useQuiz } from '../../stores/quiz';
import { useTabs } from '../../stores/tabs';
import { useTutorialPlayer } from '../../stores/tutorialPlayer';
import { playEffect } from '../quiz/effects/effects';
import { ChapterPlayer } from './ChapterPlayer';
import { CourseMap } from './CourseMap';
import { GraduationScreen } from './GraduationScreen';
import { FAMILIARITY_LABEL, LENGTH_LABEL } from './labels';

const keyOf = (r: TutorialRef) => (r.type === 'private' ? r.id : r.relPath);

export function TutorialView({ reference, motion }: { reference: TutorialRef; motion: boolean }) {
  const load = useTutorialPlayer((s) => s.load);
  const tutorial = useTutorialPlayer((s) => s.tutorial);
  const progress = useTutorialPlayer((s) => s.progress);
  const error = useTutorialPlayer((s) => s.error);
  const chapter = useTutorialPlayer((s) => s.chapter);
  const step = useTutorialPlayer((s) => s.step);
  const updated = useTutorialPlayer((s) => s.updated);
  const event = useTutorialPlayer((s) => s.event);
  const graduation = useTutorialPlayer((s) => s.graduation);
  const openChapter = useTutorialPlayer((s) => s.openChapter);
  const closeGraduation = useTutorialPlayer((s) => s.closeGraduation);
  const backHome = useAcademy((s) => s.backHome);
  const failure = useAcademy((s) => s.failure);
  const writing = useAcademy((s) => s.generation?.kind === 'chapters');
  const headRef = useRef<HTMLDivElement>(null);
  const key = keyOf(reference);

  useEffect(() => {
    void load(reference);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the reference is its key

  // The effects follow the reader's progress; the announcement says what was gained.
  useEffect(() => {
    if (event?.kind === 'chapterDone' || event?.kind === 'graduated')
      playEffect('confetti', headRef.current);
    else if (event?.kind === 'streak')
      playEffect('ring', headRef.current?.querySelector('.academy-xp'));
  }, [event?.seq]); // eslint-disable-line react-hooks/exhaustive-deps -- one effect per event
  const announcement = !event
    ? ''
    : event.kind === 'chapterDone'
      ? `Chapter done. +${String(event.xp)} XP.`
      : event.kind === 'streak'
        ? `A streak! +${String(event.xp)} XP.`
        : event.kind === 'graduated'
          ? 'You graduated.'
          : `+${String(event.xp)} XP.`;

  if (error) return <p role="alert">Cannot open this tutorial: {error}</p>;
  if (
    !tutorial ||
    !progress ||
    keyOf(reference) !== (reference.type === 'private' ? tutorial.id : key)
  )
    return <p className="quiz-muted">Opening the tutorial…</p>;

  const quizMe = () => {
    void useQuiz.getState().prepareForTutorial(reference, tutorial.title);
    useTabs.getState().openSpecial('quiz');
  };

  return (
    <div className="academy-tutorial">
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {graduation ? (
        <GraduationScreen
          tutorial={tutorial}
          progress={progress}
          motion={motion}
          onQuiz={quizMe}
          onBack={() => {
            closeGraduation();
            backHome();
          }}
        />
      ) : chapter !== null ? (
        <ChapterPlayer
          tutorial={tutorial}
          progress={progress}
          chapterIndex={chapter}
          stepIndex={step}
          updated={updated}
          sourceStatus={{}}
          motion={motion}
        />
      ) : (
        <>
          <div className="academy-tutorial-head" ref={headRef}>
            <Button variant="ghost" onClick={backHome}>
              <ArrowLeft aria-hidden /> Academy
            </Button>
            <p className="academy-eyebrow">
              {reference.type === 'private' ? 'Private tutorial' : `Shared · ${reference.relPath}`}
            </p>
            <h1 className="quiz-title">{tutorial.title}</h1>
            <p className="quiz-lead">{tutorial.intro}</p>
            <p className="quiz-muted">
              {FAMILIARITY_LABEL[tutorial.familiarity]} · {LENGTH_LABEL[tutorial.length].name}
              {tutorial.domainGap ? ` · I'm new to ${tutorial.domainGap}` : ''} ·{' '}
              <span className="academy-xp">
                <Sparkles aria-hidden /> {progress.xp} XP
              </span>
              {progress.graduated && (
                <span className="academy-tag academy-tag-done">graduated</span>
              )}
            </p>
            {writing && <p className="quiz-note">Hoot is writing the next chapters…</p>}
            {failure && (
              <p className="quiz-note" role="alert">
                {failure.message}
              </p>
            )}
            {tutorial.docsNote && <p className="quiz-note quiz-docs-note">{tutorial.docsNote}</p>}
          </div>
          <CourseMap
            tutorial={tutorial}
            progress={progress}
            updated={updated}
            affected={new Map()}
            editable={reference.type === 'private'}
            onOpen={openChapter}
          />
          {progress.graduated && (
            <div className="academy-actions">
              <Button onClick={quizMe}>Quiz me on this tutorial</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
