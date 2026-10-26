// The subject cards of "New tutorial" for the reader's role, chosen first. A role is read as a
// family of crafts (`roleFamily`, shared with the quiz); the family decides which cards come
// first ("For a level designer") and which wait behind "More subjects" because they are about
// what that craft never touches (the dependency list for an artist). Developers, and roles that
// read as no family, see every card as the profile proposed them. Suggestions are never hidden.
// The AI's suggestions are written for one role (`forRole`): `suggestedFor` keeps this role's.

import type { RoleFamily, TutorialSubject } from '../../ipc/types';
import { roleFamily } from '../quiz/quizRoles';

interface Fit {
  /** Shown first, in this order. `*` matches one id segment: `domain:*:ui`. */
  prefer: string[];
  /** Behind "More subjects". */
  hide: string[];
}

/** The universal cards about the inside of the code: for the people who write it. */
const CODE_FAMILIES = ['family:stack', 'family:dependencies', 'family:trace-it', 'family:build'];
/** Domains a game's or a product's crafts rarely open. */
const BACKEND_DOMAINS = ['domain:service:*', 'domain:data:*'];

const FITS: Partial<Record<RoleFamily, Fit>> = {
  qa: {
    prefer: [
      'family:build',
      'family:trace-it',
      'family:deep-dive',
      'family:big-picture',
      'family:architecture',
      'domain:*:security',
    ],
    hide: [],
  },
  art: {
    prefer: [
      'family:big-picture',
      'domain:game:assets',
      'domain:game:rendering',
      'domain:game:levels',
      'domain:game:player',
      'domain:*:ui',
      'family:conventions',
      'family:glossary',
    ],
    hide: [...CODE_FAMILIES, ...BACKEND_DOMAINS, 'domain:web:*', 'domain:game:networking'],
  },
  audio: {
    prefer: [
      'domain:game:audio',
      'family:big-picture',
      'domain:game:assets',
      'family:conventions',
      'family:glossary',
    ],
    hide: [...CODE_FAMILIES, ...BACKEND_DOMAINS, 'domain:web:*', 'domain:game:networking'],
  },
  level: {
    prefer: [
      'domain:game:levels',
      'domain:game:assets',
      'domain:game:player',
      'domain:game:physics',
      'domain:game:ai',
      'family:big-picture',
      'family:glossary',
    ],
    hide: [...CODE_FAMILIES, ...BACKEND_DOMAINS, 'domain:web:*', 'domain:game:networking'],
  },
  design: {
    prefer: [
      'family:big-picture',
      'family:deep-dive',
      'domain:*:ui',
      'domain:web:routing',
      'domain:mobile:navigation',
      'domain:game:player',
      'domain:game:input',
      'family:glossary',
    ],
    hide: [
      ...CODE_FAMILIES,
      ...BACKEND_DOMAINS,
      'domain:web:caching',
      'domain:web:jobs',
      'domain:web:observability',
      'domain:web:deployment',
    ],
  },
  production: {
    prefer: [
      'family:big-picture',
      'family:project-story',
      'family:decisions',
      'family:architecture',
      'family:stack',
      'family:build',
      'family:dependencies',
      'family:glossary',
    ],
    hide: ['family:trace-it', 'family:conventions'],
  },
  writing: {
    prefer: [
      'family:glossary',
      'family:big-picture',
      'family:project-story',
      'family:decisions',
      'family:conventions',
    ],
    hide: [...CODE_FAMILIES, ...BACKEND_DOMAINS],
  },
};

/**
 * The suggested cards written for this role: the same role (whatever its case), or another of
 * the same family (a Level builder's suggestions serve a Level designer). Suggestions made before
 * roles were for developers. A role of no family only matches itself.
 */
export function suggestedFor(cards: TutorialSubject[], role: string): TutorialSubject[] {
  const mine = role.trim().toLowerCase();
  const family = roleFamily(role);
  return cards.filter((c) => {
    if (c.kind !== 'suggested') return false;
    const theirs = c.forRole ?? 'Developer';
    if (theirs.trim().toLowerCase() === mine) return true;
    return family !== 'general' && roleFamily(theirs) === family;
  });
}

/** Whether an id matches a pattern whose `*` stands for one segment. */
function matches(pattern: string, id: string): boolean {
  if (!pattern.includes('*')) return pattern === id;
  const p = pattern.split(':');
  const i = id.split(':');
  return p.length <= i.length && p.every((part, n) => part === '*' || part === i[n]);
}

const indexIn = (patterns: string[], id: string) => patterns.findIndex((p) => matches(p, id));

/**
 * The cards for a family: `forRole` (those that fit its work, in the fit's order), `rest` (the
 * others, in the profile's order) and `more` (shown on request).
 */
export function rankTutorialSubjects(
  cards: TutorialSubject[],
  family: RoleFamily,
): { forRole: TutorialSubject[]; rest: TutorialSubject[]; more: TutorialSubject[] } {
  const fit = FITS[family];
  if (!fit) return { forRole: [], rest: cards, more: [] };
  const forRole: TutorialSubject[] = [];
  const rest: TutorialSubject[] = [];
  const more: TutorialSubject[] = [];
  for (const c of cards) {
    if (c.kind === 'suggested') rest.push(c);
    else if (indexIn(fit.prefer, c.id) >= 0) forRole.push(c);
    else if (indexIn(fit.hide, c.id) >= 0) more.push(c);
    else rest.push(c);
  }
  // A stable sort: cards matching the same pattern keep the profile's order.
  forRole.sort((a, b) => indexIn(fit.prefer, a.id) - indexIn(fit.prefer, b.id));
  return { forRole, rest, more };
}
