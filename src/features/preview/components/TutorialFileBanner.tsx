// The top of a shared tutorial's file in the preview: what it is and "Take it in the Academy",
// which opens the Academy on it (reading it there spends no token). Shown instead of the front
// matter card (its outline and hashes are noise to a reader).

import { GraduationCap } from 'lucide-react';
import { HootIcon } from '../../hoot/HootIcon';
import { Button } from '../../../components/ui/Button';
import { useAcademy } from '../../../stores/academy';
import { useTabs } from '../../../stores/tabs';

export interface TutorialFileFacts {
  title: string | null;
  /** The chapter's number and title for a chapter file, null for the README. */
  chapter: string | null;
  chapters: number;
  verified: string | null;
}

/** The README of the tutorial a file belongs to (`docs/tutorials/x/02-y.md` → `…/x/README.md`). */
const tutorialReadme = (relPath: string) => {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? 'README.md' : `${relPath.slice(0, i)}/README.md`;
};

export function TutorialFileBanner({
  relPath,
  facts,
}: {
  relPath: string;
  facts: TutorialFileFacts;
}) {
  return (
    <section className="quiz-file-banner" aria-label="Tutorial file">
      <HootIcon className="quiz-file-banner-icon" />
      <div className="quiz-file-banner-text">
        <strong>{facts.chapter ?? facts.title ?? 'A tutorial'}</strong>
        <span>
          {facts.chapter
            ? 'A chapter of a tutorial written for this project.'
            : `A tutorial written for this project, ${String(facts.chapters)} chapter${facts.chapters === 1 ? '' : 's'}.`}{' '}
          {facts.verified ? `Verified ${facts.verified.slice(0, 10)}. ` : ''}
          Take it in the Academy, step by step.
        </span>
      </div>
      {relPath !== '' && (
        <Button
          variant="primary"
          onClick={() => {
            useAcademy
              .getState()
              .openTutorial({ type: 'shared', relPath: tutorialReadme(relPath) });
            useTabs.getState().openSpecial('academy');
          }}
        >
          <GraduationCap aria-hidden /> Take it in the Academy
        </Button>
      )}
    </section>
  );
}
