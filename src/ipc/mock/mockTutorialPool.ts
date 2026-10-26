// What the mock AI writes for a tutorial on the fixture project: an outline of four chapters and
// their chapters, using every step type, each step citing real lines of the fake disk and naming
// the project (so the mock's validator accepts them, like Rust's would). Hand-written, like the
// quiz's `mockQuizPool.ts`. The steps carry their self-check, as the model writes them.

import type { JsonValue } from '../types';

const check = { projectSpecific: true, reason: 'names files of igrasp-demo' };

export interface PoolChapter {
  id: string;
  title: string;
  goal: string;
  minutes: number;
  keySources: string[];
  hootIntro: string;
  /** The steps before the recap. */
  steps: JsonValue[];
  /** Explain cards added when the length asks for more steps. */
  extras: JsonValue[];
  recap: JsonValue;
}

const explain = (title: string, body: string, path: string, first: number, last: number) => ({
  type: 'explain',
  title,
  body,
  sources: [{ path, firstLine: first, lastLine: last }],
  selfCheck: check,
});

export const POOL: PoolChapter[] = [
  {
    id: 'c1',
    title: 'The entry point: main() in src/main.ts',
    goal: 'Explain how src/main.ts builds the greeting and when it is shouted.',
    minutes: 4,
    keySources: ['src/main.ts', 'README.md'],
    hootIntro: 'Hoot starts where igrasp-demo starts: main() in src/main.ts.',
    steps: [
      explain(
        'Where igrasp-demo starts',
        'The README points at `src/main.ts` lines 9-12: `main()` takes `Options` and returns the greeting from `greet(name)`.',
        'src/main.ts',
        9,
        12,
      ),
      {
        type: 'codeTour',
        title: 'From the import to the call',
        stops: [
          {
            path: 'src/main.ts',
            firstLine: 1,
            lastLine: 2,
            annotation:
              'src/main.ts imports `greet` from `./greet`: the greeting is not built here.',
          },
          {
            path: 'src/main.ts',
            firstLine: 4,
            lastLine: 7,
            annotation: '`Options` has a `name` and an optional `loud` flag.',
          },
          {
            path: 'src/main.ts',
            firstLine: 9,
            lastLine: 12,
            annotation:
              '`main()` defaults `loud` to false and upper-cases the message only when asked.',
          },
        ],
        selfCheck: check,
      },
      {
        type: 'spotIt',
        title: 'Find the shout',
        prompt: 'Click the line of main() that decides whether igrasp-demo shouts.',
        path: 'src/main.ts',
        firstLine: 9,
        lastLine: 12,
        answerLine: 11,
        explanation:
          'Line 11 of src/main.ts returns `message.toUpperCase()` when `loud` is true, the message otherwise.',
        selfCheck: check,
      },
      {
        type: 'quickCheck',
        kind: 'multipleChoice',
        question: 'What does main() in src/main.ts return when loud is false?',
        choices: ['The message as greet made it', 'The message upper-cased', 'An empty string'],
        answer: 0,
        hint: 'Read the ternary at the end of main() in src/main.ts.',
        explanation:
          'main() returns `loud ? message.toUpperCase() : message`, so with loud false it is the message from greet(name).',
        sources: [{ path: 'src/main.ts', firstLine: 9, lastLine: 12 }],
        selfCheck: check,
      },
    ],
    extras: [
      explain(
        'The last line of src/main.ts',
        "Line 14 of `src/main.ts` calls `main({ name: 'IGrasp' })` and logs the result when the file runs.",
        'src/main.ts',
        14,
        14,
      ),
      explain(
        'Options in src/main.ts',
        '`Options` in `src/main.ts` keeps `loud` optional, so callers of main() only pass a name.',
        'src/main.ts',
        4,
        7,
      ),
      explain(
        'The README says where to start',
        'The igrasp-demo README links `src/main.ts#L9-L12` as the entry point, next to the Makefile.',
        'README.md',
        33,
        33,
      ),
    ],
    recap: {
      type: 'recap',
      takeaways: [
        'main() in src/main.ts gets its message from greet(name).',
        'Options.loud defaults to false in main().',
        'Line 11 of src/main.ts upper-cases the message only when loud.',
      ],
      selfCheck: check,
    },
  },
  {
    id: 'c2',
    title: 'Build and test with the Makefile',
    goal: 'Explain the build and test targets of the Makefile and how CI runs make test.',
    minutes: 4,
    keySources: ['Makefile', '.github/workflows/ci.yml', 'package.json'],
    hootIntro: 'Hoot runs the Makefile of igrasp-demo, the way its CI does.',
    steps: [
      explain(
        'Two targets in the Makefile',
        'The igrasp-demo Makefile has `build` (`npm run build`) and `test` (`npm test`); package.json maps them to `tsc` and `vitest run`.',
        'Makefile',
        1,
        5,
      ),
      {
        type: 'putInOrder',
        title: 'From a push to the tests',
        prompt: 'Put what happens after a push to igrasp-demo in order.',
        items: [
          'ci.yml starts the test job on push',
          'the job runs make test',
          'the Makefile runs npm test',
          'package.json runs vitest run',
        ],
        explanation:
          'ci.yml triggers on push and runs `make test`; the Makefile calls `npm test`, which package.json maps to `vitest run`.',
        sources: [
          { path: '.github/workflows/ci.yml', firstLine: 1, lastLine: 7 },
          { path: 'Makefile', firstLine: 4, lastLine: 5 },
        ],
        selfCheck: check,
      },
      {
        type: 'match',
        title: 'Which file does what',
        prompt: 'Match each file of igrasp-demo to its job.',
        pairs: [
          { left: 'Makefile', right: 'names the build and test targets' },
          { left: 'package.json', right: 'maps the npm scripts to tsc and vitest' },
          { left: 'ci.yml', right: 'runs make test on every push' },
        ],
        explanation:
          'The Makefile is the entry, package.json holds the scripts, and .github/workflows/ci.yml runs `make test` on push.',
        sources: [
          { path: 'Makefile', firstLine: 1, lastLine: 5 },
          { path: 'package.json', firstLine: 5, lastLine: 5 },
        ],
        selfCheck: check,
      },
      {
        type: 'tryIt',
        title: 'Run the tests of igrasp-demo',
        instruction:
          "In a terminal at the root of igrasp-demo, run the Makefile's `test` target and watch vitest run.",
        command: 'make test',
        where: 'terminal',
        expected: 'npm test runs vitest run, as package.json says.',
        sources: [{ path: 'Makefile', firstLine: 4, lastLine: 5 }],
        selfCheck: check,
      },
    ],
    extras: [
      explain(
        'The build script',
        "package.json maps `build` to `tsc`, which the Makefile's build target reaches through `npm run build`.",
        'package.json',
        5,
        5,
      ),
      explain(
        'The CI runner',
        '.github/workflows/ci.yml runs its test job on `ubuntu-latest` only.',
        '.github/workflows/ci.yml',
        4,
        5,
      ),
      explain(
        'The entry of the package',
        'package.json declares `src/main.ts` as `main` and as the `demo` command.',
        'package.json',
        3,
        4,
      ),
    ],
    recap: {
      type: 'recap',
      takeaways: [
        'The Makefile has build and test targets.',
        'package.json maps them to tsc and vitest run.',
        'ci.yml runs make test on every push.',
      ],
      selfCheck: check,
    },
  },
  {
    id: 'c3',
    title: 'The architecture page of igrasp-demo',
    goal: 'Explain the flowchart of docs/architecture.md: who owns the folder and who renders.',
    minutes: 3,
    keySources: ['docs/architecture.md'],
    hootIntro: 'Hoot adjusts his glasses over docs/architecture.md.',
    steps: [
      {
        type: 'diagram',
        title: 'The two halves',
        mermaid:
          'flowchart LR\n  UI[React UI] -->|invoke| Rust[Rust backend]\n  Rust -->|events| UI\n  Rust --> FS[(Folder)]',
        caption: 'The flowchart of docs/architecture.md: only the Rust backend touches the folder.',
        sources: [{ path: 'docs/architecture.md', firstLine: 3, lastLine: 8 }],
        selfCheck: check,
      },
      {
        type: 'conceptBridge',
        title: 'Invoke and events',
        concept:
          'In a desktop app split in two processes, the UI asks the native side with commands and listens to its events.',
        applied:
          'In igrasp-demo, docs/architecture.md draws `React UI -->|invoke| Rust backend` and `Rust -->|events| UI`: the backend owns the file system.',
        docsUrl: 'https://v2.tauri.app/develop/calling-rust/',
        sources: [{ path: 'docs/architecture.md', firstLine: 3, lastLine: 12 }],
        selfCheck: check,
      },
      explain(
        'Who owns the folder',
        'docs/architecture.md says "The backend owns the file system; the frontend renders" (line 12).',
        'docs/architecture.md',
        10,
        12,
      ),
      {
        type: 'quickCheck',
        kind: 'trueFalse',
        question: 'In docs/architecture.md, the React UI of igrasp-demo reads the folder itself.',
        choices: ['True', 'False'],
        answer: 1,
        hint: 'Follow the arrow to the Folder node in docs/architecture.md.',
        explanation: 'Only `Rust --> FS[(Folder)]` reaches the folder; the UI invokes the backend.',
        sources: [{ path: 'docs/architecture.md', firstLine: 3, lastLine: 8 }],
        selfCheck: check,
      },
    ],
    extras: [
      explain(
        'Where to go next',
        'docs/architecture.md sends readers to getting started and to the decisions folder (lines 14-15).',
        'docs/architecture.md',
        14,
        15,
      ),
      explain(
        'The README links the page',
        'The igrasp-demo README links docs/architecture.md and the getting started guide (line 31).',
        'README.md',
        31,
        31,
      ),
      explain(
        'Events back to the UI',
        'docs/architecture.md draws `Rust -->|events| UI`: the backend pushes changes to the React UI.',
        'docs/architecture.md',
        5,
        6,
      ),
    ],
    recap: {
      type: 'recap',
      takeaways: [
        'docs/architecture.md splits igrasp-demo in a React UI and a Rust backend.',
        'The UI invokes the backend; the backend sends events.',
        'Only the backend touches the folder.',
      ],
      selfCheck: check,
    },
  },
  {
    id: 'c4',
    title: 'Decisions and changes of igrasp-demo',
    goal: 'Explain decision 0001-use-git-cli.md and what CHANGELOG.md records.',
    minutes: 3,
    keySources: ['docs/decisions/0001-use-git-cli.md', 'CHANGELOG.md'],
    hootIntro: 'Hoot opens the one decision igrasp-demo recorded.',
    steps: [
      explain(
        'Decision 0001',
        'docs/decisions/0001-use-git-cli.md records that igrasp-demo runs `git` as a subprocess.',
        'docs/decisions/0001-use-git-cli.md',
        1,
        3,
      ),
      explain(
        'The changelog',
        'CHANGELOG.md of igrasp-demo keeps an Unreleased section that lists "Everything".',
        'CHANGELOG.md',
        1,
        5,
      ),
      {
        type: 'quickCheck',
        kind: 'multipleChoice',
        question: 'How does decision 0001-use-git-cli.md say igrasp-demo talks to git?',
        choices: ['As a subprocess', 'Through a library', 'Over a web service'],
        answer: 0,
        hint: 'Read line 3 of the decision record.',
        explanation: 'docs/decisions/0001-use-git-cli.md: "We run `git` as a subprocess."',
        sources: [{ path: 'docs/decisions/0001-use-git-cli.md', firstLine: 3, lastLine: 3 }],
        selfCheck: check,
      },
    ],
    extras: [
      explain(
        'The decisions folder',
        'docs/architecture.md points readers at the decisions folder of igrasp-demo (line 14).',
        'docs/architecture.md',
        14,
        14,
      ),
      explain(
        'Unreleased',
        'CHANGELOG.md keeps changes under `[Unreleased]` until a release of igrasp-demo.',
        'CHANGELOG.md',
        3,
        3,
      ),
      explain(
        'The title of decision 0001',
        'The title of 0001-use-git-cli.md says the choice in five words: Use the git CLI.',
        'docs/decisions/0001-use-git-cli.md',
        1,
        1,
      ),
      explain(
        'Notes link the decision',
        'notes/TODO.MD of igrasp-demo asks to revisit the CLI decision.',
        'notes/TODO.MD',
        5,
        5,
      ),
    ],
    recap: {
      type: 'recap',
      takeaways: [
        'Decision 0001 makes igrasp-demo run git as a subprocess.',
        'CHANGELOG.md collects changes under Unreleased.',
        'The decisions live in docs/decisions.',
      ],
      selfCheck: check,
    },
  },
];

/** A step the validator rejects as generic (the `retry` script's first attempt). */
export const GENERIC_STEP: JsonValue = {
  type: 'explain',
  title: 'What a function is',
  body: 'A function is a reusable block of code that takes parameters and returns a value.',
  sources: [{ path: 'README.md', firstLine: 1, lastLine: 3 }],
  selfCheck: { projectSpecific: true, reason: 'about functions' },
};

/** The subjects the `thin` script suggests instead. */
export const THIN_SUGGESTIONS = [
  'How igrasp-demo is built and tested',
  "The entry point of igrasp-demo's CLI",
];
