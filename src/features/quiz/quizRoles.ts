// The roles the wizard proposes, from the kinds of project the profile detected: a game team has
// artists and level designers, a web product has product managers and UX designers. The player
// can also type their own role; it becomes the audience of the quiz's prompt.
//
// A role is read as a family of crafts (`roleFamily`, the same rules as Rust's
// `learning::role::family`, checked on `src/test/fixtures/quiz/roles.json`). The family decides
// the next steps of the wizard: the kinds of quiz offered (no code check for an artist), how
// each is described, and which subjects come first or wait behind "More subjects".

import type {
  ProjectKind,
  ProjectProfile,
  QuizCategory,
  RoleFamily,
  Subject,
  SubjectGroup,
} from '../../ipc/types';

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

/**
 * The family of a role, by its words. The order matters: a QA engineer is QA, a lead artist is
 * an artist, a tech lead is a developer, an engineering manager is production. Kept identical
 * to `learning::role::family` in Rust.
 */
export function roleFamily(role: string): RoleFamily {
  const r = role.toLowerCase();
  const words = r.split(/[^\p{L}\p{N}]+/u);
  const has = (stems: string[]) => stems.some((s) => r.includes(s));
  const word = (ws: string[]) => ws.some((w) => words.includes(w));
  if (word(['qa']) || has(['test', 'quality'])) return 'qa';
  if (has(['writer', 'narrative', 'documentation'])) return 'writing';
  if (has(['artist', 'animator', 'modeler', 'modeller', 'illustrat']) || word(['vfx']))
    return 'art';
  if (has(['sound', 'audio', 'music', 'composer'])) return 'audio';
  if (has(['level design', 'level build', 'world build'])) return 'level';
  if (has(['produc', 'manager', 'director', 'owner', 'scrum']) || word(['pm', 'po']))
    return 'production';
  if (
    has([
      'develop',
      'program',
      'engineer',
      'coder',
      'contributor',
      'maintainer',
      'devops',
      'architect',
      'tech lead',
      'scientist',
    ]) ||
    word(['sre'])
  )
    return 'developer';
  if (has(['design']) || word(['ux', 'ui'])) return 'design';
  if (has(['lead'])) return 'production';
  return 'general';
}

/** Whether the family reads code closely enough for a line-level code check. */
export function checksCode(family: RoleFamily): boolean {
  return family === 'developer' || family === 'qa' || family === 'general';
}

/** The kinds of quiz offered to a family, in order. */
/** The kinds of quiz the wizard offers (a quiz on a tutorial starts from the Academy). */
export type WizardKind = Exclude<QuizCategory, 'tutorial'>;

export function kindsFor(family: RoleFamily): WizardKind[] {
  return checksCode(family) ? ['global', 'feature', 'code'] : ['global', 'feature'];
}

const SEEN_FROM_YOUR_WORK: Partial<Record<RoleFamily, string>> = {
  art: "the engine's scenes and assets, the art pipeline and its conventions, the structure around them",
  audio: 'where sound lives, how it is triggered and mixed, the structure around it',
  level: 'how scenes and levels are built and loaded, the tools and the values levels rely on',
  design: 'the screens and their flow, the rules and the values that tune them',
  writing: 'where texts and documentation live, their conventions, the decisions behind them',
};

/** What a kind of quiz means for a family, under its title. */
export function kindDescription(kind: WizardKind, family: RoleFamily): string {
  const seen = SEEN_FROM_YOUR_WORK[family];
  switch (kind) {
    case 'global':
      if (seen) return `How the project is made, seen from your work: ${seen}…`;
      if (family === 'production')
        return 'How the project is made and shipped: its parts, stack, decisions, build, tests and risks…';
      if (family === 'qa')
        return 'How the project is made and checked across its parts: architecture, tests, error handling, risky areas…';
      return 'How the project is made across its parts: architecture, tech stack, security, patterns…';
    case 'feature':
      if (seen) return 'One thing the project does, end to end, and how your work plugs into it.';
      if (family === 'production')
        return 'One thing the project does, end to end: its parts, what it depends on, its risks.';
      if (family === 'qa')
        return 'One thing the project does, end to end: its behaviour, edge cases and tests.';
      return 'One thing the project does, end to end: a feature or a game system.';
    case 'code':
      if (family === 'qa')
        return 'Detailed questions on files or folders you pick: their behaviour, edge cases and what the tests cover.';
      return 'Detailed, line-level questions on files or folders you pick, e.g. before submitting.';
  }
}

const ENGINES = ['domain:godot', 'domain:unity', 'domain:unreal'];
/** Concepts about the inside of the code: for the people who write it. */
const CODE_INTERNALS = [
  'concept:stack',
  'concept:security',
  'concept:data',
  'concept:state',
  'concept:patterns',
  'concept:errors',
  'concept:concurrency',
  'concept:networking',
  'concept:config',
  'concept:logging',
  'concept:testing',
  'concept:build',
  'domain:bevy',
  'domain:ipc',
  'domain:api',
];
/** Features of an application's plumbing that a game's crafts rarely touch. */
const PLUMBING = [
  'feature:payments',
  'feature:uploads',
  'feature:analytics',
  'feature:search',
  'feature:history',
  'feature:diff',
  'feature:export',
  'feature:notifications',
  'feature:saving',
  'feature:chat',
  'feature:editor',
];

interface Fit {
  /** Shown first, in this order. */
  prefer: string[];
  /** Behind "More subjects". */
  hide: string[];
}

const FITS: Partial<Record<RoleFamily, Fit>> = {
  qa: {
    prefer: [
      'concept:testing',
      'concept:errors',
      'concept:build',
      'concept:architecture',
      'concept:security',
      'concept:config',
    ],
    hide: ['concept:patterns', 'concept:state', 'concept:concurrency', 'domain:bevy'],
  },
  art: {
    prefer: [
      ...ENGINES,
      'concept:ui',
      'concept:architecture',
      'feature:animation',
      'feature:player',
      'feature:enemies',
      'feature:npc',
      'feature:levels',
      'feature:camera',
      'feature:themes',
      'feature:preview',
    ],
    hide: [...CODE_INTERNALS, ...PLUMBING],
  },
  audio: {
    prefer: [
      'feature:audio',
      ...ENGINES,
      'concept:architecture',
      'feature:combat',
      'feature:player',
      'feature:enemies',
      'feature:levels',
      'concept:ui',
    ],
    hide: [...CODE_INTERNALS, ...PLUMBING],
  },
  level: {
    prefer: [
      'feature:levels',
      'feature:spawning',
      ...ENGINES,
      'feature:camera',
      'feature:player',
      'feature:enemies',
      'feature:npc',
      'feature:physics',
      'feature:quests',
      'feature:inventory',
      'concept:config',
      'concept:architecture',
    ],
    hide: [...CODE_INTERNALS.filter((id) => id !== 'concept:config'), ...PLUMBING],
  },
  design: {
    prefer: [
      'concept:ui',
      'concept:config',
      ...ENGINES,
      'concept:architecture',
      'feature:player',
      'feature:combat',
      'feature:inventory',
      'feature:quests',
      'feature:input',
      'feature:onboarding',
      'feature:themes',
      'feature:notifications',
      'feature:search',
    ],
    hide: CODE_INTERNALS.filter((id) => id !== 'concept:config'),
  },
  production: {
    prefer: [
      'concept:architecture',
      'concept:stack',
      'concept:decisions',
      'concept:build',
      'concept:testing',
      'concept:security',
    ],
    hide: [
      'concept:patterns',
      'concept:state',
      'concept:concurrency',
      'concept:errors',
      'concept:logging',
      'domain:bevy',
    ],
  },
  writing: {
    prefer: [
      'feature:dialogue',
      'feature:quests',
      'feature:localization',
      'feature:onboarding',
      'concept:decisions',
      'concept:architecture',
      'concept:ui',
    ],
    hide: [...CODE_INTERNALS, ...PLUMBING],
  },
};

/**
 * The subjects for a family: the ones that fit its work first, then the others, and those about
 * what it never touches apart (`more`, shown on request). Developers see everything as proposed.
 */
export function rankSubjects(
  subjects: Subject[],
  family: RoleFamily,
): { shown: Subject[]; more: Subject[] } {
  const fit = FITS[family];
  if (!fit) return { shown: subjects, more: [] };
  const rank = (s: Subject) => {
    const i = fit.prefer.indexOf(s.id);
    return i < 0 ? fit.prefer.length : i;
  };
  const kept = subjects.filter((s) => !fit.hide.includes(s.id));
  // A stable sort: the subjects that do not fit better keep the proposal's order.
  const shown = [...kept].sort((a, b) => rank(a) - rank(b));
  return { shown, more: subjects.filter((s) => fit.hide.includes(s.id)) };
}

const PLACEHOLDERS: Partial<Record<RoleFamily, Record<SubjectGroup, string>>> = {
  qa: { global: 'e.g. error handling, test coverage', feature: 'e.g. saving, the login flow' },
  art: {
    global: 'e.g. sprite naming, the art pipeline, shaders',
    feature: 'e.g. the player animations, the boss fight',
  },
  audio: {
    global: 'e.g. the audio buses, how music changes',
    feature: 'e.g. footsteps, the menu sounds',
  },
  level: {
    global: 'e.g. tilemaps, how a level is loaded',
    feature: 'e.g. checkpoints, the cave level',
  },
  design: {
    global: 'e.g. the difficulty curve, the navigation flow',
    feature: 'e.g. the shop, onboarding',
  },
  production: {
    global: 'e.g. the release process, technical risks',
    feature: 'e.g. the checkout, the save system',
  },
  writing: {
    global: 'e.g. localization, the documentation conventions',
    feature: 'e.g. the dialogues, the tutorial',
  },
};

const DEFAULT_PLACEHOLDERS: Record<SubjectGroup, string> = {
  global: 'e.g. rendering pipeline, threading model, localization',
  feature: 'e.g. fishing, the shop, matchmaking, exporting to PDF',
};

/** The example in the "Something else" field, for the family and the kind of quiz. */
export function subjectPlaceholder(family: RoleFamily, group: SubjectGroup): string {
  return (PLACEHOLDERS[family] ?? DEFAULT_PLACEHOLDERS)[group];
}
