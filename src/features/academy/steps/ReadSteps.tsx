// The steps one reads: an explain card, a concept bridge and a diagram (the recap, in Recap.tsx).
// Keys while the card has the focus: Enter or → next, ← previous, R read more, D the official
// docs (a bridge), Escape back to the map.

import { ArrowLeft, ArrowRight, ExternalLink, Lightbulb } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button } from '../../../components/ui/Button';
import { backend } from '../../../ipc/client';
import type { ConceptBridgeStep, DiagramStep, ExplainStep } from '../../../ipc/types';
import { MermaidBlock } from '../../mermaid/MermaidBlock';
import { InlineCode } from '../../quiz/InlineCode';
import { StepMarkdown, StepSources } from './common';
import { openCitation } from './stepUtils';
import type { StepProps } from './types';

/** The frame of a read step: its keys and its Previous / Next. */
export function ReadFrame({
  props,
  children,
  nextLabel = 'Next',
  extraKeys,
}: {
  props: StepProps;
  children: ReactNode;
  nextLabel?: string;
  extraKeys?: (key: string) => boolean;
}) {
  const go = () => {
    props.onComplete({ kind: 'read' });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea, .mermaid-block')) {
      if (e.key !== 'Escape') return;
    }
    const key = e.key.toLowerCase();
    if (key === 'enter' || key === 'arrowright') {
      e.preventDefault();
      go();
    } else if (key === 'arrowleft') {
      e.preventDefault();
      props.onPrevious();
    } else if (key === 'r' && props.sources[0]) {
      openCitation(props.sources[0]);
    } else if (key === 'escape') {
      e.stopPropagation();
      props.onEscape();
    } else if (extraKeys?.(key)) {
      e.preventDefault();
    }
  };
  return (
    <div className="academy-step-body" onKeyDown={onKeyDown}>
      {children}
      <StepSources sources={props.sources} status={props.sourceStatus} />
      <div className="academy-step-nav">
        <Button variant="ghost" onClick={props.onPrevious} disabled={props.first}>
          <ArrowLeft aria-hidden /> Previous
        </Button>
        <Button variant="primary" className="academy-step-next" onClick={go}>
          {props.done ? 'Next' : nextLabel} <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export function Explain({ step, props }: { step: ExplainStep; props: StepProps }) {
  return (
    <ReadFrame props={props}>
      <StepMarkdown text={step.body} />
    </ReadFrame>
  );
}

export function ConceptBridge({ step, props }: { step: ConceptBridgeStep; props: StepProps }) {
  const docs = step.docsUrl;
  const openDocs = () => {
    if (docs) void backend.openUrl(docs);
  };
  return (
    <ReadFrame
      props={props}
      extraKeys={(key) => {
        if (key !== 'd' || !docs) return false;
        openDocs();
        return true;
      }}
    >
      <aside className="academy-bridge" aria-label="Concept">
        <p className="academy-bridge-concept">
          <Lightbulb aria-hidden /> <strong>Concept:</strong> <InlineCode text={step.concept} />
        </p>
        {docs && (
          <button type="button" className="academy-link" onClick={openDocs} title={docs}>
            <ExternalLink aria-hidden /> Official docs
          </button>
        )}
      </aside>
      <p className="academy-bridge-applied-label">Applied here</p>
      <StepMarkdown text={step.applied} />
    </ReadFrame>
  );
}

export function Diagram({ step, props }: { step: DiagramStep; props: StepProps }) {
  return (
    <ReadFrame props={props}>
      <div className="academy-diagram">
        <MermaidBlock source={step.mermaid} />
      </div>
      {step.caption && (
        <p className="academy-caption">
          <InlineCode text={step.caption} />
        </p>
      )}
    </ReadFrame>
  );
}
