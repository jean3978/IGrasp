# Quiz

**Quiz Me** asks you questions about how the open project is made, written by the AI from the
project's own files ([ADR 0016](../decisions/0016-learning-features-grounded-in-the-project.md)).
Every question cites a file you can open at the lines that prove the answer. It is for anyone
joining a project, or coming back to one: developers by default, or the role you pick (an artist,
a designer, a producer, QA…), at the depth that role needs. Nothing generic, no trivia about a
language.

Two rules of the AI features hold here too: **no token without a user action** (only the
confirmation card's Start, Keep going and Next round spend tokens) and **the provider is
replaceable** (the quiz uses the neutral AI layer; Claude, through its CLI, is the only provider
today).

## Using it

- **Open**: **Learn → Quiz Me…** (`Ctrl+Alt+Q`), or the owl button of the AI tools over the
  view. The Quiz tab opens; opening it is free (the profile, the subjects, the history and a quiz
  to continue are local).
- **Home**: Hoot and the **new-quiz wizard**, one question per step:
  1. **Your role**: roles proposed for this kind of project (a game: gameplay programmer, game
     designer, level designer, artist, technical artist, sound designer, producer, QA tester; a
     web product: frontend and backend developers, UX/UI designer, product manager…), or *Other
     role* typed. Preselected from your last quiz.
  2. **Kind of quiz**: the cards your role is offered, each described for your work: *Global
     concepts* and *A feature* for everyone, *Check specific code* only for the roles that read
     code (developers, QA, and roles the app does not recognise). An artist reads "How the
     project is made, seen from your work: the engine's scenes and assets, the art pipeline…". A
     click moves on; a kind kept from an earlier quiz that the new role is not offered waits for
     a new choice.
  3. **Subject**: the concept chips (with *The whole project*) or the feature chips, the ones
     that fit your role first (an artist: the engine's model, the UI, animation, player,
     levels…); those about what the role never touches (concurrency, state management, payments
     for an artist) wait behind **More subjects (n), further from your work**. *Something else*
     types a concept or feature that is not listed, with an example for your role (sent as such,
     so Hoot knows whether it is a concept or a feature), or the code picker for a code check.
  4. **Options**: a summary ("As Artist · A feature: Player · Change"), a note when the project
     has no documentation on the subject (local, no AI: Hoot will work from the code and report
     what the documentation lacks), the number of questions (5 to 30), the mode, the sources
     (not for a code check), the model, and **Start**.

  Back and the step bar go back to an earlier step.
- **All three choices shape every question.** The role is read as a family of crafts
  (developer, QA, art, audio, level design, design, production, writing, or general; the same
  rules in Rust and TypeScript, checked on `src/test/fixtures/quiz/roles.json`). Developers get
  the developer-to-developer audience; QA gets behaviour, edge cases and tests; other roles get
  questions about how their work fits in the project, in plain words, with a focus that fits
  them (an artist: how sprites, animations, scenes and materials are wired; a producer:
  structure, pipeline, risks…), and never questions that ask them to read code. The prompt says
  the kind of quiz and asks only what this role needs to know about this subject. Questions may
  test an industry-standard concept or process (a design pattern, a security practice, a CI
  step, an asset pipeline convention, a game-design principle) when the answer depends on how
  this project applies it, at most about a third of them. Every question still cites the
  project's files.
- **Documentation gaps are reported.** While it reads, Hoot judges whether the documentation
  explains the subject well enough for your role; when it does not, the results show a
  **Documentation gap** note (what is not documented and where a page would help), also written
  in the results report. It is a finding about the project, not about you.
- **The wizard's choices are kept with the quiz**: the kind of quiz (`category`: global,
  feature, code) and the role are stored in the quiz record and the history, written in saved
  quiz files and results reports, listed with the saved quizzes, and shown as tags (the basis of
  a sorted list of quizzes later). Start shows the confirmation card with the expected size;
  nothing is sent before its own Start. Below: **Continue your quiz** (a quiz in progress
  survives a restart), **Last results** with **Play again**, **Saved quizzes** with **Open quiz
  file…**, and the project profile.
- **Generating**: Hoot thinks, the files the AI reads appear as it reads them, the elapsed time,
  a retry line when questions did not check out ("Checking the questions… retry 1 of 2: 2 cited
  agent files"), and **Stop**.
- **A question**: multiple choice (`1`–`4`) or true/false (`T` / `F`), **Hint** (`H`), **Look it
  up** (`L`), then the reveal: right or wrong, Hoot's reaction, the explanation, and the sources.
  **Read more →** opens the cited file at its lines (a markdown file in the preview, any other
  text file in the code viewer). `Enter` goes on, `Esc` goes back to the home and keeps the quiz.
- **Look it up**: nobody knows a project by heart, so before answering you can open the files
  the question cites. They open in a glowing window with Hoot standing on its top edge, eyes
  following your pointer: syntax-highlighted, read-only, one button per file when there are
  several, scrolled near the cited lines without marking them (the answer is still yours to
  find). `Esc` or **Back to the question** returns to the card; keys typed in the window never
  answer. Like the hint, it is recorded with the answer ("looked it up" on the results and in the
  saved report) and does not change your level. Questions that cite only binary files have no
  Look it up.
- **Level and streak**: five flames show your level (1 to 5). Two right answers in a row move it
  up, two wrong ones down, a wrong answer at level 5 drops it at once. The next question is the
  unplayed one nearest your level (lower first). The streak badge appears at 2 in a row.
- **Effects**: confetti on a right answer, sparks at a streak of 3, a ring on a level up. Off with
  Settings → Learning → Effects, and always off when the system asks for reduced motion.
- **Results**: the score, the level reached, the best streak, the time, the tokens and cost (or
  "Replayed: no AI call."), every question with your answer and its sources, and **Save
  results…**, **Save quiz…**, **Play again** (the same questions, no AI), **Keep going** (more
  questions at your level, through the confirmation card) and **New quiz**.

## What Hoot asks about

Proposed locally from the project profile and the files, without AI, and only when the project
has enough material (`learning/subjects.rs`). Titles are concepts and features, never folder
paths.

- **Global**: concepts across the project. *Architecture* and *Tech stack* (its engines,
  frameworks and languages), the engine's or framework's own model (*Godot scenes, nodes and
  signals*, *Unity components…*, *UI and backend boundary* for Tauri or Electron, *API design* for
  services), and the concepts the code shows it implements, recognised by the words of its paths
  (camelCase and plurals included): *Security*, *Data and storage*, *State management*, *Design
  patterns*, *Error handling*, *Concurrency and background work*, *User interface*, *Networking
  and communication*, *Configuration and settings*, *Logging and diagnostics*, then *Design
  decisions*, *Build, CI and release* and *Testing strategy*.
- **Features**: the docs' feature pages, the subfolders of feature folders (`features/`,
  `systems/`, `gameplay/`, `scenes/`, `plugins/`, …), a game's own top-level folders (`player/`,
  `enemy/`), and common features found by name (*NPCs*, *Enemies*, *Combat*, *Inventory and
  items*, *Saving and loading*, *Dialogue*, *Multiplayer*, *Search*, *Notifications*, …). A
  feature made mostly of the files of another one is not proposed twice; at most 12.
- **Something else**: under the concept or feature chips, type one that is not listed (a concept: "threading model"; a feature: "fishing"). It is sent with its kind, and the generation
  starts from the files whose names match its words; if the project has nothing about it, Hoot says so.
- **Check specific code**: pick files or folders (type them, with suggestions, or add a file
  open in a tab). The quiz cites only that code and asks **detailed, line-level questions**:
  control flow, edge cases, early returns, error paths, what a change would break. Use it to make
  sure you understand code before you submit it. Sources do not apply.

Every other subject asks for **understanding, not memory**: what a concept or feature is here,
how it is implemented and why, which parts collaborate and how data flows, what a choice costs.
Trivia that only checks one line (a constant's value, whether a function returns early, a
parameter's name) is reserved for *Check specific code*.

`IGRASP_SUBJECTS_ROOT=<folder> cargo test --manifest-path src-tauri/Cargo.toml print_subjects
-- --ignored --nocapture` prints the subjects of any folder without AI.

## Modes and sources

- **Fixed**: every question is written in one AI call; your level only changes their order.
- **Adaptive**: rounds of 5 questions at your current level, one call per round. The card says
  how many calls the quiz needs; each round after the first starts only when you press **Next
  round** (it carries the AI marker). Stopping during a round ends the quiz on the results of the
  rounds played.
- **Whole project**: code, configuration, build, tests and docs. The prompt asks that at least
  half of the questions cite code, configuration, build or test files.
- **Documentation only**: the markdown files only; a question citing anything else is rejected.

## What the AI reads, and what it may cite

The request is composed in Rust (`learning/quiz/compose.rs`); the frontend sends only the
subject, the count, the mode, the scope and the questions to avoid. It contains the project
profile and your corrections, a map of the project's files (capped), a few inlined anchor files
(README, architecture, the manifest, an entry point per top-level folder), and the instruction
files for agents (`AGENTS.md`, `CLAUDE.md`, ...) **as context only**. The AI runs read-only in the
folder and may open more files.

The answer must follow a JSON schema; every question is then checked
([ADR 0022](../decisions/0022-grounded-generation-pipeline.md)): a valid answer, distinct
choices, a right choice that does not give itself away by its length (half as long again as
every wrong one and 20 characters longer is rejected), at least one source that exists in the project, a line range inside the file for text
files (at most 120 lines), never an agent instruction file or a secret (`.env`, keys), the
scope, no duplicate, a hint that does not give the answer, and a question that names something of
the project. Rejected questions are sent back with their reasons, at most twice, under the same
operation; if too few pass after that, the quiz ends on the home with the reasons and subjects
that may work better. A subject with too little material says so instead of padding. The prompt
asks for wrong choices written with the same care, length and tone as the right one, and the app
shuffles the choices of every multiple choice question when they arrive (the AI tends to put the
right one first); the record keeps that order, so replays and quiz files show the same.

## Hoot

An original owl ([ADR 0023](../decisions/0023-hoot-the-owl.md)) with five states: idle,
thinking, cheering, explaining, encouraging. Its lines are local and never repeat back to back;
the AI writes only the questions, hints and explanations, in Hoot's tone (warm, brief, precise,
at the depth the role needs). `?hoot=1` in the dev server shows every state in the three themes.

## Saving results

**Save results…** opens the system save dialog on `quiz-results/` (Settings → Learning) with
the name `quiz-results-<project>-<date>-<time>.md`. The file has a front matter (title, project,
subject, date, provider, model, mode, score, level, questions), a summary table, and every
question as a task list (`[x]` your answer, `✓` the right one) with the explanation and its
sources. Source links are **root-absolute** (`/src/main.ts#L9-L12`) so they work wherever the
file is saved in the folder, in IGrasp and on GitHub. A toast offers to open it. Dismissing the
dialog writes nothing.

## Saving and sharing a quiz

**Save quiz…** (generated quizzes and replays of the history) writes a quiz file
([ADR 0024](../decisions/0024-shareable-learning-files-as-markdown.md)) to `quizzes/`:

````markdown
---
igrasp: quiz
id: quiz-…
title: IGrasp — How the AI gateway works
subject: How the AI gateway works
scope: wholeProject
level: 2
generated: 2026-10-24T14:02:00.000Z
provider: claude-cli
model: sonnet
sources:
  - path: src-tauri/src/ai/gateway.rs
    lines: 120-141
    sha256: 9c1e…
---

## 1. Which component is the only one that may start an AI operation?

```igrasp-quiz
id: q1
kind: multipleChoice
difficulty: 2
choices: […]
answer: 1
hint: …
explanation: …
sources:
  - path: src-tauri/src/ai/gateway.rs
    lines: 120-141
    kind: code
```
````

- The answers are in the file in clear: it is a learning aid shared on purpose.
- Anyone replays it **without the AI**, even logged out: from **Saved quizzes** on the home,
  **Learn → Open Quiz File…** (a file anywhere; its citations resolve against the open folder),
  or the **Play this quiz** banner of the preview, where the question blocks show as cards with
  the answer folded.
- When it loads, every cited range is hashed again: a changed range shows "the source changed
  since this quiz was written" on the reveal, a missing file shows its path as text. The question
  stays playable.
- Hand edits are tolerated: a block that does not parse is skipped and counted.

## Settings

Settings → **Learning**: questions per quiz, default mode and sources, effects, the results and
quizzes folders (inside the open folder; an invalid folder is shown and not saved), **Forget this
folder's quizzes** (the history and the quiz in progress in app data; saved files stay), and the
project profile with **Reset to detected**.

## Where things live

- In app data, per folder (`learning/<folder>.json`): profile corrections, the quiz in progress
  (saved after each answer), the last 20 finished quizzes.
- In the folder, only what you save through the dialog: results and quiz files.

## Limitations

- The estimate on the card is a floor: the AI may open more files than the inlined ones.
- A quiz runs read-only whatever the permission settings: the gateway refuses every permission
  prompt of the operation. What the provider can read on its own is decided by its sandbox.
- The author of a shared quiz comes with Git (Phase 9); until then the `generated` date shows.

## Testing

- Rust: profile fixtures and dogfooding, corpus and agent files, subjects, prompt snapshot,
  schema, validator (shared JSON fixtures with the mock), validated runs with the mock provider
  (accept, retry, exhaust, cancel, text fallback), compose and estimate, app data, save dialog
  behind a trait, quiz file recognition, the "only the gateway starts a provider" scan.
- Vitest: the engine, the store against every mock script (valid, retry, exhaust, thin,
  textOnly, slow, leak), the markdown and quiz file formats (snapshots, round trip, tolerant
  read, freshness), the preview's banner and cards, the settings section, effects, and the "no
  token without a user action" test extended to every quiz entry point.
- Playwright: `e2e/quiz.spec.ts`, `e2e/quiz-replay.spec.ts`, `e2e/profile.spec.ts`.

### A real quiz

`real_quiz` in `learning/quiz/compose.rs` is an ignored test that runs a real generation through
the gateway and prints the accepted questions:

```sh
IGRASP_QUIZ_ROOT=/path/to/project cargo test --manifest-path src-tauri/Cargo.toml real_quiz -- --ignored --nocapture
```

Optional: `IGRASP_QUIZ_COUNT`, `IGRASP_QUIZ_MODEL`, `IGRASP_QUIZ_SUBJECT`, `IGRASP_QUIZ_SCOPE`.

Manual checks recorded for 0.4.0 (Windows 11, the Claude CLI):

| Project | Kind | Result |
|---|---|---|
| IGrasp (this repository) | Desktop app, Rust + TypeScript | 8 questions, all accepted at the first attempt; 4 cite code or configuration (`playwright.config.ts`, `.github/workflows/ci.yml`, `src-tauri/src/lib.rs`, `src-tauri/src/ai/no_start.rs`), 4 cite docs; about $0.21. No generic question. |
| Godot `2d/platformer` demo ([godot-demo-projects](https://github.com/godotengine/godot-demo-projects), MIT) | Godot 4 game in GDScript, 117 files | Profile "a Godot 4.7 game in GDScript"; 6 subjects (overview, scenes and signals, player, level, enemy, gui). 8 questions, 0 rejected, all citing GDScript, scene or project settings lines: the main scene, the renderer, two-player input through `action_suffix`, the double jump, the coin signal path, the split-screen viewports, `Gun.shoot()`, which camera limits apply. Claims checked against the files. About $0.18, 31 s. No generic question. |
