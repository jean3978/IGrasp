// An interactive step of a shared tutorial's chapter file as a folded card: what the step asks,
// then the answer (the order, the pairs, the line, what to expect) folded, so reading the file
// on its own does not spoil the tutorial. Nothing runs: a try-it command is shown, never run. A
// block that does not parse shows as the plain code it is.

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { openSourceFile } from '../../../stores/tabs';
import { blockCitationLabel, parseTutorialBlock } from '../../academy/tutorialBlocks';
import type { BlockCitation, TutorialBlockKind } from '../../academy/tutorialBlocks';
import { InlineCode } from '../../quiz/InlineCode';

const LABEL: Record<TutorialBlockKind, string> = {
  'code-tour': 'Code tour',
  'spot-it': 'Spot it',
  'put-in-order': 'Put in order',
  match: 'Match',
  'try-it': 'Try it yourself',
  question: 'Question from a reader',
};

function Source({ c, note }: { c: BlockCitation; note?: string | null | undefined }) {
  return (
    <li>
      <button
        type="button"
        className="quiz-block-source"
        onClick={() => {
          openSourceFile(c.path, c.firstLine ?? undefined, c.lastLine ?? undefined);
        }}
      >
        {blockCitationLabel(c)}
      </button>
      {note && (
        <span className="quiz-block-why">
          {' '}
          · <InlineCode text={note} />
        </span>
      )}
    </li>
  );
}

function Sources({ sources }: { sources: BlockCitation[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="quiz-block-sources" aria-label="Sources">
      {sources.map((c, i) => (
        <Source key={`${c.path}-${String(i)}`} c={c} note={c.why} />
      ))}
    </ul>
  );
}

function Folded({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="quiz-block-answer">
      <summary>
        <ChevronRight aria-hidden className="quiz-block-chevron" />
        {label}
      </summary>
      {children}
    </details>
  );
}

export function TutorialBlock({
  kind,
  source,
  fallback,
}: {
  kind: TutorialBlockKind;
  source: string;
  fallback: ReactNode;
}) {
  const block = parseTutorialBlock(kind, source);
  if (!block) return <>{fallback}</>;
  let body: ReactNode;
  switch (block.kind) {
    case 'code-tour':
      body = (
        <ol className="tutorial-block-stops">
          {block.stops.map((s, i) => (
            <Source key={`${s.path}-${String(i)}`} c={s} note={s.annotation} />
          ))}
        </ol>
      );
      break;
    case 'spot-it':
      body = (
        <>
          <p>
            <InlineCode text={block.prompt} />
          </p>
          <ul className="quiz-block-sources" aria-label="Where">
            <Source c={block.at} />
          </ul>
          <Folded label="Show the line">
            <p>
              <strong>Line {block.answerLine}</strong>
            </p>
            {block.explanation && (
              <p>
                <InlineCode text={block.explanation} />
              </p>
            )}
          </Folded>
        </>
      );
      break;
    case 'put-in-order':
      body = (
        <>
          <p>
            <InlineCode text={block.prompt} />
          </p>
          <Folded label="Show the order">
            <ol>
              {block.items.map((item, i) => (
                <li key={i}>
                  <InlineCode text={item} />
                </li>
              ))}
            </ol>
            {block.explanation && (
              <p>
                <InlineCode text={block.explanation} />
              </p>
            )}
            <Sources sources={block.sources} />
          </Folded>
        </>
      );
      break;
    case 'match':
      body = (
        <>
          <p>
            <InlineCode text={block.prompt} />
          </p>
          <Folded label="Show the pairs">
            <ul>
              {block.pairs.map((p, i) => (
                <li key={i}>
                  <InlineCode text={p.left} /> → <InlineCode text={p.right} />
                </li>
              ))}
            </ul>
            {block.explanation && (
              <p>
                <InlineCode text={block.explanation} />
              </p>
            )}
            <Sources sources={block.sources} />
          </Folded>
        </>
      );
      break;
    case 'question':
      body = (
        <>
          <p className="quiz-muted">About step {block.step}</p>
          {block.quote && <blockquote>{block.quote}</blockquote>}
          <p>
            <InlineCode text={block.question} />
          </p>
          <Folded label="Show the answer">
            {block.answer.split(/\n{2,}/).map((para, i) => (
              <p key={i}>
                <InlineCode text={para} />
              </p>
            ))}
          </Folded>
        </>
      );
      break;
    case 'try-it':
      body = (
        <>
          <p>
            <InlineCode text={block.instruction} />
          </p>
          {block.command && (
            <p>
              <code>{block.command}</code>
              {block.where && <span className="quiz-muted"> · in the {block.where}</span>}
            </p>
          )}
          {block.expected && (
            <Folded label="What to expect">
              <p>
                <InlineCode text={block.expected} />
              </p>
            </Folded>
          )}
          <Sources sources={block.sources} />
        </>
      );
      break;
  }
  return (
    <div className="quiz-block tutorial-block" role="group" aria-label={LABEL[kind]}>
      <p className="tutorial-block-kind">{LABEL[kind]}</p>
      {body}
    </div>
  );
}
