// Questions the mock AI "writes" about the fixture project: each cites real lines of the fixture
// files and passes the quiz validator (a test checks it), covering difficulties 1 to 5. The
// scripts of `mockQuiz.ts` pick from them and break some on purpose.

export interface PoolQuestion {
  kind: 'multipleChoice' | 'trueFalse';
  question: string;
  choices: string[];
  answer: number;
  hint: string;
  explanation: string;
  sources: { path: string; firstLine?: number; lastLine?: number; why?: string }[];
  difficulty: number;
}

export const POOL: PoolQuestion[] = [
  {
    kind: 'multipleChoice',
    question: "Which file does igrasp-demo's README name as the entry point of the app?",
    choices: ['src/main.ts', 'Makefile', 'docs/architecture.md', 'package.json'],
    answer: 0,
    hint: 'Look at the last paragraph of the README.',
    explanation:
      "README.md links 'the entry point' to src/main.ts#L9-L12, where main() builds the greeting.",
    sources: [{ path: 'README.md', firstLine: 33, lastLine: 33 }],
    difficulty: 1,
  },
  {
    kind: 'multipleChoice',
    question:
      "What does the warning in igrasp-demo's getting started guide say about remote images?",
    choices: ['They must use https', 'They are not supported', 'They must be SVG'],
    answer: 0,
    hint: 'The alert under the diagram.',
    explanation: 'docs/guide/getting-started.md has a WARNING alert: remote images must use https.',
    sources: [{ path: 'docs/guide/getting-started.md', firstLine: 15, lastLine: 16 }],
    difficulty: 1,
  },
  {
    kind: 'trueFalse',
    question:
      'According to docs/architecture.md, the frontend of igrasp-demo owns the file system.',
    choices: ['True', 'False'],
    answer: 1,
    hint: 'The Components section.',
    explanation:
      'Not quite: docs/architecture.md says the backend owns the file system and the frontend renders.',
    sources: [{ path: 'docs/architecture.md', firstLine: 10, lastLine: 12 }],
    difficulty: 1,
  },
  {
    kind: 'multipleChoice',
    question: "Which command does igrasp-demo's getting started guide ask you to run first?",
    choices: ['npm install', 'make build', 'cargo run', 'npm test'],
    answer: 0,
    hint: 'The Install section of the guide.',
    explanation:
      'docs/guide/getting-started.md has an Install section that says to run `npm install`.',
    sources: [{ path: 'docs/guide/getting-started.md', firstLine: 9, lastLine: 11 }],
    difficulty: 1,
  },
  {
    kind: 'trueFalse',
    question: 'In igrasp-demo, main() upper-cases the greeting when the loud option is set.',
    choices: ['True', 'False'],
    answer: 0,
    hint: 'Read the body of main in the entry point.',
    explanation:
      'src/main.ts returns message.toUpperCase() when loud is true; loud defaults to false.',
    sources: [{ path: 'src/main.ts', firstLine: 9, lastLine: 12 }],
    difficulty: 2,
  },
  {
    kind: 'multipleChoice',
    question: 'Which helper does src/main.ts import to build its message?',
    choices: ['greet', 'main', 'Options', 'console.log'],
    answer: 0,
    hint: 'The second line of the entry point.',
    explanation: "src/main.ts imports greet from './greet', and main() calls greet(name).",
    sources: [{ path: 'src/main.ts', firstLine: 2, lastLine: 2 }],
    difficulty: 2,
  },
  {
    kind: 'multipleChoice',
    question:
      'In the architecture diagram of igrasp-demo, what does the Rust backend send back to the UI?',
    choices: ['events', 'invoke calls', 'HTML pages', 'files'],
    answer: 0,
    hint: 'Read the arrows of the mermaid flowchart.',
    explanation:
      'The flowchart in docs/architecture.md draws `Rust -->|events| UI`: the UI invokes, the backend answers with events.',
    sources: [{ path: 'docs/architecture.md', firstLine: 3, lastLine: 8 }],
    difficulty: 2,
  },
  {
    kind: 'multipleChoice',
    question: 'Which decision record of igrasp-demo chose the git CLI?',
    choices: ['0001-use-git-cli.md', 'architecture.md', 'getting-started.md'],
    answer: 0,
    hint: 'Look in the decisions folder.',
    explanation:
      'docs/decisions/0001-use-git-cli.md records that the project runs `git` as a subprocess.',
    sources: [{ path: 'docs/decisions/0001-use-git-cli.md', firstLine: 1, lastLine: 3 }],
    difficulty: 2,
  },
  {
    kind: 'multipleChoice',
    question: "What does the Makefile's test target of igrasp-demo run?",
    choices: ['npm test', 'cargo test', 'make build', 'vitest --watch'],
    answer: 0,
    hint: 'Two lines at the end of the Makefile.',
    explanation:
      'The test target in Makefile runs `npm test`, which package.json maps to `vitest run`.',
    sources: [
      { path: 'Makefile', firstLine: 4, lastLine: 5 },
      { path: 'package.json', firstLine: 5, lastLine: 5 },
    ],
    difficulty: 3,
  },
  {
    kind: 'multipleChoice',
    question: "Which command does igrasp-demo's CI workflow run?",
    choices: ['make test', 'npm run build', 'scripts/deploy.sh', 'vitest --coverage'],
    answer: 0,
    hint: 'The only step of the workflow.',
    explanation:
      '.github/workflows/ci.yml has one job whose single step runs `make test`, so CI goes through the Makefile.',
    sources: [{ path: '.github/workflows/ci.yml', firstLine: 6, lastLine: 7 }],
    difficulty: 3,
  },
  {
    kind: 'multipleChoice',
    question: 'Which file of igrasp-demo deploys it?',
    choices: ['scripts/deploy.sh', 'Makefile', 'package.json'],
    answer: 0,
    hint: 'Look in the scripts folder.',
    explanation:
      'scripts/deploy.sh is a two-line shell script that echoes deploying; nothing in CI calls it.',
    sources: [{ path: 'scripts/deploy.sh', firstLine: 1, lastLine: 2 }],
    difficulty: 3,
  },
  {
    kind: 'multipleChoice',
    question: 'Which README section of igrasp-demo lists the features as a task list?',
    choices: ['Features', 'Install', 'Components', 'Changelog'],
    answer: 0,
    hint: 'A level-two heading near the top of the README.',
    explanation:
      'README.md has a Features section with a task list: Tables and Task lists are done, World domination is not.',
    sources: [{ path: 'README.md', firstLine: 8, lastLine: 12 }],
    difficulty: 4,
  },
  {
    kind: 'multipleChoice',
    question: 'Which package.json field makes igrasp-demo installable as a `demo` command?',
    choices: ['bin', 'main', 'scripts', 'devDependencies'],
    answer: 0,
    hint: 'Look for the command name in package.json.',
    explanation:
      'package.json maps `bin.demo` to src/main.ts, which is why the profile lists the project as a command-line tool.',
    sources: [{ path: 'package.json', firstLine: 4, lastLine: 4 }],
    difficulty: 4,
  },
  {
    kind: 'multipleChoice',
    question: "Following igrasp-demo's CI, which tool finally runs the tests?",
    choices: ['Vitest', 'Jest', 'cargo test', 'Playwright'],
    answer: 0,
    hint: 'Follow ci.yml to the Makefile, then to package.json.',
    explanation:
      'ci.yml runs `make test`, the Makefile test target runs `npm test`, and package.json maps test to `vitest run`.',
    sources: [
      { path: '.github/workflows/ci.yml', firstLine: 7, lastLine: 7 },
      { path: 'Makefile', firstLine: 4, lastLine: 5 },
      { path: 'package.json', firstLine: 5, lastLine: 5 },
    ],
    difficulty: 5,
  },
  {
    kind: 'trueFalse',
    question: 'In igrasp-demo, the main() call at the end of src/main.ts uses the loud option.',
    choices: ['True', 'False'],
    answer: 1,
    hint: 'The last line of the entry point.',
    explanation:
      "Close: src/main.ts calls main({ name: 'IGrasp' }) without loud, so the default false applies and the greeting keeps its case.",
    sources: [{ path: 'src/main.ts', firstLine: 9, lastLine: 14 }],
    difficulty: 5,
  },
];
