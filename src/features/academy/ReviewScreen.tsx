// What "Check with the AI" found, chapter by chapter: still correct, or outdated with the reason;
// each proposed step as a before/after diff with Accept and Reject (A / R on a focused proposal),
// Accept all / Reject all; the topics the tutorial misses (a private tutorial can get a chapter
// on one, through its own confirmation). Nothing changes until "Apply": a private tutorial is
// saved, a shared one goes through the write confirmation.

import { ArrowLeft, Check, CirclePlus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import { proposalKey, useAcademy } from '../../stores/academy';
import { useTutorialWrite } from '../../stores/tutorialWrite';
import type { ReviewState } from '../../stores/academy';
import { RenderedDiff } from '../diff/RenderedDiff';
import { InlineCode } from '../quiz/InlineCode';
import { stepMarkdown } from './stepMarkdown';

type Decision = 'accepted' | 'rejected';

export function ReviewScreen({ review }: { review: ReviewState }) {
  const applyReview = useAcademy((s) => s.applyReview);
  const closeReview = useAcademy((s) => s.closeReview);
  const prepareChapter = useAcademy((s) => s.prepareChapter);
  const { tutorial, result, reference } = review;
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const keys = useMemo(
    () => result.chapters.flatMap((c) => c.proposals.map((p) => proposalKey(c.index, p.step))),
    [result],
  );
  const decide = (key: string, d: Decision) => {
    setDecisions((m) => new Map(m).set(key, d));
  };
  const all = (d: Decision) => {
    setDecisions(new Map(keys.map((k) => [k, d])));
  };
  const accepted = keys.filter((k) => decisions.get(k) === 'accepted');
  const pending = keys.filter((k) => !decisions.has(k)).length;
  const outdated = result.chapters.filter((c) => c.verdict === 'outdated').length;

  return (
    <div className="academy-review">
      <div className="academy-tutorial-head">
        <Button variant="ghost" onClick={closeReview}>
          <ArrowLeft aria-hidden /> Back to the tutorial
        </Button>
        <p className="academy-eyebrow">Checked against the project as it is now</p>
        <h1 className="quiz-title">{tutorial.title}</h1>
        <p className="quiz-lead" role="status">
          {outdated === 0
            ? `Every chapter is still correct.`
            : `${String(outdated)} of ${String(result.chapters.length)} chapters are outdated: ${String(keys.length)} step${keys.length === 1 ? '' : 's'} to update.`}
        </p>
        {keys.length > 0 && (
          <div className="academy-head-actions">
            <Button
              onClick={() => {
                all('accepted');
              }}
            >
              <Check aria-hidden /> Accept all
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                all('rejected');
              }}
            >
              <X aria-hidden /> Reject all
            </Button>
          </div>
        )}
      </div>

      {result.chapters.map((c) => {
        const chapter = tutorial.chapters[c.index];
        if (!chapter) return null;
        return (
          <section
            key={c.id}
            className="quiz-panel academy-review-chapter"
            data-verdict={c.verdict}
            aria-label={`Chapter ${String(c.index + 1)}: ${chapter.title}`}
          >
            <h2 className="quiz-panel-title">
              {c.index + 1}. {chapter.title}{' '}
              <span
                className={`academy-tag ${c.verdict === 'correct' ? 'academy-tag-done' : 'academy-tag-warn'}`}
              >
                {c.verdict === 'correct' ? 'still correct' : 'outdated'}
              </span>
            </h2>
            <p className="quiz-muted">
              <InlineCode text={c.reason} />
            </p>
            {c.proposals.map((p) => {
              const key = proposalKey(c.index, p.step);
              const original = chapter.steps[p.step];
              if (!original) return null;
              const d = decisions.get(key);
              return (
                <article
                  key={key}
                  className="academy-proposal"
                  data-decision={d ?? 'pending'}
                  tabIndex={0}
                  aria-label={`Step ${String(p.step + 1)}: ${d ?? 'not decided'}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'a' || e.key === 'A') decide(key, 'accepted');
                    else if (e.key === 'r' || e.key === 'R') decide(key, 'rejected');
                  }}
                >
                  <p className="academy-proposal-why">
                    <strong>Step {p.step + 1}.</strong> <InlineCode text={p.reason} />{' '}
                    <span className="quiz-muted">
                      (<InlineCode text={p.change} />)
                    </span>
                  </p>
                  <RenderedDiff
                    oldText={stepMarkdown(original)}
                    newText={stepMarkdown(p.replacement)}
                  />
                  <div className="academy-head-actions">
                    <Button
                      variant={d === 'accepted' ? 'primary' : 'secondary'}
                      aria-pressed={d === 'accepted'}
                      onClick={() => {
                        decide(key, 'accepted');
                      }}
                    >
                      <Check aria-hidden /> Accept
                    </Button>
                    <Button
                      variant={d === 'rejected' ? 'primary' : 'ghost'}
                      aria-pressed={d === 'rejected'}
                      onClick={() => {
                        decide(key, 'rejected');
                      }}
                    >
                      <X aria-hidden /> Reject
                    </Button>
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}

      {result.missingTopics.length > 0 && (
        <section className="quiz-panel" aria-label="Missing topics">
          <h2 className="quiz-panel-title">Not covered yet</h2>
          <ul className="academy-missing-list">
            {result.missingTopics.map((m) => (
              <li key={m.title}>
                <strong>
                  <InlineCode text={m.title} />
                </strong>
                <span className="quiz-muted">
                  <InlineCode text={m.goal} />
                </span>
                {reference.type === 'private' && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void prepareChapter(reference.id, tutorial.chapters.length, m.goal)
                    }
                  >
                    <CirclePlus aria-hidden /> Write this chapter <AiMark />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="academy-actions">
        <Button
          variant="primary"
          disabled={keys.length > 0 && accepted.length === 0}
          onClick={() =>
            void applyReview(accepted).then((next) => {
              if (next && reference.type === 'shared')
                return useTutorialWrite.getState().prepare(reference, next.title, next);
            })
          }
          title={pending > 0 ? `${String(pending)} not decided: they stay as they are` : undefined}
        >
          {keys.length === 0
            ? 'Done'
            : reference.type === 'shared'
              ? `Write ${String(accepted.length)} accepted change${accepted.length === 1 ? '' : 's'}…`
              : `Save ${String(accepted.length)} accepted change${accepted.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
