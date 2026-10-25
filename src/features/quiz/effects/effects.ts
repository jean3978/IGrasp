// Effect triggers: the screens name an effect and the element it starts from; the canvas (when
// mounted, i.e. effects on and no reduced motion) plays it.

export type EffectKind = 'confetti' | 'sparks' | 'ring';

type Listener = (kind: EffectKind, x: number, y: number) => void;

const listeners = new Set<Listener>();

/** Plays `kind` from the centre of `at` (viewport coordinates); nothing without a canvas. */
export function playEffect(kind: EffectKind, at: Element | null | undefined): void {
  if (!at || listeners.size === 0) return;
  const r = at.getBoundingClientRect();
  for (const l of listeners) l(kind, r.left + r.width / 2, r.top + r.height / 2);
}

export function onEffect(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the system asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
