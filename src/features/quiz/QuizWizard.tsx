// A new quiz in three steps: what kind of quiz (global concepts, a feature, your own subject, or
// specific code to check), then its subject, then the options (questions, mode, sources, model)
// and Start (the AI marker: the confirmation card that follows leads to the one call).

import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, FileCode, Layers, PenLine, Puzzle } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { QuizMode, QuizScopeSetting, Subject } from '../../ipc/types';
import { selectUsable, useAiProvider } from '../../stores/aiProvider';
import { useProjectProfile } from '../../stores/projectProfile';
import { selectQuizBusy, targetReady, useQuiz } from '../../stores/quiz';
import type { QuizSetup } from '../../stores/quiz';
import { ModelPicker } from '../ai/ModelPicker';
import { StatusLine } from '../ai/StatusLine';
import { Segmented } from '../settings/fields';
import { roundsOf } from './quizEngine';
import { CodeToCheck, CustomSubjectField, SubjectChoices } from './SubjectPicker';
import { useSubjects } from './useSubjects';

export const MIN_COUNT = 5;
export const MAX_COUNT = 30;

const MODES: { value: QuizMode; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'adaptive', label: 'Adaptive' },
];

const SCOPES: { value: QuizScopeSetting; label: string }[] = [
  { value: 'wholeProject', label: 'Whole project' },
  { value: 'documentationOnly', label: 'Documentation only' },
];

export type QuizKind = 'global' | 'feature' | 'custom' | 'paths';

interface KindInfo {
  kind: QuizKind;
  title: string;
  description: string;
  icon: LucideIcon;
}

const GLOBAL_KIND: KindInfo = {
  kind: 'global',
  title: 'Global concepts',
  description:
    'How the project is made across its parts: architecture, tech stack, security, patterns…',
  icon: Layers,
};

const KINDS: KindInfo[] = [
  GLOBAL_KIND,
  {
    kind: 'feature',
    title: 'A feature',
    description: 'One thing the project does, end to end: a feature or a game system.',
    icon: Puzzle,
  },
  {
    kind: 'custom',
    title: 'Your own subject',
    description: 'Type any subject and Hoot asks about it in this project.',
    icon: PenLine,
  },
  {
    kind: 'paths',
    title: 'Check specific code',
    description:
      'Detailed, line-level questions on files or folders you pick, e.g. before submitting.',
    icon: FileCode,
  },
];

const STEPS = ['Kind of quiz', 'Subject', 'Options'] as const;
type Step = 1 | 2 | 3;

/** The kind of quiz the setup describes (a feature is a proposed subject of that group). */
function kindOf(setup: QuizSetup, features: Subject[]): QuizKind {
  if (setup.target === 'paths') return 'paths';
  if (setup.target === 'custom') return 'custom';
  return features.some((f) => f.id === setup.subjectId) ? 'feature' : 'global';
}

/** What the quiz is about, in a few words, for the options step. */
function subjectLabel(kind: QuizKind, setup: QuizSetup, subjects: Subject[]): string {
  if (kind === 'paths') return setup.paths.join(', ');
  if (kind === 'custom') return `“${setup.customSubject.trim()}”`;
  return subjects.find((s) => s.id === setup.subjectId)?.title ?? 'The whole project';
}

function Options({ kind }: { kind: QuizKind }) {
  const setup = useQuiz((s) => s.setup);
  const setSetup = useQuiz((s) => s.setSetup);
  const countId = useId();
  const checkingCode = kind === 'paths';
  return (
    <>
      <div className="quiz-options">
        <label className="quiz-option" htmlFor={countId}>
          <span className="quiz-option-label">Questions</span>
          <input
            id={countId}
            className="quiz-count"
            type="number"
            min={MIN_COUNT}
            max={MAX_COUNT}
            value={setup.count}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setSetup({ count: Math.round(n) });
            }}
            onBlur={() => {
              setSetup({ count: Math.min(MAX_COUNT, Math.max(MIN_COUNT, setup.count)) });
            }}
          />
        </label>
        <div className="quiz-option">
          <span className="quiz-option-label">Mode</span>
          <Segmented<QuizMode>
            label="Mode"
            value={setup.mode}
            options={MODES}
            onChange={(mode) => {
              setSetup({ mode });
            }}
          />
        </div>
        {!checkingCode && (
          <div className="quiz-option">
            <span className="quiz-option-label">Sources</span>
            <Segmented<QuizScopeSetting>
              label="Sources"
              value={setup.scope}
              options={SCOPES}
              onChange={(scope) => {
                setSetup({ scope });
              }}
            />
          </div>
        )}
        <div className="quiz-option">
          <span className="quiz-option-label">Model</span>
          <ModelPicker />
        </div>
      </div>
      <p className="quiz-muted quiz-option-help">
        {setup.mode === 'fixed'
          ? 'Fixed: all questions are written now, in one AI call; your level changes their order.'
          : `Adaptive: written in rounds of 5 as you play, at the level you reach. It calls the AI between rounds while you play: about ${String(roundsOf(setup.count))} calls for this quiz, each started by your click on Next round, with a short wait each time.`}{' '}
        {checkingCode
          ? 'Code check: only the files and folders you picked, in detail.'
          : setup.scope === 'wholeProject'
            ? 'Whole project: code, configuration, build, tests and docs.'
            : "Documentation only: what the project's markdown files say."}
      </p>
    </>
  );
}

export function QuizWizard() {
  const setup = useQuiz((s) => s.setup);
  const setSetup = useQuiz((s) => s.setSetup);
  const prepare = useQuiz((s) => s.prepare);
  const busy = useQuiz(selectQuizBusy);
  const usable = useAiProvider(selectUsable);
  const subjects = useProjectProfile((s) => s.subjects) ?? [];
  const global = useSubjects('global');
  const features = useSubjects('feature');
  const [step, setStep] = useState<Step>(1);
  const [kind, setKind] = useState<QuizKind>(() => kindOf(setup, features));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const headingId = useId();

  const ready =
    kind === 'feature'
      ? setup.target === 'subject' && features.some((f) => f.id === setup.subjectId)
      : kind === 'global'
        ? setup.target === 'subject'
        : targetReady(setup);

  // A step change moves the focus to its heading (or to the subject field), not on first show.
  useEffect(() => {
    if (!moved.current) return;
    const field =
      step === 2 && kind === 'custom'
        ? bodyRef.current?.querySelector<HTMLInputElement>('input')
        : null;
    (field ?? headingRef.current)?.focus();
  }, [step, kind]);
  const go = (next: Step) => {
    moved.current = true;
    setStep(next);
  };

  const choose = (next: QuizKind) => {
    setKind(next);
    if (next === 'global')
      setSetup({
        target: 'subject',
        subjectId: global.some((s) => s.id === setup.subjectId) ? setup.subjectId : null,
      });
    else if (next === 'feature')
      setSetup({
        target: 'subject',
        subjectId: features.some((s) => s.id === setup.subjectId) ? setup.subjectId : null,
      });
    else setSetup({ target: next });
    go(2);
  };

  const kindInfo = KINDS.find((k) => k.kind === kind) ?? GLOBAL_KIND;
  const heading =
    step === 1
      ? 'What kind of quiz?'
      : step === 2
        ? kind === 'global'
          ? 'Which concept?'
          : kind === 'feature'
            ? 'Which feature?'
            : kind === 'custom'
              ? 'What should Hoot ask about?'
              : 'Which code should Hoot check?'
        : 'How should the quiz go?';

  return (
    <section className="quiz-panel quiz-setup quiz-wizard" aria-labelledby={headingId}>
      <ol className="quiz-steps" aria-label="Steps">
        {STEPS.map((label, i) => {
          const n = (i + 1) as Step;
          const reachable = n < 3 || ready;
          return (
            <li key={label}>
              <button
                type="button"
                className={clsx('quiz-step', {
                  'quiz-step-current': n === step,
                  'quiz-step-done': n < step,
                })}
                aria-current={n === step ? 'step' : undefined}
                disabled={!reachable || n === step}
                onClick={() => {
                  go(n);
                }}
              >
                <span className="quiz-step-number" aria-hidden>
                  {n}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      <h2
        className="quiz-panel-title quiz-wizard-heading"
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
      >
        {heading}
      </h2>

      <div className="quiz-wizard-body" ref={bodyRef}>
        {step === 1 && (
          <div className="quiz-kinds" role="radiogroup" aria-labelledby={headingId}>
            {KINDS.map(({ kind: k, title, description, icon: Icon }) => {
              const empty = k === 'feature' && features.length === 0;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  className={clsx('quiz-kind', { 'quiz-kind-selected': kind === k })}
                  disabled={empty}
                  onClick={() => {
                    choose(k);
                  }}
                >
                  <Icon aria-hidden className="quiz-kind-icon" />
                  <span className="quiz-kind-title">{title}</span>
                  <span className="quiz-kind-text">
                    {empty ? 'No feature detected in this project.' : description}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {step === 2 && (
          <>
            <p className="quiz-muted quiz-wizard-intro">{kindInfo.description}</p>
            {kind === 'global' && <SubjectChoices group="global" label="Concepts" />}
            {kind === 'feature' && <SubjectChoices group="feature" label="Features" />}
            {kind === 'custom' && <CustomSubjectField />}
            {kind === 'paths' && <CodeToCheck />}
          </>
        )}

        {step === 3 && (
          <>
            <p className="quiz-wizard-summary">
              <span className="quiz-muted">{kindInfo.title}:</span>{' '}
              <strong>{subjectLabel(kind, setup, subjects)}</strong>{' '}
              <button
                type="button"
                className="quiz-link-button"
                onClick={() => {
                  go(2);
                }}
              >
                Change
              </button>
            </p>
            <Options kind={kind} />
            <StatusLine part="problem" showSession={false} />
          </>
        )}
      </div>

      {/* The first step moves on with a click on a kind: no navigation there. */}
      {step > 1 && (
        <div className="quiz-wizard-nav">
          <Button
            onClick={() => {
              go((step - 1) as Step);
            }}
          >
            <ArrowLeft aria-hidden /> Back
          </Button>
          <span className="quiz-wizard-spacer" />
          {step === 2 && (
            <Button
              variant="primary"
              disabled={!ready}
              onClick={() => {
                go(3);
              }}
            >
              Next <ArrowRight aria-hidden />
            </Button>
          )}
          {step === 3 && (
            <>
              <span className="quiz-muted">
                Nothing is sent until you confirm on the next card.
              </span>
              <Button
                variant="primary"
                className="quiz-start-button"
                disabled={busy || !usable || !ready}
                onClick={() => void prepare()}
              >
                Start <AiMark />
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
