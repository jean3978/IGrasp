// Subject proposals of the fixture, in the shape the Rust `learning::subjects` module gives:
// global concepts and features with human titles (never paths), anchor files that exist on the
// fake disk and a measure of the material. Hand-written (the fixture is small); anchors that are
// not on the disk are dropped like Rust drops them.

import type { Subject } from '../types';

const SUBJECTS: Subject[] = [
  {
    id: 'concept:architecture',
    group: 'global',
    title: 'Architecture',
    focus:
      'the architecture of igrasp-demo: what it does, its main parts and their responsibilities, how they communicate, and the boundaries between them',
    anchors: ['README.md', 'docs/architecture.md', 'package.json', 'src/main.ts'],
    material: 'some',
    files: 4,
    bytes: 2600,
    hasDocs: true,
  },
  {
    id: 'concept:stack',
    group: 'global',
    title: 'Tech stack',
    focus:
      'the technologies igrasp-demo is built with (TypeScript, Vitest): why each one is there, where the code relies on it, how they are wired together and configured',
    anchors: ['package.json', 'src/main.ts'],
    material: 'some',
    files: 3,
    bytes: 2200,
    hasDocs: false,
  },
  {
    id: 'concept:build',
    group: 'global',
    title: 'Build, CI and release',
    focus:
      'how igrasp-demo is built, checked in CI, packaged and released: the scripts, the build configuration and the workflows',
    anchors: ['.github/workflows/ci.yml', 'Makefile', 'package.json', 'scripts/deploy.sh'],
    material: 'some',
    files: 4,
    bytes: 2300,
    hasDocs: false,
  },
  {
    id: 'feature:greeting',
    group: 'feature',
    title: 'Greeting',
    focus:
      'how greeting works in igrasp-demo: the parts that implement it, the flow from trigger to result, and how it connects to the rest',
    anchors: ['src/main.ts', 'README.md'],
    material: 'some',
    files: 2,
    bytes: 2100,
    hasDocs: true,
  },
  {
    id: 'feature:docs/guide/getting-started.md',
    group: 'feature',
    title: 'Getting started',
    focus:
      'the getting started feature of igrasp-demo as described in docs/guide/getting-started.md: how it works end to end in the code, the parts involved and how they collaborate',
    anchors: [
      'docs/guide/getting-started.md',
      'docs/guide/advanced/deep-dive.markdown',
      'Makefile',
    ],
    material: 'some',
    files: 3,
    bytes: 2100,
    hasDocs: true,
  },
];

export function fixtureSubjects(files: Map<string, string>): Subject[] {
  return SUBJECTS.map((s) => ({ ...s, anchors: s.anchors.filter((a) => files.has(a)) })).filter(
    (s) => s.anchors.length > 0,
  );
}
