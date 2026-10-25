// The chapter's recap, its last step: Hoot and the chapter's title, how the chapter went (steps
// done, answers right, the chapter bonus to come), the takeaways as numbered cards, the steps
// still to do (the chapter is not done without them), and what comes next. Its keys are a read
// step's (Enter finishes the chapter).

import { ArrowRight, BookOpenCheck, Flag, Sparkles, Target } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import type { RecapStep } from '../../../ipc/types';
import { useTutorialPlayer } from '../../../stores/tutorialPlayer';
import { Hoot } from '../../hoot/Hoot';
import { MOMENT_STATE, pickLine } from '../../hoot/hootLines';
import { InlineCode } from '../../quiz/InlineCode';
import { CHAPTER_XP, chapterStates, chapterSummary } from '../academyEngine';
import { ReadFrame } from './ReadSteps';
import type { StepProps } from './types';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export function Recap({ step, props }: { step: RecapStep; props: StepProps }) {
  const tutorial = useTutorialPlayer((s) => s.tutorial);
  const progress = useTutorialPlayer((s) => s.progress);
  const index = useTutorialPlayer((s) => s.chapter);
  const at = useTutorialPlayer((s) => s.step);
  const goto = useTutorialPlayer((s) => s.goto);
  const [line] = useState(() => pickLine('recap'));
  const chapter = index === null ? undefined : tutorial?.chapters[index];
  if (!tutorial || !progress || index === null || !chapter) {
    return <ReadFrame props={props}>{null}</ReadFrame>;
  }
  const summary = chapterSummary(chapter, progress, at);
  const next = tutorial.chapters[index + 1];
  const nextState = next ? chapterStates(tutorial, progress)[index + 1] : undefined;
  const firstMissing = summary.missing[0];
  const bonus = !summary.chapterDone && firstMissing === undefined;

  return (
    <ReadFrame props={props} nextLabel={next ? 'Finish chapter' : 'Finish the tutorial'}>
      <div className="academy-recap">
        <div className="academy-recap-hero">
          <Hoot state={MOMENT_STATE.recap} size={64} motion={props.motion} label="Hoot" />
          <div className="academy-recap-heading">
            <h2 className="academy-step-title academy-recap-title">
              What to keep from chapter {index + 1}
            </h2>
            <p className="academy-recap-line">{line}</p>
            <ul className="academy-recap-stats" aria-label="This chapter">
              <li>
                <BookOpenCheck aria-hidden />
                <span>
                  <strong>
                    {summary.done}/{summary.steps}
                  </strong>{' '}
                  steps
                </span>
              </li>
              {summary.interactive > 0 && (
                <li>
                  <Target aria-hidden />
                  <span>
                    <strong>
                      {summary.right}/{summary.interactive}
                    </strong>{' '}
                    answered right
                    {summary.firstTry > 0 && ` · ${String(summary.firstTry)} at the first try`}
                  </span>
                </li>
              )}
              {(bonus || summary.chapterDone) && (
                <li data-tone="xp">
                  <Sparkles aria-hidden />
                  <span>
                    {summary.chapterDone ? (
                      'Chapter bonus earned'
                    ) : (
                      <>
                        <strong>+{CHAPTER_XP} XP</strong> when you finish
                      </>
                    )}
                  </span>
                </li>
              )}
            </ul>
          </div>
        </div>

        <ol className="academy-takeaways" aria-label="Key takeaways">
          {step.takeaways.map((t, i) => (
            <li key={t} style={{ animationDelay: `${String(i * 90)}ms` }}>
              <span className="academy-takeaway-number" aria-hidden>
                {i + 1}
              </span>
              <InlineCode text={t} />
            </li>
          ))}
        </ol>

        {firstMissing !== undefined && (
          <div className="academy-recap-missing" role="note">
            <p>
              {plural(summary.missing.length, 'step', 'steps')} left before this chapter counts as
              done{summary.chapterDone ? '' : ` and earns its +${String(CHAPTER_XP)} XP`}.
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                goto(firstMissing);
              }}
            >
              Go to step {firstMissing + 1} <ArrowRight aria-hidden />
            </Button>
          </div>
        )}

        {next ? (
          <p className="academy-recap-next">
            <span className="academy-recap-next-label">Up next</span>
            <span>
              Chapter {index + 2}: <InlineCode text={next.title} />
              {nextState === 'unwritten' && (
                <span className="academy-recap-next-note"> · to be written</span>
              )}
            </span>
          </p>
        ) : (
          <p className="academy-recap-next">
            <Flag aria-hidden />
            <span>Last chapter: finishing it completes the tutorial.</span>
          </p>
        )}
      </div>
    </ReadFrame>
  );
}
