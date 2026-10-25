// The Academy tab: one screen at a time (the hub, the new-tutorial wizard: subject, options,
// confirmation; generation, outline review, a tutorial), with Hoot's welcome when the tab opens.
// Opening it is free: the profile, the cards and the library are local; the provider's status
// check runs its probes, never a model.

import { useEffect, useState } from 'react';
import { useAcademy } from '../../stores/academy';
import { useAiProvider } from '../../stores/aiProvider';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';
import { pickLine } from '../hoot/hootLines';
import { EffectsCanvas } from '../quiz/effects/EffectsCanvas';
import { prefersReducedMotion } from '../quiz/effects/effects';
import { AcademyConfirm } from './AcademyConfirm';
import { AcademyCreate } from './AcademyCreate';
import { AcademyGeneration } from './AcademyGeneration';
import { AcademyHome } from './AcademyHome';
import { AcademyWelcome } from './AcademyWelcome';
import { OutlineReview } from './OutlineReview';
import { ReviewScreen } from './ReviewScreen';
import { TutorialOptions } from './TutorialOptions';
import { TutorialView } from './TutorialView';
import { WriteConfirmDialog } from './WriteConfirmDialog';
import '../quiz/quiz.css';
import './academy.css';
import './reader.css';
import './hub.css';

export function AcademyTab() {
  const root = useWorkspace((s) => s.root?.path ?? null);
  const screen = useAcademy((s) => s.screen);
  const open = useAcademy((s) => s.open);
  const review = useAcademy((s) => s.review);
  const openHome = useAcademy((s) => s.openHome);
  const checkStatus = useAiProvider((s) => s.checkStatus);
  const motion = useSettings((s) => s.settings.learning.effects);
  const [homeLine] = useState(() => pickLine('academyHome'));
  const [reducedMotion] = useState(prefersReducedMotion);

  useEffect(() => {
    if (root) void openHome(root);
  }, [root, openHome]);
  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  return (
    <>
      <div
        className="document-scroll quiz-tab academy-tab"
        aria-label="Academy"
        data-motion={motion && !reducedMotion ? undefined : 'off'}
      >
        <div className="quiz-page academy-page" data-screen={screen}>
          {screen === 'home' && (
            <AcademyHome hootLine={homeLine} motion={motion && !reducedMotion} />
          )}
          {screen === 'create' && <AcademyCreate />}
          {screen === 'options' && <TutorialOptions />}
          {screen === 'confirm' && <AcademyConfirm />}
          {screen === 'generating' && <AcademyGeneration motion={motion} />}
          {screen === 'outline' && <OutlineReview />}
          {screen === 'tutorial' && open && <TutorialView reference={open} motion={motion} />}
          {screen === 'review' && review && <ReviewScreen review={review} />}
        </div>
        <AcademyWelcome motion={motion && !reducedMotion} />
      </div>
      <WriteConfirmDialog />
      {motion && !reducedMotion && <EffectsCanvas />}
    </>
  );
}
