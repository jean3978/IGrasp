// The graduation: every chapter done. A badge (Hoot with a mortarboard), the XP, the time, the
// right answers at the first try, the documentation note, and what comes next: a quiz on the
// tutorial (the quiz's own confirmation card), sharing it with the project, or the Academy.

import { GraduationCap, Home, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { Tutorial, TutorialProgress } from '../../ipc/types';
import { formatElapsed } from '../quiz/quizFormat';
import { Hoot } from '../hoot/Hoot';
import { pickLine } from '../hoot/hootLines';
import { playEffect } from '../quiz/effects/effects';

export function GraduationScreen({
  tutorial,
  progress,
  motion,
  onQuiz,
  onShare,
  onBack,
}: {
  tutorial: Tutorial;
  progress: TutorialProgress;
  motion: boolean;
  onQuiz: () => void;
  /** Absent when the tutorial cannot be shared from here (already shared). */
  onShare?: (() => void) | undefined;
  onBack: () => void;
}) {
  const [line] = useState(() => pickLine('graduation'));
  const [shownAt] = useState(() => Date.now());
  const badgeRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
    playEffect('confetti', badgeRef.current);
  }, []);
  const answers = Object.values(progress.answers);
  const firstTry = answers.filter((a) => a.firstTry).length;
  const time = (progress.finishedMs ?? shownAt) - progress.startedMs;
  return (
    <section className="academy-graduation" aria-labelledby="academy-graduation-title">
      <div className="academy-badge" ref={badgeRef}>
        <GraduationCap aria-hidden className="academy-badge-cap" />
        <Hoot state="cheering" size={150} line={line} motion={motion} announce />
      </div>
      <h1 className="quiz-title" id="academy-graduation-title" tabIndex={-1} ref={headingRef}>
        You graduated: {tutorial.title}
      </h1>
      <ul className="academy-graduation-stats">
        <li>
          <strong>{progress.xp}</strong> XP
        </li>
        <li>
          <strong>{tutorial.chapters.length}</strong> chapters
        </li>
        <li>
          <strong>
            {firstTry} of {answers.length}
          </strong>{' '}
          right at the first try
        </li>
        <li>
          <strong>{formatElapsed(time)}</strong>
        </li>
      </ul>
      {tutorial.docsNote && <p className="quiz-note quiz-docs-note">{tutorial.docsNote}</p>}
      <div className="academy-actions">
        <Button variant="primary" onClick={onQuiz}>
          Quiz me on this tutorial <AiMark />
        </Button>
        {onShare && (
          <Button onClick={onShare}>
            <Share2 aria-hidden /> Share with the project
          </Button>
        )}
        <Button variant="ghost" onClick={onBack}>
          <Home aria-hidden /> Back to the Academy
        </Button>
      </div>
    </section>
  );
}
