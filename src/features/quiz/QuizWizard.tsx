// A new quiz in four steps: who you are on the project (a role proposed for this kind of
// project, or your own), what kind of quiz (global concepts, a feature, or specific code to
// check), its subject (a proposed one or something else you type, read in the light of the kind),
// then the options (questions, mode, sources, model) and Start (the AI marker: the confirmation
// card that follows leads to the one call). The role and the kind are kept with the quiz.

import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, FileCode, Layers, Puzzle } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { QuizCategory, QuizMode, QuizScopeSetting, Subject } from '../../ipc/types';
import { selectUsable, useAiProvider } from '../../stores/aiProvider';
import { useProjectProfile } from '../../stores/projectProfile';
import { selectQuizBusy, targetReady, useQuiz } from '../../stores/quiz';
import type { QuizSetup } from '../../stores/quiz';
import { ModelPicker } from '../ai/ModelPicker';
import { StatusLine } from '../ai/StatusLine';
import { Segmented } from '../settings/fields';
import { roundsOf } from './quizEngine';
import { rolesFor } from './quizRoles';
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

interface KindInfo {
  title: string;
  description: string;
  icon: LucideIcon;
}

const KINDS: Record<QuizCategory, KindInfo> = {
  global: {
    title: 'Global concepts',
    description:
      'How the project is made across its parts: architecture, tech stack, security, patterns…',
    icon: Layers,
  },
  feature: {
    title: 'A feature',
    description: 'One thing the project does, end to end: a feature or a game system.',
    icon: Puzzle,
  },
  code: {
    title: 'Check specific code',
    description:
      'Detailed, line-level questions on files or folders you pick, e.g. before submitting.',
    icon: FileCode,
  },
};
const KIND_ORDER: QuizCategory[] = ['global', 'feature', 'code'];

const STEPS = ['Your role', 'Kind of quiz', 'Subject', 'Options'] as const;
type Step = 1 | 2 | 3 | 4;

/** What the quiz is about, in a few words, for the options step. */
function subjectLabel(setup: QuizSetup, subjects: Subject[]): string {
  if (setup.target === 'paths') return setup.paths.join(', ');
  if (setup.target === 'custom') return `“${setup.customSubject.trim()}”`;
  return subjects.find((s) => s.id === setup.subjectId)?.title ?? 'The whole project';
}

function RoleStep() {
  const role = useQuiz((s) => s.setup.role);
  const setSetup = useQuiz((s) => s.setSetup);
  const profile = useProjectProfile((s) => s.profile);
  const roles = rolesFor(profile);
  const proposed = roles.includes(role);
  const [other, setOther] = useState(() => (proposed ? '' : role));
  const otherId = useId();
  return (
    <>
      <div className="quiz-subjects" role="radiogroup" aria-label="Roles">
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={role === r}
            className={clsx('quiz-subject', { 'quiz-subject-selected': role === r })}
            onClick={() => {
              setSetup({ role: r });
            }}
          >
            {r}
          </button>
        ))}
      </div>
      <div className={clsx('quiz-other', { 'quiz-other-selected': !proposed && role !== '' })}>
        <label className="quiz-other-label" htmlFor={otherId}>
          Other role
        </label>
        <input
          id={otherId}
          className="quiz-custom-subject text-input"
          type="text"
          maxLength={80}
          placeholder="e.g. narrative designer, security reviewer, new hire"
          value={other}
          onChange={(e) => {
            setOther(e.target.value);
            setSetup({ role: e.target.value });
          }}
          onFocus={() => {
            if (other.trim() !== '') setSetup({ role: other });
          }}
        />
      </div>
    </>
  );
}

function Options({ checkingCode }: { checkingCode: boolean }) {
  const setup = useQuiz((s) => s.setup);
  const setSetup = useQuiz((s) => s.setSetup);
  const countId = useId();
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const headingId = useId();
  const kind = setup.category;

  const roleReady = setup.role.trim() !== '';
  const subjectReady =
    setup.target === 'custom'
      ? targetReady(setup)
      : kind === 'code'
        ? setup.target === 'paths' && setup.paths.length > 0
        : kind === 'feature'
          ? setup.target === 'subject' && features.some((f) => f.id === setup.subjectId)
          : setup.target === 'subject';
  const reachable = (n: Step) => n === 1 || (roleReady && (n === 2 || n === 3 || subjectReady));

  // A step change moves the focus to its heading, not on first show.
  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
  }, [step]);
  const go = (next: Step) => {
    moved.current = true;
    setStep(next);
  };

  const choose = (next: QuizCategory) => {
    if (next === 'code') setSetup({ category: next, target: 'paths' });
    else {
      const list = next === 'global' ? global : features;
      setSetup({
        category: next,
        target: 'subject',
        subjectId: list.some((s) => s.id === setup.subjectId) ? setup.subjectId : null,
      });
    }
    go(3);
  };

  const heading =
    step === 1
      ? 'Who are you on this project?'
      : step === 2
        ? 'What kind of quiz?'
        : step === 3
          ? kind === 'global'
            ? 'Which concept?'
            : kind === 'feature'
              ? 'Which feature?'
              : 'Which code should Hoot check?'
          : 'How should the quiz go?';

  return (
    <section className="quiz-panel quiz-setup quiz-wizard" aria-labelledby={headingId}>
      <ol className="quiz-steps" aria-label="Steps">
        {STEPS.map((label, i) => {
          const n = (i + 1) as Step;
          return (
            <li key={label}>
              <button
                type="button"
                className={clsx('quiz-step', {
                  'quiz-step-current': n === step,
                  'quiz-step-done': n < step,
                })}
                aria-current={n === step ? 'step' : undefined}
                disabled={!reachable(n) || n === step}
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

      <div className="quiz-wizard-body">
        {step === 1 && (
          <>
            <p className="quiz-muted quiz-wizard-intro">
              Hoot writes for your role: what you need to know about this project, at the depth that
              fits your work.
            </p>
            <RoleStep />
          </>
        )}

        {step === 2 && (
          <div className="quiz-kinds" role="radiogroup" aria-labelledby={headingId}>
            {KIND_ORDER.map((k) => {
              const { title, description, icon: Icon } = KINDS[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  className={clsx('quiz-kind', { 'quiz-kind-selected': kind === k })}
                  onClick={() => {
                    choose(k);
                  }}
                >
                  <Icon aria-hidden className="quiz-kind-icon" />
                  <span className="quiz-kind-title">{title}</span>
                  <span className="quiz-kind-text">{description}</span>
                </button>
              );
            })}
          </div>
        )}

        {step === 3 && (
          <>
            <p className="quiz-muted quiz-wizard-intro">{KINDS[kind].description}</p>
            {kind === 'code' ? (
              <CodeToCheck />
            ) : (
              <>
                <SubjectChoices group={kind} label={kind === 'global' ? 'Concepts' : 'Features'} />
                {kind === 'feature' && features.length === 0 && (
                  <p className="quiz-muted">
                    No feature was detected in this project: type the one you want below.
                  </p>
                )}
                <CustomSubjectField group={kind} />
              </>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <p className="quiz-wizard-summary">
              <span className="quiz-muted">As</span> <strong>{setup.role.trim()}</strong>
              <span className="quiz-muted"> · {KINDS[kind].title}:</span>{' '}
              <strong>{subjectLabel(setup, subjects)}</strong>{' '}
              <button
                type="button"
                className="quiz-link-button"
                onClick={() => {
                  go(3);
                }}
              >
                Change
              </button>
            </p>
            <Options checkingCode={kind === 'code'} />
            <StatusLine part="problem" showSession={false} />
          </>
        )}
      </div>

      <div className="quiz-wizard-nav">
        {step > 1 && (
          <Button
            onClick={() => {
              go((step - 1) as Step);
            }}
          >
            <ArrowLeft aria-hidden /> Back
          </Button>
        )}
        <span className="quiz-wizard-spacer" />
        {(step === 1 || step === 3) && (
          <Button
            variant="primary"
            disabled={step === 1 ? !roleReady : !subjectReady}
            onClick={() => {
              go(step === 1 ? 2 : 4);
            }}
          >
            Next <ArrowRight aria-hidden />
          </Button>
        )}
        {step === 2 && <span className="quiz-muted">Pick a kind of quiz to go on.</span>}
        {step === 4 && (
          <>
            <span className="quiz-muted">Nothing is sent until you confirm on the next card.</span>
            <Button
              variant="primary"
              className="quiz-start-button"
              disabled={busy || !usable || !subjectReady || !roleReady}
              onClick={() => void prepare()}
            >
              Start <AiMark />
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
