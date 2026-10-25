// The steps on real code: a code tour (stops through the project's files, each range highlighted
// with its annotation, walked like slides) and Spot it (click the line that does a given thing).
// Keys of a tour: → or N next stop, ← or P previous, O open in the code viewer, Enter the next
// step on the last stop. Keys of Spot it: ↑/↓ move the cursor, Enter picks the line.

import { ArrowLeft, ArrowRight, Code2, Crosshair } from 'lucide-react';
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CodeView } from '../../../components/CodeView';
import { Button } from '../../../components/ui/Button';
import type { CodeTourStep, SpotItStep } from '../../../ipc/types';
import { openSourceFile } from '../../../stores/tabs';
import { playEffect } from '../../quiz/effects/effects';
import { InlineCode } from '../../quiz/InlineCode';
import { StepMarkdown, StepSources } from './common';
import { MAX_TRIES } from './stepUtils';
import type { StepProps } from './types';

export function CodeTour({ step, props }: { step: CodeTourStep; props: StepProps }) {
  const [stop, setStop] = useState(0);
  const current = step.stops[stop];
  const last = stop === step.stops.length - 1;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if ((e.target as HTMLElement).closest('button') && e.key !== 'Escape') return;
    const key = e.key.toLowerCase();
    if (key === 'arrowright' || key === 'n') {
      e.preventDefault();
      if (!last) setStop(stop + 1);
      else props.onComplete({ kind: 'read' });
    } else if (key === 'arrowleft' || key === 'p') {
      e.preventDefault();
      if (stop > 0) setStop(stop - 1);
      else props.onPrevious();
    } else if (key === 'enter' && last) {
      e.preventDefault();
      props.onComplete({ kind: 'read' });
    } else if (key === 'o' && current) {
      openSourceFile(current.path, current.firstLine, current.lastLine);
    } else if (key === 'escape') {
      e.stopPropagation();
      props.onEscape();
    }
  };
  if (!current) return null;
  return (
    <div className="academy-step-body" onKeyDown={onKeyDown}>
      <div className="academy-tour">
        <div className="academy-tour-code">
          <p className="academy-tour-path">
            {current.path}:{current.firstLine}
            {current.lastLine !== current.firstLine ? `-${String(current.lastLine)}` : ''}
          </p>
          <CodeView
            key={`${current.path}-${String(stop)}`}
            path={current.path}
            highlight={{ first: current.firstLine, last: current.lastLine }}
            className="academy-code"
            label={`${current.path}, stop ${String(stop + 1)} of ${String(step.stops.length)}`}
          />
        </div>
        <div className="academy-tour-note" aria-live="polite">
          <p className="academy-tour-count">
            Stop {stop + 1} of {step.stops.length}
          </p>
          <StepMarkdown text={current.annotation} />
          <Button
            variant="ghost"
            onClick={() => {
              openSourceFile(current.path, current.firstLine, current.lastLine);
            }}
          >
            <Code2 aria-hidden /> Open in the code viewer
          </Button>
        </div>
      </div>
      <div className="academy-stop-dots" role="group" aria-label="Stops">
        {step.stops.map((s, i) => (
          <button
            key={`${s.path}-${String(i)}`}
            type="button"
            className="academy-stop-dot"
            aria-label={`Stop ${String(i + 1)}: ${s.path}`}
            aria-current={i === stop ? 'step' : undefined}
            onClick={() => {
              setStop(i);
            }}
          />
        ))}
      </div>
      <div className="academy-step-nav">
        <Button
          variant="ghost"
          onClick={() => {
            if (stop > 0) setStop(stop - 1);
            else props.onPrevious();
          }}
          disabled={props.first && stop === 0}
        >
          <ArrowLeft aria-hidden /> Previous
        </Button>
        <Button
          variant="primary"
          className="academy-step-next"
          onClick={() => {
            if (last) props.onComplete({ kind: 'read' });
            else setStop(stop + 1);
          }}
        >
          {last ? 'Next step' : 'Next stop'} <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export function SpotIt({ step, props }: { step: SpotItStep; props: StepProps }) {
  const [cursor, setCursor] = useState(step.firstLine);
  const [wrong, setWrong] = useState<number[]>([]);
  const [solved, setSolved] = useState<'right' | 'shown' | null>(
    props.answer ? (props.answer.right ? 'right' : 'shown') : null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const tries = wrong.length + (solved === 'right' ? 1 : 0);

  const pick = (line: number) => {
    if (solved) return;
    if (line === step.answerLine) {
      setSolved('right');
      playEffect('sparks', rootRef.current?.querySelector('[data-mark="right"]'));
      props.onComplete(
        { kind: 'answered', right: true, tries: wrong.length + 1, usedHint: false },
        true,
      );
    } else {
      const next = [...wrong, line];
      setWrong(next);
      if (next.length >= MAX_TRIES) {
        setSolved('shown');
        props.onComplete(
          { kind: 'answered', right: false, tries: next.length, usedHint: false },
          true,
        );
      }
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowdown') {
      e.preventDefault();
      setCursor(Math.min(step.lastLine, cursor + 1));
    } else if (key === 'arrowup') {
      e.preventDefault();
      setCursor(Math.max(step.firstLine, cursor - 1));
    } else if (key === 'enter' || key === ' ') {
      if ((e.target as HTMLElement).closest('.academy-step-nav')) return;
      e.preventDefault();
      if (solved) props.onNext();
      else pick(cursor);
    } else if (key === 'escape') {
      e.stopPropagation();
      props.onEscape();
    }
  };
  const marks: Record<number, 'right' | 'wrong' | 'picked'> = {};
  for (const w of wrong) marks[w] = 'wrong';
  if (solved) marks[step.answerLine] = 'right';
  return (
    <div className="academy-step-body" ref={rootRef} onKeyDown={onKeyDown}>
      <p className="academy-prompt">
        <Crosshair aria-hidden /> <InlineCode text={step.prompt} />
      </p>
      <p className="quiz-muted">
        {step.path} · use ↑ ↓ and Enter, or click a line
        {!solved && wrong.length > 0 ? ` · ${String(MAX_TRIES - wrong.length)} try left` : ''}
      </p>
      <div tabIndex={-1} className="academy-spot-frame">
        <CodeView
          path={step.path}
          window={{ first: step.firstLine, last: step.lastLine }}
          onLineClick={pick}
          cursorLine={solved ? null : cursor}
          marks={marks}
          className="academy-code academy-code-spot"
          label={`${step.path}, lines ${String(step.firstLine)} to ${String(step.lastLine)}: pick a line`}
        />
      </div>
      <div aria-live="polite">
        {solved && (
          <div className="academy-reveal" data-right={solved === 'right' ? 'true' : undefined}>
            <p className="academy-verdict">
              {solved === 'right'
                ? tries <= 1
                  ? 'Spot on.'
                  : 'Found it.'
                : `It was line ${String(step.answerLine)}.`}
            </p>
            <StepMarkdown text={step.explanation} />
          </div>
        )}
      </div>
      <StepSources sources={props.sources} status={props.sourceStatus} />
      <div className="academy-step-nav">
        <Button variant="ghost" onClick={props.onPrevious} disabled={props.first}>
          <ArrowLeft aria-hidden /> Previous
        </Button>
        <Button
          variant="primary"
          className="academy-step-next"
          disabled={!solved && !props.done}
          onClick={props.onNext}
        >
          Next <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
