import { describe, expect, it } from 'vitest';
import type { RoleFamily, Subject } from '../../ipc/types';
import roles from '../../test/fixtures/quiz/roles.json';
import {
  kindDescription,
  kindsFor,
  rankSubjects,
  roleFamily,
  subjectPlaceholder,
} from './quizRoles';

const subject = (id: string): Subject => ({
  id,
  group: id.startsWith('feature:') ? 'feature' : 'global',
  title: id,
  focus: '',
  anchors: [],
  material: 'some',
  files: 2,
  bytes: 3000,
  hasDocs: true,
});

describe('roleFamily', () => {
  /** The same cases as `learning::role` in Rust. */
  it.each(roles as { role: string; family: RoleFamily }[])('$role is $family', (c) => {
    expect(roleFamily(c.role)).toBe(c.family);
  });
});

describe('the wizard follows the role', () => {
  it('offers a code check only to the roles that read code', () => {
    expect(kindsFor('developer')).toEqual(['global', 'feature', 'code']);
    expect(kindsFor('qa')).toEqual(['global', 'feature', 'code']);
    expect(kindsFor('general')).toEqual(['global', 'feature', 'code']);
    for (const f of ['art', 'audio', 'level', 'design', 'production', 'writing'] as const)
      expect(kindsFor(f)).toEqual(['global', 'feature']);
  });

  it('describes each kind for the role', () => {
    expect(kindDescription('global', 'developer')).toMatch(/architecture, tech stack, security/);
    expect(kindDescription('global', 'art')).toMatch(/seen from your work: .*art pipeline/);
    expect(kindDescription('feature', 'audio')).toMatch(/how your work plugs into it/);
    expect(kindDescription('code', 'qa')).toMatch(/what the tests cover/);
    expect(subjectPlaceholder('art', 'feature')).toMatch(/animations/);
    expect(subjectPlaceholder('developer', 'global')).toMatch(/threading model/);
  });

  it('ranks the subjects that fit the role first and sets aside what it never touches', () => {
    const all = [
      'concept:architecture',
      'concept:stack',
      'domain:godot',
      'concept:concurrency',
      'concept:ui',
      'feature:payments',
      'feature:player',
      'feature:animation',
      'feature:src/fishing',
    ].map(subject);
    const ids = (s: Subject[]) => s.map((x) => x.id);
    // Developers see everything, in the proposal's order.
    expect(rankSubjects(all, 'developer')).toEqual({ shown: all, more: [] });
    const art = rankSubjects(all, 'art');
    expect(ids(art.shown)).toEqual([
      'domain:godot',
      'concept:ui',
      'concept:architecture',
      'feature:animation',
      'feature:player',
      'feature:src/fishing',
    ]);
    expect(ids(art.more)).toEqual(['concept:stack', 'concept:concurrency', 'feature:payments']);
    // A producer keeps the stack, first after the architecture, and leaves concurrency aside.
    const production = rankSubjects(all, 'production');
    expect(ids(production.shown).slice(0, 2)).toEqual(['concept:architecture', 'concept:stack']);
    expect(ids(production.more)).toEqual(['concept:concurrency']);
  });
});
