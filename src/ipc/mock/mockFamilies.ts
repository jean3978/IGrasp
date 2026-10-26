// The Academy's subject cards of the fixture, in the shape the Rust `learning::tutorial::families`
// module gives: universal families first, then the domain cards of a CLI and library, each
// phrased about the project with anchor files of the fake disk. Hand-written (the fixture is
// small), like `mockSubjects.ts`; anchors that are not on the disk are dropped like Rust drops
// them, and a card left with neither anchors nor picks is not offered.

import type { TutorialSubject, TutorialSubjects } from '../types';

const BIG_PICTURE_FOCUS =
  'The Big Picture: what this project does, its main parts and how they fit, in about five minutes. Stay at the level of folders, modules and entry points; one chapter per main part at most.';

const CARDS: TutorialSubject[] = [
  {
    id: 'family:big-picture',
    kind: 'universal',
    family: 'The Big Picture',
    title: 'How igrasp-demo fits together, in 5 minutes',
    blurb: 'What igrasp-demo does and its main parts, from `README.md` and `architecture.md`',
    focus: BIG_PICTURE_FOCUS,
    anchors: ['README.md', 'docs/architecture.md', 'package.json', 'src/main.ts'],
    material: 'some',
    picks: [],
    domain: null,
  },
  {
    id: 'family:stack',
    kind: 'universal',
    family: 'Tech Stack, as used here',
    title: "igrasp-demo's tech stack, as used here",
    blurb: 'Why igrasp-demo uses TypeScript and where, from `package.json` and `main.ts`',
    focus:
      'Tech Stack, as used here: each language, engine, framework and tool this project uses, why it is there, where in the code it is wired and configured, and what this project does on top of it. Never a generic introduction to a technology.',
    anchors: ['package.json', 'src/main.ts'],
    material: 'some',
    picks: [],
    domain: null,
  },
  {
    id: 'family:deep-dive',
    kind: 'universal',
    family: 'Feature Deep Dive',
    title: 'Deep dive into one feature of igrasp-demo',
    blurb: 'End to end: greeting, getting started…',
    focus:
      'Feature Deep Dive: pick the feature named below and follow it end to end through this project: the entry point, the parts involved, the data, the edge cases and the tests.',
    anchors: [],
    material: 'some',
    picks: [
      { id: 'feature:greeting', title: 'Greeting', anchors: ['src/main.ts', 'README.md'] },
      {
        id: 'feature:docs/guide/getting-started.md',
        title: 'Getting started',
        anchors: ['docs/guide/getting-started.md', 'Makefile'],
      },
    ],
    domain: null,
  },
  {
    id: 'family:trace-it',
    kind: 'universal',
    family: 'Trace It',
    title: 'Trace one action through igrasp-demo',
    blurb: 'Step by step: A command runs from the terminal or Using greeting',
    focus:
      "Trace It: follow the one action named below through this project's code, step by step, from its trigger to its visible result, naming each file and function it passes through.",
    anchors: [],
    material: 'some',
    picks: [
      {
        id: 'action:command',
        title: 'A command runs from the terminal',
        anchors: ['src/main.ts', 'package.json'],
      },
      { id: 'use:feature:greeting', title: 'Using greeting', anchors: ['src/main.ts'] },
    ],
    domain: null,
  },
  {
    id: 'family:build',
    kind: 'universal',
    family: 'Build, Run, Test, Ship',
    title: 'How igrasp-demo is built, tested and shipped',
    blurb: 'The scripts, checks and release of igrasp-demo, from `ci.yml` and `Makefile`',
    focus:
      "Build, Run, Test, Ship: this project's scripts, build configurations, test suites, CI workflows, packaging, platforms and release process, as its files define them.",
    anchors: ['.github/workflows/ci.yml', 'Makefile', 'package.json', 'scripts/deploy.sh'],
    material: 'some',
    picks: [],
    domain: null,
  },
  {
    id: 'family:project-story',
    kind: 'universal',
    family: 'Project Story',
    title: 'The story of igrasp-demo so far',
    blurb:
      'How igrasp-demo evolved, from its changelog and decisions, from `CHANGELOG.md` and `0001-use-git-cli.md`',
    focus:
      'Project Story: how this project evolved, from its changelog, release notes and dated decisions: the phases, the turning points and what each one added (the commit history is not available).',
    anchors: ['CHANGELOG.md', 'docs/decisions/0001-use-git-cli.md'],
    material: 'some',
    picks: [],
    domain: null,
  },
  {
    id: 'domain:software:commands',
    kind: 'domain',
    family: 'Libraries, CLIs and desktop apps',
    title: "igrasp-demo's command structure",
    blurb:
      "How igrasp-demo's commands are declared, parsed and dispatched to their code, from `main.ts` and `Makefile`",
    focus: "how igrasp-demo's commands are declared, parsed and dispatched to their code",
    anchors: ['src/main.ts', 'Makefile'],
    material: 'some',
    picks: [],
    domain: 'command-line interfaces',
  },
];

const DOMAINS = ['command-line interfaces', 'TypeScript'];

/** The cards of the fixture on `files`, then the AI's suggestions kept for the folder. */
export function fixtureTutorialSubjects(
  files: Map<string, string>,
  suggested: TutorialSubject[] = [],
): TutorialSubjects {
  const textFiles = [...files.keys()].filter((p) => !p.startsWith('node_modules/'));
  if (textFiles.length < 2) return { cards: [], domains: [], tooThin: true };
  const cards = CARDS.map((c) => ({
    ...c,
    anchors: c.anchors.filter((a) => files.has(a)),
    picks: c.picks
      .map((p) => ({ ...p, anchors: p.anchors.filter((a) => files.has(a)) }))
      .filter((p) => p.anchors.length > 0),
  })).filter((c) => c.anchors.length > 0 || c.picks.length > 0);
  return {
    cards: [...cards, ...structuredClone(suggested)],
    domains: [...DOMAINS],
    tooThin: false,
  };
}
