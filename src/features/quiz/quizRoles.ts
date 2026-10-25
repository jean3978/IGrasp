// The roles the wizard proposes, from the kinds of project the profile detected: a game team has
// artists and level designers, a web product has product managers and UX designers. The player
// can also type their own role; it becomes the audience of the quiz's prompt.

import type { ProjectKind, ProjectProfile } from '../../ipc/types';

const BY_KIND: Partial<Record<ProjectKind, string[]>> = {
  game: [
    'Gameplay programmer',
    'Game designer',
    'Level designer',
    'Artist',
    'Technical artist',
    'Sound designer',
    'Producer',
    'QA tester',
  ],
  webFrontend: ['Frontend developer', 'UX/UI designer', 'Product manager', 'QA engineer'],
  webBackend: ['Backend developer', 'DevOps engineer', 'Product manager', 'QA engineer'],
  service: ['Backend developer', 'DevOps engineer', 'Product manager'],
  mobile: ['Mobile developer', 'UX/UI designer', 'Product manager', 'QA engineer'],
  desktop: ['Developer', 'UX/UI designer', 'Product manager', 'QA engineer'],
  library: ['Contributor', 'Maintainer', 'Developer using the library'],
  cli: ['Contributor', 'Maintainer', 'User of the tool'],
  dataMl: ['Data scientist', 'ML engineer', 'Data engineer'],
  infrastructure: ['DevOps engineer', 'Site reliability engineer', 'Platform engineer'],
  embedded: ['Firmware developer', 'Hardware engineer', 'QA engineer'],
  documentation: ['Technical writer', 'Contributor'],
};

/** At most this many proposed roles. */
const MAX_ROLES = 8;

/** The proposed roles for the project, the most specific first; "Developer" when nothing fits. */
export function rolesFor(profile: ProjectProfile | null): string[] {
  const roles: string[] = [];
  for (const k of profile?.kinds ?? []) {
    for (const r of BY_KIND[k.value] ?? []) if (!roles.includes(r)) roles.push(r);
  }
  if (roles.length === 0) roles.push('Developer', 'Tech lead', 'New team member');
  else if (!roles.some((r) => /developer|programmer|engineer|contributor/i.test(r)))
    roles.unshift('Developer');
  return roles.slice(0, MAX_ROLES);
}
