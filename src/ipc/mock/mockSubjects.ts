// Subject proposals of the fixture, in the shape the Rust `learning::subjects` module gives:
// phrased about the project, with anchor files that exist on the fake disk and a measure of the
// material. Hand-written (the fixture is small); anchors that are not on the disk are dropped
// like Rust drops them.

import type { Subject } from '../types';

const SUBJECTS: Subject[] = [
  {
    id: 'overview',
    title: 'How igrasp-demo fits together',
    focus: 'the big picture of igrasp-demo: what it does, its main parts and how they connect',
    anchors: ['README.md', 'docs/architecture.md', 'package.json', 'src/main.ts'],
    material: 'some',
    files: 4,
    bytes: 2600,
    hasDocs: true,
  },
  {
    id: 'feature:docs/guide/getting-started.md',
    title: 'The getting started guide of igrasp-demo',
    focus:
      'what the getting started guide asks a newcomer to do, and where the project supports it',
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
  {
    id: 'build',
    title: 'How igrasp-demo is built, tested and shipped',
    focus:
      "igrasp-demo's scripts, build configuration, CI workflows, packaging and release process",
    anchors: ['.github/workflows/ci.yml', 'Makefile', 'package.json', 'scripts/deploy.sh'],
    material: 'some',
    files: 4,
    bytes: 2300,
    hasDocs: false,
  },
];

export function fixtureSubjects(files: Map<string, string>): Subject[] {
  return SUBJECTS.map((s) => ({ ...s, anchors: s.anchors.filter((a) => files.has(a)) })).filter(
    (s) => s.anchors.length > 0,
  );
}
