// The course map: the chapters as a winding path of nodes (done, current, open, locked, not
// written yet), with a mark on chapters whose sources changed and on chapters with steps updated
// since the reader completed them. Arrow keys move between the nodes, Enter opens one. A chapter
// not written yet can be written from here (its own confirmation card).

import { BookOpen, Check, Lock, PenLine } from 'lucide-react';
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { Tutorial, TutorialProgress } from '../../ipc/types';
import { stepKey } from '../../lib/tutorial';
import { selectAcademyBusy, useAcademy } from '../../stores/academy';
import { chapterStates, stepsDone } from './academyEngine';
import type { ChapterState } from './academyEngine';

const ROW = 104;
const LEFT = 18;
const RIGHT = 82;

const STATE_LABEL: Record<ChapterState, string> = {
  done: 'done',
  current: 'current',
  open: 'started',
  locked: 'not reached yet',
  unwritten: 'not written yet',
};

export function CourseMap({
  tutorial,
  progress,
  updated,
  affected,
  editable,
  onOpen,
}: {
  tutorial: Tutorial;
  progress: TutorialProgress;
  updated: Set<string>;
  /** Chapters (indices) with a changed or missing source. */
  affected: Map<number, 'changed' | 'missing'>;
  /** A private tutorial: its unwritten chapters can be written here. */
  editable: boolean;
  onOpen: (index: number) => void;
}) {
  const states = chapterStates(tutorial, progress);
  const prepareChapter = useAcademy((s) => s.prepareChapter);
  const busy = useAcademy(selectAcademyBusy);
  const [focus, setFocus] = useState(() => Math.max(0, states.indexOf('current')));
  const rootRef = useRef<HTMLOListElement>(null);
  const n = tutorial.chapters.length;
  const x = (i: number) => (i % 2 === 0 ? LEFT : RIGHT);
  const y = (i: number) => ROW * i + ROW / 2;
  // A smooth path through the node centres (percent of the width on x, pixels on y).
  const path = tutorial.chapters
    .map((_, i) => {
      if (i === 0) return `M ${String(x(0))} ${String(y(0))}`;
      const my = (y(i - 1) + y(i)) / 2;
      return `C ${String(x(i - 1))} ${String(my)}, ${String(x(i))} ${String(my)}, ${String(x(i))} ${String(y(i))}`;
    })
    .join(' ');
  const doneUntil = states.reduce((last, s, i) => (s === 'done' ? i : last), -1);

  const move = (to: number) => {
    const i = Math.max(0, Math.min(n - 1, to));
    setFocus(i);
    rootRef.current?.querySelectorAll<HTMLElement>('.academy-node')[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      move(i + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      move(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(n - 1);
    }
  };

  return (
    <div className="academy-map" style={{ height: `${String(ROW * n)}px` }}>
      <svg
        className="academy-map-path"
        viewBox={`0 0 100 ${String(ROW * n)}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <path d={path} className="academy-map-road" vectorEffect="non-scaling-stroke" />
        {tutorial.chapters.map((_, i) => {
          if (i === 0 || i > doneUntil + 1) return null;
          const my = (y(i - 1) + y(i)) / 2;
          return (
            <path
              key={i}
              className="academy-map-walked"
              vectorEffect="non-scaling-stroke"
              d={`M ${String(x(i - 1))} ${String(y(i - 1))} C ${String(x(i - 1))} ${String(my)}, ${String(x(i))} ${String(my)}, ${String(x(i))} ${String(y(i))}`}
            />
          );
        })}
      </svg>
      <ol className="academy-map-nodes" ref={rootRef} aria-label="Chapters">
        {tutorial.chapters.map((c, i) => {
          const state = states[i] ?? 'locked';
          const done = stepsDone(c, progress);
          const changed = c.steps.some((_, k) => updated.has(stepKey(c.id, k)));
          const mark = affected.get(i);
          const canOpen = state !== 'unwritten' && state !== 'locked';
          const label = `Chapter ${String(i + 1)}: ${c.title}, ${STATE_LABEL[state]}${
            c.steps.length > 0 ? `, ${String(done)} of ${String(c.steps.length)} steps` : ''
          }${mark === 'missing' ? ', a source is missing' : mark === 'changed' ? ', a source changed' : ''}${
            changed ? ', updated since you read it' : ''
          }`;
          return (
            <li
              key={c.id}
              className="academy-map-item"
              data-side={i % 2 === 0 ? 'left' : 'right'}
              style={{ top: `${String(y(i))}px` }}
            >
              <button
                type="button"
                className="academy-node"
                data-state={state}
                tabIndex={i === focus ? 0 : -1}
                aria-label={label}
                aria-disabled={!canOpen}
                onFocus={() => {
                  setFocus(i);
                }}
                onKeyDown={(e) => {
                  onKeyDown(e, i);
                }}
                onClick={() => {
                  if (canOpen) onOpen(i);
                }}
              >
                {state === 'done' ? (
                  <Check aria-hidden />
                ) : state === 'unwritten' ? (
                  <PenLine aria-hidden />
                ) : state === 'locked' ? (
                  <Lock aria-hidden />
                ) : (
                  <BookOpen aria-hidden />
                )}
                {mark && <span className="academy-node-mark" data-mark={mark} aria-hidden />}
              </button>
              <div className="academy-node-text">
                <span className="academy-node-title">
                  {i + 1}. {c.title}
                </span>
                <span className="quiz-muted">
                  {c.steps.length > 0
                    ? `${String(done)} of ${String(c.steps.length)} steps · ${String(c.minutes)} min`
                    : 'Not written yet'}
                  {changed && <span className="academy-tag academy-tag-warn">updated</span>}
                </span>
                {state === 'unwritten' && editable && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void prepareChapter(tutorial.id, i)}
                  >
                    <PenLine aria-hidden /> Write it <AiMark />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
