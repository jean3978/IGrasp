// A Quick check (the quiz's own question card, with its hint, Look it up and gentle reveal) and
// Try it yourself (a command to copy, a change to try, something to open in the engine or the
// IDE). The app never runs a command: Copy puts it on the clipboard. Keys of Try it: C copy, O open
// the cited file, Enter "I did it", S skip.

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Code2,
  FolderOpen,
  SkipForward,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import { backend } from '../../../ipc/client';
import type { QuickCheckStep, TryItStep } from '../../../ipc/types';
import { useToasts } from '../../../stores/toasts';
import { pickLine } from '../../hoot/hootLines';
import { playEffect } from '../../quiz/effects/effects';
import { LookUpDialog } from '../../quiz/LookUpDialog';
import { QuestionCard } from '../../quiz/QuestionCard';
import { StepMarkdown, StepSources } from './common';
import { asQuestion, openCitation } from './stepUtils';
import type { StepProps } from './types';

export function QuickCheck({ step, props }: { step: QuickCheckStep; props: StepProps }) {
  const question = useMemo(() => asQuestion(step, props.stepKey), [step, props.stepKey]);
  const [chosen, setChosen] = useState<number | null>(
    props.answer
      ? props.answer.right
        ? step.answer
        : (step.answer + 1) % step.choices.length
      : null,
  );
  const [usedHint, setUsedHint] = useState(false);
  const [looking, setLooking] = useState(false);
  const [lookedUp, setLookedUp] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const readable = question.sources.some((s) => s.kind !== 'binary');
  return (
    <div className="academy-step-body academy-quick" ref={rootRef}>
      <QuestionCard
        question={question}
        number={1}
        total={1}
        chosen={chosen}
        usedHint={usedHint}
        onChoose={(choice) => {
          if (chosen !== null) return;
          setChosen(choice);
          const right = choice === step.answer;
          setLine(pickLine(right ? 'right' : 'wrong'));
          if (right) playEffect('confetti', rootRef.current?.querySelector('.quiz-choice-right'));
          props.onComplete({ kind: 'answered', right, tries: 1, usedHint }, true);
        }}
        onHint={() => {
          setUsedHint(true);
        }}
        {...(readable
          ? {
              onLookUp: () => {
                setLooking(true);
                setLookedUp(true);
              },
            }
          : {})}
        lookedUp={lookedUp}
        onNext={props.onNext}
        onEscape={props.onEscape}
        verdictLine={line}
        actions={
          <Button variant="primary" className="quiz-next" onClick={props.onNext}>
            Next <ArrowRight aria-hidden />
          </Button>
        }
      />
      {readable && (
        <LookUpDialog
          question={question}
          open={looking}
          onOpenChange={setLooking}
          motion={props.motion}
        />
      )}
      <div className="academy-step-nav">
        <Button variant="ghost" onClick={props.onPrevious} disabled={props.first}>
          <ArrowLeft aria-hidden /> Previous
        </Button>
      </div>
    </div>
  );
}

const WHERE_LABEL: Record<string, string> = {
  terminal: 'In a terminal, at the root of the project',
  ide: 'In your IDE',
  engine: 'In the engine',
  browser: 'In the browser',
  device: 'On a device',
};

export function TryIt({ step, props }: { step: TryItStep; props: StepProps }) {
  const firstText = step.sources.find((s) => s.firstLine !== undefined);
  const firstAsset = step.sources.find((s) => s.firstLine === undefined);
  const copy = async () => {
    if (!step.command) return;
    try {
      await navigator.clipboard.writeText(step.command);
      useToasts.getState().notify('info', 'Command copied. IGrasp never runs it.');
    } catch {
      useToasts.getState().notify('error', 'Cannot copy to the clipboard.');
    }
  };
  const open = () => {
    if (firstText) openCitation(firstText);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if ((e.target as HTMLElement).closest('button') && e.key !== 'Escape') return;
    const key = e.key.toLowerCase();
    if (key === 'c') void copy();
    else if (key === 'o') open();
    else if (key === 's') props.onComplete({ kind: 'skipped' });
    else if (key === 'enter') {
      e.preventDefault();
      props.onComplete({ kind: 'read' });
    } else if (key === 'escape') {
      e.stopPropagation();
      props.onEscape();
    }
  };
  return (
    <div className="academy-step-body" onKeyDown={onKeyDown}>
      <StepMarkdown text={step.instruction} />
      {step.where && <p className="academy-where">{WHERE_LABEL[step.where] ?? step.where}</p>}
      {step.command && (
        <div className="academy-command">
          <code>{step.command}</code>
          <Button
            variant="ghost"
            onClick={() => {
              void copy();
            }}
            title="Copy (C). IGrasp never runs it."
          >
            <Clipboard aria-hidden /> Copy
          </Button>
        </div>
      )}
      {step.expected && (
        <p className="academy-expected">
          <strong>What you should see:</strong> {step.expected}
        </p>
      )}
      <div className="academy-step-actions">
        {firstText && (
          <Button variant="ghost" onClick={open}>
            <Code2 aria-hidden /> Open {firstText.path}
          </Button>
        )}
        {firstAsset && !firstText && (
          <Button
            variant="ghost"
            onClick={() => {
              void backend.revealInFileManager(firstAsset.path);
            }}
          >
            <FolderOpen aria-hidden /> Reveal {firstAsset.path}
          </Button>
        )}
      </div>
      <StepSources sources={props.sources} status={props.sourceStatus} />
      <div className="academy-step-nav">
        <Button variant="ghost" onClick={props.onPrevious} disabled={props.first}>
          <ArrowLeft aria-hidden /> Previous
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            props.onComplete({ kind: 'skipped' });
          }}
        >
          <SkipForward aria-hidden /> Skip
        </Button>
        <Button
          variant="primary"
          className="academy-step-next"
          onClick={() => {
            props.onComplete({ kind: 'read' });
          }}
        >
          <Check aria-hidden /> I did it
        </Button>
      </div>
    </div>
  );
}
