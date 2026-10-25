// A chapter of a tutorial, one step at a time: the header (title, progress bar, XP, streak),
// Hoot's introduction, the step card (focused on every transition, so the keyboard reaches it),
// and the "updated since you read it" and source notices. Escape or M goes back to the map.

import { Flame, Map as MapIcon, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import type { Step, Tutorial, TutorialProgress } from '../../ipc/types';
import { stepTitle, stepKey, stepCitations } from '../../lib/tutorial';
import { useTutorialPlayer } from '../../stores/tutorialPlayer';
import { Hoot } from '../hoot/Hoot';
import { InlineCode } from '../quiz/InlineCode';
import { stepsDone } from './academyEngine';
import { CodeTour, SpotIt } from './steps/CodeSteps';
import { ConceptBridge, Diagram, Explain, Recap } from './steps/ReadSteps';
import { Match, PutInOrder } from './steps/OrderSteps';
import { QuickCheck, TryIt } from './steps/ActionSteps';
import { citationLabel } from './steps/stepUtils';
import { StepQuestions } from './StepQuestions';
import type { SourceStatus } from './steps/stepUtils';
import type { StepProps } from './steps/types';

const TYPE_LABEL: Record<Step['type'], string> = {
  explain: 'Explain',
  conceptBridge: 'Concept bridge',
  codeTour: 'Code tour',
  diagram: 'Diagram',
  putInOrder: 'Put in order',
  match: 'Match',
  spotIt: 'Spot it',
  quickCheck: 'Quick check',
  tryIt: 'Try it yourself',
  recap: 'Recap',
};

function StepBody({ step, props }: { step: Step; props: StepProps }) {
  switch (step.type) {
    case 'explain':
      return <Explain step={step} props={props} />;
    case 'conceptBridge':
      return <ConceptBridge step={step} props={props} />;
    case 'codeTour':
      return <CodeTour step={step} props={props} />;
    case 'diagram':
      return <Diagram step={step} props={props} />;
    case 'putInOrder':
      return <PutInOrder step={step} props={props} />;
    case 'match':
      return <Match step={step} props={props} />;
    case 'spotIt':
      return <SpotIt step={step} props={props} />;
    case 'quickCheck':
      return <QuickCheck step={step} props={props} />;
    case 'tryIt':
      return <TryIt step={step} props={props} />;
    case 'recap':
      return <Recap step={step} props={props} />;
  }
}

export function ChapterPlayer({
  tutorial,
  progress,
  chapterIndex,
  stepIndex,
  updated,
  sourceStatus,
  motion,
}: {
  tutorial: Tutorial;
  progress: TutorialProgress;
  chapterIndex: number;
  stepIndex: number;
  updated: Set<string>;
  sourceStatus: Record<string, SourceStatus>;
  motion: boolean;
}) {
  const complete = useTutorialPlayer((s) => s.complete);
  const next = useTutorialPlayer((s) => s.next);
  const previous = useTutorialPlayer((s) => s.previous);
  const goto = useTutorialPlayer((s) => s.goto);
  const showMap = useTutorialPlayer((s) => s.showMap);
  const reference = useTutorialPlayer((s) => s.reference);
  const cardRef = useRef<HTMLElement>(null);
  const chapter = tutorial.chapters[chapterIndex];
  const step = chapter?.steps[stepIndex];
  const key = chapter ? stepKey(chapter.id, stepIndex) : '';

  // A new step: the focus goes to its card (the keys of the step type work at once).
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    // The step's first control when it has one, else its body (where its keys are handled).
    const body = card.querySelector<HTMLElement>('.academy-step-body');
    if (body) body.tabIndex = -1;
    const target =
      card.querySelector<HTMLElement>(
        '.quiz-choice, .academy-order-item[tabindex="0"], .academy-match-item',
      ) ??
      body ??
      card;
    target.focus({ preventScroll: false });
  }, [key]);

  if (!chapter || !step) return null;
  const done = stepsDone(chapter, progress);
  const total = chapter.steps.length;
  const sources = stepCitations(step);
  const status: Record<string, SourceStatus> = {};
  for (const s of sources) {
    const st = sourceStatus[citationLabel(s)];
    if (st) status[citationLabel(s)] = st;
  }
  const props: StepProps = {
    stepKey: key,
    done: key in progress.completed,
    answer: progress.answers[key],
    sources,
    sourceStatus: status,
    first: stepIndex === 0,
    motion,
    onComplete: complete,
    onNext: next,
    onPrevious: previous,
    onEscape: showMap,
  };
  return (
    <div className="academy-player">
      <header className="academy-player-head">
        <Button variant="ghost" onClick={showMap} title="Course map (Escape)">
          <MapIcon aria-hidden /> Map
        </Button>
        <div className="academy-player-title">
          <p className="academy-eyebrow">
            Chapter {chapterIndex + 1} of {tutorial.chapters.length}
          </p>
          <h1 className="quiz-title">{chapter.title}</h1>
        </div>
        <div className="academy-player-score" aria-label="Your score">
          <span className="academy-xp" title="Experience points">
            <Sparkles aria-hidden /> {progress.xp} XP
          </span>
          {progress.streak >= 2 && (
            <span className="academy-streak" title="Right answers in a row">
              <Flame aria-hidden /> {progress.streak}
            </span>
          )}
        </div>
      </header>
      <div
        className="academy-progress"
        role="progressbar"
        aria-label="Steps done in this chapter"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <span style={{ width: `${String((done / Math.max(1, total)) * 100)}%` }} />
      </div>
      <ol className="academy-step-dots" aria-label="Steps">
        {chapter.steps.map((s, i) => {
          const k = stepKey(chapter.id, i);
          return (
            <li key={k}>
              <button
                type="button"
                className="academy-step-dot"
                data-done={k in progress.completed ? 'true' : undefined}
                data-updated={updated.has(k) ? 'true' : undefined}
                aria-current={i === stepIndex ? 'step' : undefined}
                aria-label={`Step ${String(i + 1)}: ${TYPE_LABEL[s.type]}${k in progress.completed ? ', done' : ''}${updated.has(k) ? ', updated since you read it' : ''}`}
                onClick={() => {
                  goto(i);
                }}
              />
            </li>
          );
        })}
      </ol>
      {stepIndex === 0 && chapter.hootIntro && (
        <div className="academy-intro">
          <Hoot state="explaining" size={88} line={chapter.hootIntro} motion={motion} />
        </div>
      )}
      <article
        ref={cardRef}
        key={key}
        className="quiz-panel academy-step"
        data-type={step.type}
        data-chapter={chapterIndex}
        data-step={stepIndex}
        tabIndex={-1}
        aria-label={`${TYPE_LABEL[step.type]}: ${stepTitle(step)}`}
        onKeyDown={(e) => {
          if (e.key === 'm' && (e.target as HTMLElement) === e.currentTarget) showMap();
        }}
      >
        <p className="academy-step-type">
          {TYPE_LABEL[step.type]}
          {updated.has(key) && (
            <span className="academy-tag academy-tag-warn">updated since you read it</span>
          )}
        </p>
        {step.type !== 'quickCheck' && (
          <h2 className="academy-step-title">
            <InlineCode text={stepTitle(step)} />
          </h2>
        )}
        <StepBody step={step} props={props} />
        {reference && (
          <StepQuestions
            reference={reference}
            chapter={chapterIndex}
            step={stepIndex}
            questions={chapter.questions}
          />
        )}
      </article>
    </div>
  );
}
