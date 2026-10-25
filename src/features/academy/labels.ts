// The words the Academy shows for the tutorial options.

import type { Familiarity, Length } from '../../ipc/types';

export const FAMILIARITY_LABEL: Record<Familiarity, string> = {
  newHere: 'New here',
  contributing: 'Already contributing',
  maintainer: 'Deep dive for maintainers',
};

export const FAMILIARITY_HINT: Record<Familiarity, string> = {
  newHere: 'An onboarding: what the project is, its parts and places, then the details.',
  contributing: 'Skips the README: how things are done here, where a change goes, the traps.',
  maintainer: 'Invariants, trade-offs, failure modes and what the decisions cost.',
};

export const LENGTH_LABEL: Record<Length, { name: string; detail: string }> = {
  quick: { name: 'Quick', detail: '~5 min · 2–3 chapters' },
  standard: { name: 'Standard', detail: '~15 min · 3–5 chapters' },
  deep: { name: 'Deep', detail: '~30 min · 5–8 chapters' },
};

export const FAMILIARITIES: Familiarity[] = ['newHere', 'contributing', 'maintainer'];
export const LENGTHS: Length[] = ['quick', 'standard', 'deep'];
