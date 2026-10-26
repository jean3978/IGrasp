// The subject cards of "New tutorial" ranked for the role chosen first.

import { describe, expect, it } from 'vitest';
import type { TutorialSubject } from '../../ipc/types';
import { rankTutorialSubjects } from './tutorialRoles';

const card = (id: string, kind: TutorialSubject['kind'] = 'universal'): TutorialSubject => ({
  id,
  kind,
  family: kind === 'universal' ? id : 'Game',
  title: id,
  blurb: '',
  focus: '',
  anchors: [],
  material: 'some',
  picks: [],
  domain: null,
});

const CARDS = [
  card('family:big-picture'),
  card('family:stack'),
  card('family:trace-it'),
  card('family:glossary'),
  card('domain:game:assets', 'domain'),
  card('domain:game:levels', 'domain'),
  card('domain:game:ui', 'domain'),
  card('domain:web:api', 'domain'),
  card('suggested:1', 'suggested'),
];
const ids = (cards: TutorialSubject[]) => cards.map((c) => c.id);

describe('rankTutorialSubjects', () => {
  it('shows a developer every card as proposed', () => {
    for (const family of ['developer', 'general'] as const) {
      expect(rankTutorialSubjects(CARDS, family)).toEqual({ forRole: [], rest: CARDS, more: [] });
    }
  });

  it('puts what fits a level designer first, in the fit order, and code internals behind More', () => {
    const r = rankTutorialSubjects(CARDS, 'level');
    expect(ids(r.forRole)).toEqual([
      'domain:game:levels',
      'domain:game:assets',
      'family:big-picture',
      'family:glossary',
    ]);
    expect(ids(r.more)).toEqual(['family:stack', 'family:trace-it', 'domain:web:api']);
    expect(ids(r.rest)).toEqual(['domain:game:ui', 'suggested:1']);
  });

  it('matches one segment with a star, and never hides a suggestion', () => {
    const design = rankTutorialSubjects(CARDS, 'design');
    expect(ids(design.forRole)).toContain('domain:game:ui');
    const art = rankTutorialSubjects(CARDS, 'art');
    expect(ids(art.more)).toContain('domain:web:api');
    expect(ids([...art.forRole, ...art.rest])).toContain('suggested:1');
  });
});
