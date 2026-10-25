// "Check with Claude" in the mock, like `learning/tutorial/review.rs`: the composed review of a
// tutorial, the scripted answers of the mock model, and the validator (a replacement is a valid
// step of the same type, every written chapter is reviewed; a retry lists the problems; when the
// attempts run out the best review is kept, or the run fails).

import type { Step, Tutorial, TutorialReview } from '../types';
import { stepTitle } from '../../lib/tutorial';
import { base, inlinedOf } from './mockTutorial';
import type { Base, MockTutorialDeps, MockTutorialScript, MockVerdict } from './mockTutorial';
import { affectedSteps, checkFreshness } from './mockTutorialFreshness';
import { MOCK_MAX_RETRIES } from './mockQuiz';
import { checkStep, parseStep } from './mockTutorialValidate';

export const MAX_MISSING_TOPICS = 3;

export interface MockReviewComposed extends Base {
  tutorial: Tutorial;
  prompt: string;
  inlined: ReturnType<typeof inlinedOf>;
  /** Steps citing a changed or missing range now (what the mock model "notices"). */
  affected: { chapter: number; step: number }[];
}

export function composeMockReview(deps: MockTutorialDeps, t: Tutorial): MockReviewComposed {
  const b = base(deps, {
    subject: t.subject,
    subjectId: null,
    picks: [],
    familiarity: t.familiarity,
    domainGap: t.domainGap ?? null,
    length: t.length,
    role: t.role ?? null,
  });
  const f = checkFreshness(t, (p) => deps.files.get(p));
  return {
    ...b,
    tutorial: t,
    prompt: `You are Hoot, the teacher of IGrasp's Academy. Check this tutorial about ${deps.profile.name} against the project as it is now.\n${t.title}`,
    inlined: inlinedOf(deps, []),
    affected: affectedSteps(t, f),
  };
}

interface RawProposal {
  step: number;
  reason: string;
  change: string;
  replacement: unknown;
}
interface RawChapter {
  id: string;
  verdict: 'correct' | 'outdated';
  reason: string;
  proposals: RawProposal[];
}
interface RawReview {
  chapters: RawChapter[];
  missingTopics: { title: string; goal: string; reason: string }[];
}

/** The step rewritten by the mock model: one of its texts says it was checked again. */
function rewritten(step: Step): Step {
  const s = structuredClone(step);
  const note = ' (checked again against the project)';
  switch (s.type) {
    case 'explain':
      s.body += note;
      break;
    case 'conceptBridge':
      s.applied += note;
      break;
    case 'codeTour':
      for (const stop of s.stops.slice(0, 1)) stop.annotation += note;
      break;
    case 'diagram':
      s.caption = `${s.caption ?? stepTitle(step)}${note}`;
      break;
    case 'putInOrder':
    case 'match':
    case 'spotIt':
    case 'quickCheck':
      s.explanation += note;
      break;
    case 'tryIt':
      s.instruction += note;
      break;
    case 'recap':
      s.takeaways = s.takeaways.map((t, i) => (i === 0 ? t + note : t));
      break;
  }
  s.selfCheck = { projectSpecific: true, reason: 'cites the changed files of the project' };
  return s;
}

/** What the mock model answers (`tutorialScript`). */
export function scriptedReview(
  script: MockTutorialScript,
  composed: MockReviewComposed,
  attempt: number,
): RawReview {
  const t = composed.tutorial;
  if (script === 'exhaust') return { chapters: [], missingTopics: [] };
  const chapters: RawChapter[] = t.chapters.flatMap((c, ci) => {
    if (c.steps.length === 0) return [];
    const hits = composed.affected.filter((a) => a.chapter === ci);
    const proposals: RawProposal[] = hits.flatMap((h) => {
      const step = c.steps[h.step];
      return step
        ? [
            {
              step: h.step,
              reason: `The cited lines of ${t.project} changed since it was written.`,
              change: 'The cited lines changed in the project.',
              replacement: rewritten(step),
            },
          ]
        : [];
    });
    if (script === 'retry' && attempt === 1 && ci === 0)
      proposals.push({
        step: 99,
        reason: 'A step that does not exist.',
        change: 'Nothing.',
        replacement: rewritten(c.steps[0] as Step),
      });
    return [
      {
        id: c.id,
        verdict: proposals.length > 0 ? 'outdated' : 'correct',
        reason:
          proposals.length > 0
            ? `Some of its steps cite lines of ${t.project} that changed.`
            : `Every step still matches ${t.project}.`,
        proposals,
      },
    ];
  });
  return {
    chapters,
    missingTopics: [
      {
        title: `How ${t.project} is deployed`,
        goal: `Follow scripts/deploy.sh of ${t.project}, from the build to the deployment.`,
        reason: 'The tutorial never mentions the deployment script.',
      },
    ],
  };
}

export class MockReviewValidator {
  private best: TutorialReview | null = null;
  private rejectedTotal = 0;
  private lastReason = '';
  constructor(private readonly composed: MockReviewComposed) {}

  private validate(raw: RawReview): [TutorialReview, string[]] {
    const t = this.composed.tutorial;
    const rejected: string[] = [];
    const seen = new Set<string>();
    const chapters: TutorialReview['chapters'] = [];
    for (const rc of raw.chapters) {
      const index = t.chapters.findIndex((c) => c.id === rc.id);
      const chapter = t.chapters[index];
      if (!chapter) {
        rejected.push(`chapter ${rc.id}: there is no such chapter`);
        continue;
      }
      if (chapter.steps.length === 0 || seen.has(rc.id)) continue;
      seen.add(rc.id);
      const proposals: TutorialReview['chapters'][number]['proposals'] = [];
      for (const p of rc.proposals) {
        const at = `chapter ${rc.id} step ${String(p.step)}`;
        const original = chapter.steps[p.step];
        if (!original) {
          rejected.push(`${at}: the chapter has no such step`);
          continue;
        }
        if (proposals.some((q) => q.step === p.step)) continue;
        let step: Step;
        try {
          step = parseStep(p.replacement, at);
        } catch (e) {
          rejected.push(`${at}: the replacement is not a step (${String(e)})`);
          continue;
        }
        if (step.type !== original.type) {
          rejected.push(`${at}: the replacement must keep the step's type`);
          continue;
        }
        const v = checkStep(step, this.composed.ctx);
        if (v.ok)
          proposals.push({
            step: p.step,
            reason: p.reason.trim(),
            change: p.change.trim(),
            replacement: v.value,
          });
        else rejected.push(`${at}: ${v.message}`);
      }
      chapters.push({
        id: rc.id,
        index,
        verdict: proposals.length > 0 ? 'outdated' : rc.verdict,
        reason: rc.reason.trim(),
        proposals,
      });
    }
    for (const c of t.chapters)
      if (c.steps.length > 0 && !seen.has(c.id)) rejected.push(`chapter ${c.id}: not reviewed`);
    chapters.sort((a, b) => a.index - b.index);
    const missingTopics = raw.missingTopics
      .filter((m) => m.title.trim() !== '' && m.goal.trim() !== '')
      .slice(0, MAX_MISSING_TOPICS)
      .map((m) => ({
        title: m.title.split(/\s+/).filter(Boolean).join(' '),
        goal: m.goal.trim(),
        reason: m.reason.trim(),
      }));
    return [{ tutorialId: t.id, chapters, missingTopics, rejectedCount: 0 }, rejected];
  }

  private result(r: TutorialReview): TutorialReview {
    return { ...r, rejectedCount: this.rejectedTotal };
  }

  check(value: unknown): MockVerdict {
    const raw = value as RawReview | null;
    if (!raw || !Array.isArray(raw.chapters)) {
      this.lastReason = 'the answer was not valid JSON';
      return {
        type: 'retry',
        repairPrompt: 'Your answer could not be read as the review JSON. Return it again.',
        reason: this.lastReason,
      };
    }
    const [review, rejected] = this.validate(raw);
    this.rejectedTotal += rejected.length;
    if (!this.best || review.chapters.length >= this.best.chapters.length) this.best = review;
    if (rejected.length === 0) return { type: 'accept', value: this.result(review) };
    this.lastReason = `${String(rejected.length)} problems`;
    return {
      type: 'retry',
      repairPrompt: [
        'Thank you. IGrasp checked your review against the tutorial and the project. Fix these, keep the rest, and return the complete JSON again:',
        ...rejected.map((r) => `- ${r}`),
      ].join('\n'),
      reason: this.lastReason,
    };
  }

  onExhausted(): MockVerdict {
    const best = this.best;
    if (best && best.chapters.length > 0) return { type: 'accept', value: this.result(best) };
    return {
      type: 'fail',
      message: `Hoot could not check this tutorial after ${String(1 + MOCK_MAX_RETRIES)} attempts (${this.lastReason}).`,
    };
  }
}
