---
igrasp: tutorial
id: how-igrasp-demo-starts-20261025-5726
title: 'How igrasp-demo starts: a tour of igrasp-demo'
intro: You will follow igrasp-demo from src/main.ts to its Makefile, its architecture page and its decisions.
project: igrasp-demo
subject: How igrasp-demo starts
familiarity: newHere
length: standard
generated: 2026-10-25T18:04:03Z
provider: mock
model: mock-fast
generationCommit: 1f3c5e7a9b0d2f4a6c8e0b1d3f5a7c9e1b3d5f70
chapters:
- id: c1
  title: 'The entry point: main() in src/main.ts'
  goal: Explain how src/main.ts builds the greeting and when it is shouted.
  minutes: 4
  file: 01-the-entry-point-main-in-src-main-ts.md
- id: c2
  title: Build and test with the Makefile
  goal: Explain the build and test targets of the Makefile and how CI runs make test.
  minutes: 4
  file: 02-build-and-test-with-the-makefile.md
- id: c3
  title: The architecture page of igrasp-demo
  goal: 'Explain the flowchart of docs/architecture.md: who owns the folder and who renders.'
  minutes: 3
  file: 03-the-architecture-page-of-igrasp-demo.md
- id: c4
  title: Decisions and changes of igrasp-demo
  goal: Explain decision 0001-use-git-cli.md and what CHANGELOG.md records.
  minutes: 3
  file: 04-decisions-and-changes-of-igrasp-demo.md
sources:
- path: src/main.ts
  lines: 9-12
  sha256: 3b2f4cbca4febc859adda07eceeba11b9f3ec9b368809322d954472677551159
- path: src/main.ts
  lines: 1-2
  sha256: 7983d9da78c95553efc4773497826448d33b922fd6ac11a9ea9497a6adff6d0b
- path: src/main.ts
  lines: 4-7
  sha256: 318d04a4cf4a8357601e754cc656eb233c1f30db3933dd37a02ecfa8e9047959
- path: Makefile
  lines: 1-5
  sha256: 45bff86efd967a19f64390835fc608cd7c6def303e437d5b8887c579c7f4c5a9
- path: .github/workflows/ci.yml
  lines: 1-7
  sha256: 3b872f04838430635b13a3253c64f9c37f3786ebea9cf46ed63351c41a6375c9
- path: Makefile
  lines: 4-5
  sha256: 2dfc2b14e0dae415dc29e8d69c14f248261849c70e7a23c200bd9620f27bfcc4
- path: package.json
  lines: '5'
  sha256: e2deaee2cdfd055d94367944c2b264afa9b4254e622006eb186def65d94d3cdf
- path: docs/architecture.md
  lines: 3-8
  sha256: 2fb38e8b4fea54db8e98696adb5fa7baa5dd94ccc31798264c921ef00d5932ff
- path: docs/architecture.md
  lines: 3-12
  sha256: 2b2d1eb71a3bbca671ecaddddf3a1d87e4a332dbbfad24432d2ff3213d2f57d8
- path: docs/architecture.md
  lines: 10-12
  sha256: 95e01ee281c3341c3ac178d10815f2846995cd289e110f173c29361d7e627b71
- path: docs/decisions/0001-use-git-cli.md
  lines: 1-3
  sha256: cb0bbb0e0524f339a6277248e0e0912a394f79b259e4e69b2eabeea502dce1ff
- path: CHANGELOG.md
  lines: 1-5
  sha256: caf8f8ac78ce77afa59d0bfe15c15e060f655c59b13a414187f621776ee11f9f
- path: docs/decisions/0001-use-git-cli.md
  lines: '3'
  sha256: a3ecd9f3b3cfdbb5e79cd0357ad9cec1aad0a343ebbb77b4bd6ded3b541349bf
- path: docs/architecture.md
  lines: '14'
  sha256: 670150a22f2aa522aa4dae6e6aecd583d77803af256923a23aaf9d8896e396d9
---

# How igrasp-demo starts: a tour of igrasp-demo

You will follow igrasp-demo from src/main.ts to its Makefile, its architecture page and its decisions.

**Project:** igrasp-demo · **Subject:** How igrasp-demo starts · **For:** developers new to the project · **Length:** standard (~15 min) · **Written:** 2026-10-25 by Hoot with mock-fast

## Chapters

1. [The entry point: main() in src/main.ts](01-the-entry-point-main-in-src-main-ts.md) — Explain how src/main.ts builds the greeting and when it is shouted. (4 min)
2. [Build and test with the Makefile](02-build-and-test-with-the-makefile.md) — Explain the build and test targets of the Makefile and how CI runs make test. (4 min)
3. [The architecture page of igrasp-demo](03-the-architecture-page-of-igrasp-demo.md) — Explain the flowchart of docs/architecture.md: who owns the folder and who renders. (3 min)
4. [Decisions and changes of igrasp-demo](04-decisions-and-changes-of-igrasp-demo.md) — Explain decision 0001-use-git-cli.md and what CHANGELOG.md records. (3 min)

<sub>Written by IGrasp's Academy. Open this folder in IGrasp to take the tutorial; the 14 cited ranges are checked against the files when it opens.</sub>
