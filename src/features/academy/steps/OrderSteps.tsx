// The steps that ask the reader to arrange things: Put in order (the steps of one of this
// project's flows, shuffled) and Match (modules to their jobs, terms to their meaning here). Two
// tries, then the answer and its explanation. Keys of Put in order: ↑/↓ focus an item, Space
// picks it up and puts it down (↑/↓ carry it), Enter checks. Keys of Match: Tab between the
// columns, ↑/↓ within one, Enter or Space selects, Backspace unpairs, Enter on Check.

import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, Check, GripVertical, ListOrdered, Shuffle } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import type { MatchStep, PutInOrderStep } from '../../../ipc/types';
import { playEffect } from '../../quiz/effects/effects';
import { InlineCode } from '../../quiz/InlineCode';
import { shuffledOrder } from '../academyEngine';
import { MAX_TRIES, withoutKeys } from './stepUtils';
import { StepMarkdown, StepSources } from './common';
import type { StepProps } from './types';

type Verdict = 'right' | 'shown' | null;

function Reveal({
  verdict,
  tries,
  explanation,
}: {
  verdict: Verdict;
  tries: number;
  explanation: string;
}) {
  if (!verdict) return null;
  return (
    <div className="academy-reveal" data-right={verdict === 'right' ? 'true' : undefined}>
      <p className="academy-verdict">
        {verdict === 'right' ? (tries <= 1 ? 'Exactly right.' : 'Got it.') : 'Here is the answer.'}
      </p>
      <StepMarkdown text={explanation} />
    </div>
  );
}

function Nav({ props, solved }: { props: StepProps; solved: boolean }) {
  return (
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
  );
}

export function PutInOrder({ step, props }: { step: PutInOrderStep; props: StepProps }) {
  const n = step.items.length;
  const [order, setOrder] = useState(() =>
    props.answer ? step.items.map((_, i) => i) : shuffledOrder(n, props.stepKey),
  );
  const [focus, setFocus] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [tries, setTries] = useState(0);
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const [verdict, setVerdict] = useState<Verdict>(
    props.answer ? (props.answer.right ? 'right' : 'shown') : null,
  );
  const [dragging, setDragging] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const solved = verdict !== null;

  const focusItem = (i: number) => {
    setFocus(i);
    listRef.current?.querySelectorAll<HTMLElement>('.academy-order-item')[i]?.focus();
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= n || from === to) return;
    setOrder((o) => {
      const next = [...o];
      const [x] = next.splice(from, 1);
      if (x !== undefined) next.splice(to, 0, x);
      return next;
    });
    setWrong(new Set());
  };
  const check = () => {
    if (solved) return;
    const bad = new Set(order.map((v, i) => (v === i ? -1 : i)).filter((i) => i >= 0));
    const t = tries + 1;
    setTries(t);
    if (bad.size === 0) {
      setVerdict('right');
      playEffect('sparks', listRef.current);
      props.onComplete({ kind: 'answered', right: true, tries: t, usedHint: false }, true);
    } else if (t >= MAX_TRIES) {
      setOrder(step.items.map((_, i) => i));
      setVerdict('shown');
      setWrong(new Set());
      props.onComplete({ kind: 'answered', right: false, tries: t, usedHint: false }, true);
    } else {
      setWrong(bad);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    if (solved) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const to = e.key === 'ArrowDown' ? Math.min(n - 1, i + 1) : Math.max(0, i - 1);
      if (picked !== null) {
        move(i, to);
        setPicked(to);
      }
      focusItem(to);
    } else if (e.key === ' ') {
      e.preventDefault();
      setPicked(picked === null ? i : null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setPicked(null);
      check();
    }
  };

  return (
    <div
      className="academy-step-body"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          props.onEscape();
        }
      }}
    >
      <p className="academy-prompt">
        <ListOrdered aria-hidden /> <InlineCode text={step.prompt} />
      </p>
      <p className="quiz-muted" id={`${props.stepKey}-help`}>
        Drag the cards, or use ↑ ↓ to focus, Space to pick up and put down, Enter to check.
        {!solved && tries > 0 ? ` ${String(MAX_TRIES - tries)} try left.` : ''}
      </p>
      <ol
        className="academy-order"
        ref={listRef}
        aria-label="Steps to put in order"
        aria-describedby={`${props.stepKey}-help`}
      >
        {order.map((item, i) => (
          <li
            key={item}
            className={clsx('academy-order-item', {
              'academy-order-picked': picked === i,
              'academy-order-wrong': wrong.has(i),
              'academy-order-right': solved && verdict === 'right',
            })}
            data-dragging={dragging === i ? 'true' : undefined}
            tabIndex={i === focus ? 0 : -1}
            aria-label={`${String(i + 1)}. ${step.items[item] ?? ''}${picked === i ? ' (picked up)' : ''}`}
            onFocus={() => {
              setFocus(i);
            }}
            onKeyDown={(e) => {
              onKeyDown(e, i);
            }}
            onPointerDown={(e) => {
              if (solved) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(i);
            }}
            onPointerMove={(e) => {
              if (dragging === null) return;
              const el = document
                .elementFromPoint(e.clientX, e.clientY)
                ?.closest('[data-order-index]');
              const to = el ? Number(el.getAttribute('data-order-index')) : NaN;
              if (!Number.isNaN(to) && to !== dragging) {
                move(dragging, to);
                setDragging(to);
              }
            }}
            onPointerUp={() => {
              setDragging(null);
            }}
            data-order-index={i}
          >
            <GripVertical aria-hidden className="academy-order-grip" />
            <span className="academy-order-number">{i + 1}</span>
            <span>
              <InlineCode text={step.items[item] ?? ''} />
            </span>
          </li>
        ))}
      </ol>
      {!solved && (
        <div className="academy-step-actions">
          <Button variant="primary" onClick={check}>
            <Check aria-hidden /> Check
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOrder(shuffledOrder(n, `${props.stepKey}-${String(tries)}-${String(Date.now())}`));
            }}
          >
            <Shuffle aria-hidden /> Shuffle
          </Button>
        </div>
      )}
      <div aria-live="polite">
        <Reveal verdict={verdict} tries={tries} explanation={step.explanation} />
      </div>
      <StepSources sources={props.sources} status={props.sourceStatus} />
      <Nav props={props} solved={solved} />
    </div>
  );
}

const PAIR_COLORS = 6;

export function Match({ step, props }: { step: MatchStep; props: StepProps }) {
  const n = step.pairs.length;
  const rights = useMemo(() => shuffledOrder(n, `${props.stepKey}-right`), [n, props.stepKey]);
  const [pairs, setPairs] = useState<Record<number, number>>(() =>
    props.answer ? Object.fromEntries(step.pairs.map((_, i) => [i, i])) : {},
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [tries, setTries] = useState(0);
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const [verdict, setVerdict] = useState<Verdict>(
    props.answer ? (props.answer.right ? 'right' : 'shown') : null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const solved = verdict !== null;
  const colorOf = (left: number) =>
    (Object.keys(pairs).map(Number).sort().indexOf(left) % PAIR_COLORS) + 1;
  const leftOf = (right: number) => {
    const found = Object.entries(pairs).find(([, r]) => r === right);
    return found ? Number(found[0]) : null;
  };

  const pair = (right: number) => {
    if (solved || selected === null) return;
    setPairs((p) => ({
      ...withoutKeys(
        p,
        Object.entries(p)
          .filter(([, r]) => r === right)
          .map(([l]) => Number(l)),
      ),
      [selected]: right,
    }));
    setWrong(new Set());
    setSelected(null);
  };
  const unpair = (left: number) => {
    setPairs((p) => withoutKeys(p, [left]));
  };
  const check = () => {
    if (solved || Object.keys(pairs).length < n) return;
    const bad = new Set(step.pairs.map((_, i) => (pairs[i] === i ? -1 : i)).filter((i) => i >= 0));
    const t = tries + 1;
    setTries(t);
    if (bad.size === 0) {
      setVerdict('right');
      playEffect('sparks', rootRef.current?.querySelector('.academy-match'));
      props.onComplete({ kind: 'answered', right: true, tries: t, usedHint: false }, true);
    } else if (t >= MAX_TRIES) {
      setPairs(Object.fromEntries(step.pairs.map((_, i) => [i, i])));
      setVerdict('shown');
      props.onComplete({ kind: 'answered', right: false, tries: t, usedHint: false }, true);
    } else {
      setWrong(bad);
      setPairs((p) => withoutKeys(p, bad));
    }
  };
  const arrows = (e: KeyboardEvent<HTMLButtonElement>, column: string) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [
      ...(rootRef.current?.querySelectorAll<HTMLButtonElement>(`[data-column="${column}"]`) ?? []),
    ];
    const at = buttons.indexOf(e.currentTarget);
    buttons[
      e.key === 'ArrowDown' ? Math.min(buttons.length - 1, at + 1) : Math.max(0, at - 1)
    ]?.focus();
  };

  return (
    <div
      className="academy-step-body"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          props.onEscape();
        }
      }}
    >
      <p className="academy-prompt">
        <InlineCode text={step.prompt} />
      </p>
      <p className="quiz-muted">
        Select an item on the left, then its match on the right. Backspace unpairs.
        {!solved && tries > 0 ? ` ${String(MAX_TRIES - tries)} try left.` : ''}
      </p>
      <div className="academy-match">
        <ul className="academy-match-column" aria-label="Items">
          {step.pairs.map((p, i) => {
            const paired = pairs[i] !== undefined;
            return (
              <li key={p.left}>
                <button
                  type="button"
                  data-column="left"
                  className={clsx('academy-match-item', {
                    'academy-match-selected': selected === i,
                    'academy-match-wrong': wrong.has(i),
                  })}
                  data-pair={paired ? colorOf(i) : undefined}
                  aria-pressed={selected === i}
                  aria-label={`${p.left}${paired ? `, matched with ${step.pairs[pairs[i] ?? 0]?.right ?? ''}` : ''}`}
                  disabled={solved}
                  onClick={() => {
                    setSelected(selected === i ? null : i);
                  }}
                  onKeyDown={(e) => {
                    arrows(e, 'left');
                    if (e.key === 'Backspace') unpair(i);
                  }}
                >
                  {paired && <span className="academy-pair-badge">{colorOf(i)}</span>}
                  <InlineCode text={p.left} />
                </button>
              </li>
            );
          })}
        </ul>
        <ul className="academy-match-column" aria-label="Matches">
          {rights.map((r) => {
            const left = leftOf(r);
            return (
              <li key={step.pairs[r]?.right ?? r}>
                <button
                  type="button"
                  data-column="right"
                  className="academy-match-item"
                  data-pair={left === null ? undefined : colorOf(left)}
                  disabled={solved || selected === null}
                  onClick={() => {
                    pair(r);
                  }}
                  onKeyDown={(e) => {
                    arrows(e, 'right');
                    if (e.key === 'Backspace' && left !== null) unpair(left);
                  }}
                >
                  {left !== null && <span className="academy-pair-badge">{colorOf(left)}</span>}
                  <InlineCode text={step.pairs[r]?.right ?? ''} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {!solved && (
        <div className="academy-step-actions">
          <Button variant="primary" onClick={check} disabled={Object.keys(pairs).length < n}>
            <Check aria-hidden /> Check
          </Button>
        </div>
      )}
      <div aria-live="polite">
        <Reveal verdict={verdict} tries={tries} explanation={step.explanation} />
      </div>
      <StepSources sources={props.sources} status={props.sourceStatus} />
      <Nav props={props} solved={solved} />
    </div>
  );
}
