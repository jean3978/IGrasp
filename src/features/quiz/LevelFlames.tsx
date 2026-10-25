// The level indicator: five flames, the lit ones are the level. A change animates the flame that
// lights up or dims.

import { clsx } from 'clsx';
import { Flame } from 'lucide-react';
import { MAX_LEVEL } from './quizEngine';

export function LevelFlames({
  level,
  label = 'Level',
  small = false,
}: {
  level: number;
  label?: string;
  small?: boolean;
}) {
  return (
    <span
      className={clsx('quiz-flames', { 'quiz-flames-small': small })}
      role="img"
      aria-label={`${label} ${String(level)} of ${String(MAX_LEVEL)}`}
      title={`${label} ${String(level)} of ${String(MAX_LEVEL)}`}
    >
      {Array.from({ length: MAX_LEVEL }, (_, i) => (
        <Flame
          key={i}
          aria-hidden
          className={clsx('quiz-flame', { 'quiz-flame-lit': i < level })}
          data-lit={i < level ? '' : undefined}
        />
      ))}
    </span>
  );
}
