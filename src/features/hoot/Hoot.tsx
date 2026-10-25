// Hoot, the quiz's owl (ADR 0023): an original SVG, animated with CSS by state (`data-state`
// on the root) and themed with the `--hoot-*` tokens. No `id` inside the SVG, so several Hoots
// can share a page. Under reduced motion (the system setting, or `motion={false}`), every state
// keeps a still pose. Idle Hoot blinks now and then; the speech bubble shows a local line.

import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import './hoot.css';

export type HootState = 'idle' | 'thinking' | 'cheering' | 'explaining' | 'encouraging';

export interface HootProps {
  state?: HootState;
  /** Width in CSS pixels (40 in the status bar, 96 on a card, 160 on the home). */
  size?: number;
  /** The accessible name of the picture. */
  label?: string;
  /** A short line in a speech bubble next to Hoot. */
  line?: string | null;
  /** Read the line to screen readers (only for changes the user caused). */
  announce?: boolean;
  /** False keeps Hoot still (the quiz effects are off). */
  motion?: boolean;
  /** The eyes follow the pointer (the Look it up window); they look down until it moves. */
  followPointer?: boolean;
  className?: string;
}

/** How far the pupils move from the centre of the eyes, in viewBox units. */
const MAX_GAZE = 4.5;

/** The delay before the next blink: 4 to 6 seconds. */
const blinkDelay = () => 4000 + Math.random() * 2000;

export function Hoot({
  state = 'idle',
  size = 96,
  label = 'Hoot the owl',
  line = null,
  announce = false,
  motion = true,
  followPointer = false,
  className,
}: HootProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gazeRef = useRef<SVGGElement>(null);
  useEffect(() => {
    const gaze = gazeRef.current;
    if (!followPointer || !motion || !gaze) return;
    // Looking down at the file below until the pointer moves.
    gaze.style.transform = `translate(0px, ${String(MAX_GAZE * 0.8)}px)`;
    const onMove = (e: PointerEvent) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      // From the point between the eyes (60, 58 in the 120 x 140 viewBox).
      const dx = e.clientX - (r.left + (r.width * 60) / 120);
      const dy = e.clientY - (r.top + (r.height * 58) / 140);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 120) * MAX_GAZE;
      gaze.style.transform = `translate(${(dx / d) * k}px, ${(dy / d) * k}px)`;
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      gaze.style.removeProperty('transform');
    };
  }, [followPointer, motion]);
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (state !== 'idle' || !motion) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        // Sometimes two quick blinks.
        const twice = Math.random() < 0.25;
        timer = setTimeout(() => {
          setBlink(false);
          if (twice) {
            timer = setTimeout(() => {
              setBlink(true);
              timer = setTimeout(() => {
                setBlink(false);
                schedule();
              }, 140);
            }, 160);
          } else {
            schedule();
          }
        }, 140);
      }, blinkDelay());
    };
    schedule();
    return () => {
      clearTimeout(timer);
      setBlink(false);
    };
  }, [state, motion]);

  return (
    <div
      className={clsx('hoot', className, { 'hoot-still': !motion })}
      data-state={state}
      data-blink={blink ? '' : undefined}
      data-follow={followPointer && motion ? '' : undefined}
    >
      <svg
        ref={svgRef}
        className="hoot-svg"
        viewBox="0 0 120 140"
        width={size}
        height={(size * 140) / 120}
        role="img"
        aria-label={label}
      >
        <g className="hoot-figure">
          {/* The branch Hoot stands on (also the card's baseline). */}
          <rect className="hoot-branch" x="14" y="128" width="92" height="7" rx="3.5" />
          <g className="hoot-feet">
            <ellipse cx="48" cy="127" rx="7" ry="3.5" />
            <ellipse cx="72" cy="127" rx="7" ry="3.5" />
          </g>
          <g className="hoot-body">
            <path
              className="hoot-feather"
              d="M60 26 C 88 26, 100 46, 100 74 C 100 106, 84 126, 60 126 C 36 126, 20 106, 20 74 C 20 46, 32 26, 60 26 Z"
            />
            <ellipse className="hoot-belly" cx="60" cy="96" rx="26" ry="27" />
            <path
              className="hoot-scallop"
              d="M44 92 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0 M48 104 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0 M52 115 q 4 4 8 0 q 4 4 8 0"
            />
          </g>
          {/* The wings, in front of the body so a raised wing shows over the face. */}
          <g className="hoot-wing-left">
            <path d="M28 70 C 12 82, 12 108, 26 118 C 30 104, 33 88, 34 74 Z" />
          </g>
          <g className="hoot-wing-right">
            <path d="M92 70 C 108 82, 108 108, 94 118 C 90 104, 87 88, 86 74 Z" />
          </g>
          <g className="hoot-head">
            <g className="hoot-brows">
              <path className="hoot-tuft hoot-tuft-left" d="M32 40 L 26 16 L 48 32 Z" />
              <path className="hoot-tuft hoot-tuft-right" d="M88 40 L 94 16 L 72 32 Z" />
            </g>
            <g className="hoot-blush">
              <ellipse cx="33" cy="74" rx="6" ry="3.5" />
              <ellipse cx="87" cy="74" rx="6" ry="3.5" />
            </g>
            <g className="hoot-eyes">
              <circle className="hoot-eye-white" cx="44" cy="58" r="13" />
              <circle className="hoot-eye-white" cx="76" cy="58" r="13" />
              <g className="hoot-gaze" ref={gazeRef}>
                <g className="hoot-pupils">
                  <circle className="hoot-pupil" cx="45" cy="59" r="6" />
                  <circle className="hoot-pupil" cx="75" cy="59" r="6" />
                  <circle className="hoot-catchlight" cx="47" cy="56.5" r="1.8" />
                  <circle className="hoot-catchlight" cx="77" cy="56.5" r="1.8" />
                </g>
              </g>
              <path className="hoot-happy" d="M36 60 q 8 -9 16 0 M68 60 q 8 -9 16 0" />
            </g>
            <g className="hoot-glasses">
              <circle className="hoot-lens" cx="44" cy="58" r="16" />
              <circle className="hoot-lens" cx="76" cy="58" r="16" />
              <path className="hoot-bridge" d="M58 56 q 2 -3 4 0" />
              <path className="hoot-glint" d="M33 50 l 6 -5 M65 50 l 6 -5" />
            </g>
            <path className="hoot-beak" d="M54 71 L 66 71 L 60 81 Z" />
            <path className="hoot-smile" d="M53 84 q 7 5 14 0" />
          </g>
          {/* Explaining: the right wing raised to the glasses, in front of the face. */}
          <g className="hoot-wing-raised">
            <path d="M93 104 C 104 90, 100 74, 87 66 C 82 72, 82 84, 85 98 Z" />
          </g>
          <g className="hoot-thought">
            <circle cx="102" cy="30" r="3" />
            <circle cx="108" cy="20" r="4" />
            <circle cx="114" cy="8" r="5" />
          </g>
        </g>
      </svg>
      {line && (
        <p
          className="hoot-bubble"
          aria-live={announce ? 'polite' : undefined}
          aria-hidden={announce ? undefined : true}
        >
          {line}
        </p>
      )}
    </div>
  );
}
