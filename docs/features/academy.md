# Hoot's Academy (tutorials)

The **Academy** writes tutorials about the open project and lets you take them one step at a
time, with Hoot. A tutorial is written by the AI from the project's own files
([ADR 0016](../decisions/0016-learning-features-grounded-in-the-project.md)): every step is about
**this** project and cites its files, and a step that would read the same in another project is
rejected before you see it. It is for anyone joining a project or one of its domains: an
onboarding, a tour of a feature, a request traced end to end, a domain you are new to taught
through the project's own use of it.

The two rules of the AI features hold here too: **no token without a user action** (only the
Start of a confirmation card spends tokens) and **the provider is replaceable** (the Academy uses
the neutral AI layer; Claude, through its CLI, is the only provider today). The AI never changes
a tutorial on its own and never marks it verified.

## Using it

- **Open**: **Learn → Academy…** (`Ctrl+Alt+A`), the graduation-cap button of the AI tools over
  the view, or **Take it in the Academy** on a shared tutorial in the preview. The Academy tab
  opens; opening it is free: the profile, the cards, the library and the badges are local.
- **Welcome**: when the tab opens (it was not open), Hoot pops up, its mortarboard drops on its
  head, "Welcome to Hoot's Academy", and the screen fades into the hub after about two seconds.
  A click or any key skips it; switching back to an open Academy tab does not replay it, and it
  is not shown when the learning effects are off or the system asks for reduced motion.
- **The hub** is a classroom: Hoot in a mortarboard in front of the blackboard, three owls at
  their desks (one thinks, one raises a wing now and then), and **Your tutorials** on the
  blackboard (title, tags, progress, Share, Save as…, Delete). Many tutorials scroll inside the
  board, which stays short enough to keep the whole classroom in view. Above it, **New
  tutorial** (the wizard below) and **Continue where you left off** (the last tutorial in
  progress, its chapter and step); under it, the project profile with **Edit** (the Phase 4
  dialog; a correction rebuilds the cards).
- **New tutorial** is a wizard of three steps, shown at the top of each: **Subject**, **Options**,
  **Confirm**. The subject step has **What do you want to learn?** (type a subject, Enter), the
  **subject cards** grouped by family and **Suggest more subjects**; a failed outline comes back
  to it with the subjects that may work better.
- **Subject cards** are built locally from the project profile, without AI
  ([ADR 0028](../decisions/0028-subject-families-built-locally.md)). Twelve universal families
  (The Big Picture; Tech Stack, as used here; Architecture Tour; Feature Deep Dive; Trace It;
  Dependencies; Build, Run, Test, Ship; Conventions and Patterns; Decisions; Your First
  Contribution; Project Story; Glossary) and domain families from the profile (Games, Web,
  Mobile, Services and back ends, Libraries, CLIs and desktop apps, Data, ML, infrastructure and
  embedded). Each card is phrased about the project ("…, from `watcher.rs` and `tree.ts`"), shows
  its amount of material, and is offered only when the project has enough files about it. Feature
  Deep Dive and Trace It open a pick list (a feature, or an action such as "a file changes on
  disk"). At most 24 cards.
- **I'm new to…** (in the options): chips for the engines, frameworks and domain topics the
  project uses (for example "Godot materials and shaders", "web security"), or type your own. A
  domain card fills it in. Hoot then teaches that domain through this project's own use of it, a concept at a
  time, never as a separate course.
- **Suggest more subjects** (marked as using AI) asks the AI for subjects the cards missed,
  through its confirmation card. The accepted ones appear as cards of the **Suggested** family
  and are kept with the folder.

### Options and the confirmation card

A card or a typed subject leads to the options:

- **How well do you know this project?** *New here* (an onboarding), *Already contributing*
  (how things are done here, where a change goes, the traps), *Deep dive for maintainers*
  (invariants, trade-offs, failure modes).
- **I'm new to…** (optional), **Length** (*Quick* ~5 min, 2–3 chapters; *Standard* ~15 min, 3–5
  chapters; *Deep* ~30 min, 5–8 chapters), **Your role** (a developer by default; the quiz's role
  rules apply), and the **Model**.
- **Plan the outline** shows the **confirmation card**: what the AI will do, the provider and
  model, the files inlined (agent instruction files marked "context only"), the size class, the
  number of calls, the cost line (what the same kind of operation cost last time in this folder,
  else the range measured by the proof of concept), and that the operation is read-only.
  **Nothing is spent before its Start.** Every AI operation of the Academy goes through such a
  card: the outline, the chapters, a single chapter, the review and the suggestions.

### The outline, then the chapters

1. **Outline** (one call): a title, an intro and the chapters with their goal and minutes. It is
   saved privately at once, so closing the tab keeps it (the library shows it as an outline).
2. **Outline review**: reorder the chapters (drag, or `Shift+↑` / `Shift+↓`), rename one
   inline, remove one, and tick the chapters to write now (all by default). When the project
   lacks material for the subject, the outline says so and offers **Start again with another
   subject**, with the subjects the AI suggested instead. A documentation gap note shows when
   the AI reported one.
3. **Write n chapters** shows its card ("4 calls in one operation, one chapter at a time"). The
   chapters are written as one **staged run** ([ADR 0026](../decisions/0026-staged-runs.md)):
   one validated call per chapter, under one operation, each a fresh prompt with the accepted
   outline and the recaps of the chapters already written. The generation screen shows Hoot,
   "Chapter 2 of 4: …", the files the AI reads, a retry line when steps did not check out, the
   elapsed time and **Stop**. Each accepted chapter is saved at once; **Start reading** opens
   chapter 1 while the others are written. A chapter that fails its checks after its retries
   ends the run; the chapters written so far stay, and the course map offers **Write it** on
   the others (one chapter, its own card).

### Taking a tutorial

Reading never calls the AI.

- **Course map**: the chapters as a winding path of nodes (done, current, open, locked, not
  written yet), with "n of m steps" and the minutes, a mark on chapters whose sources changed
  and on chapters with steps updated since you read them. Arrow keys (and `Home` / `End`) move
  between nodes, `Enter` opens one.
- **Chapter player**: a progress bar, the XP and the streak, Hoot's introduction (the one line
  per chapter the AI writes), then one step card at a time, focused on every transition. A step
  shows its sources (**Read more →** opens the cited file at its lines), a notice when a source
  changed or is missing, and **updated since you read it** when its content changed after you
  completed it. `Esc` or `M` goes back to the map and keeps your place; progress is saved after
  every step and resumed when you come back.
- **The ten step types and their keys**:

  | Step | What it is | Keys |
  |---|---|---|
  | Explain | Prose about the project, with its sources | `Enter` / `→` next, `←` previous, `R` read more |
  | Concept bridge | A short concept box, then how this project applies it, citing its lines; a link to the official documentation when there is one | as Explain |
  | Diagram | A Mermaid diagram and its caption | as Explain (the diagram has its own keys when focused) |
  | Recap | The chapter's end: Hoot, how it went (steps done, answers right, the +25 XP bonus to come), the takeaways as numbered cards, the steps left with **Go to step N**, and the next chapter | as Explain |
  | Code tour | The cited file in a read-only viewer, one stop (a highlighted range and its annotation) at a time | `→` / `←` or `N` / `P` stops, `Enter` on the last stop, `O` open in the code viewer |
  | Spot it | A snippet: click the line the question asks for | `↑` / `↓` move the line cursor, `Enter` picks |
  | Put in order | Shuffled items to put in order, then Check | `Space` picks up / drops, `↑` / `↓` move, `Enter` checks |
  | Match | Two columns to pair, then Check | `↑` / `↓` within a column, `Enter` selects, `Backspace` undoes a pair |
  | Quick check | The quiz's question card | `1`–`4`, `T` / `F`, `H` hint, `L` look it up |
  | Try it yourself | A command to copy, a change to try, or an engine or IDE action, with what to expect. **The app never runs it** | `C` copy, `O` open the file, `Enter` I did it, `S` skip |

  An interactive step gives two tries, then shows the answer and its explanation. `Esc` returns
  to the course map from any step.
- **XP, streak and graduation** (rules fixed in `features/academy/academyEngine.ts`, pinned by
  `src/test/fixtures/tutorial/xp.json`; the AI never sees them): an explain, concept bridge,
  diagram or recap read 5 XP; a code tour walked or a try-it done 10 (a skipped try-it 0); an
  interactive step right at the first try without a hint 20, right after a hint or a second try
  10, otherwise 5 for the explanation; a completed chapter 25. From 3 right first-try answers in
  a row, an interactive step's points are multiplied by 1.5. A step completed again earns
  nothing more but takes the new version (which clears its "updated" mark). Confetti on a
  completed chapter, a ring on a streak (off with Settings → Learning → Effects and under
  reduced motion); gains are announced. When every chapter is written and done, the
  **graduation** screen shows a badge, the XP, the chapters, the right-first-try count, the
  time and the documentation note.
- **Quiz me on this tutorial** (on the graduation screen and in the tutorial's header) opens the
  Quiz tab with the quiz's own confirmation card: a quiz limited to the tutorial's cited files,
  about what a reader of the tutorial should now understand (see [quiz.md](quiz.md)).

### Sharing

A tutorial is private (in the app's data) until you share it
([ADR 0027](../decisions/0027-tutorial-storage-sharing-and-verification.md)).

- **Share with the project** (library row, graduation screen) writes it into the folder as
  markdown: `<tutorials folder>/<slug of the title>/README.md` plus one file per written chapter
  (format: [ADR 0025](../decisions/0025-tutorial-format-json-schema-and-shared-markdown.md)). A
  confirmation first lists the folder and every file, each **new**, **changed** or
  **unchanged**, and the chapter files that would be **removed**; nothing is written before its
  button. A tutorial shared before is updated where it is; a folder that holds another tutorial
  is refused. The private copy stays, tagged "shared as …".
- **Save as…** writes a copy into a folder you choose in a dialog (`<chosen>/<slug>/`).
- **Delete** (a private tutorial, after a confirmation) removes it and your progress in it; a
  shared copy stays.
- **Shared tutorials** (yours or a teammate's, after a pull) are found by the scan and listed
  beside the private ones, tagged with their path. Your progress in a shared tutorial is yours,
  in app data.
- **In the preview**, a tutorial's README and chapter files show a banner with **Take it in the
  Academy** instead of the front matter card, and the interactive blocks render as cards with the
  answers folded; nothing in them runs (see [markdown-preview.md](markdown-preview.md)).

### Asking about a step

Every step card ends with the questions readers saved on it and a "Something unclear in this
step?" box that says how to ask.

- **Ask**: **Ask about this step** opens the chat about the whole step. **Highlight words to ask**
  (the text tool, **Ctrl+Alt+S**) says on the card to select the words, and the chat opens on
  release; the region tool (**Ctrl+Alt+R**) frames part of the step. The chat opens about that
  step ("Step · Chapter 2, step 3: …"); write the question and press Send. That Send is the only
  thing that spends tokens. The backend adds the step as the reader sees it, what was pointed at,
  and the files the step cites to the message.
- **The chat about a step** wears the Academy's owl colours, with Hoot perched on the panel and a
  question mark ("About a step"), as long as the conversation is about one.
- **Save for other readers?**: under the answer, the chat asks whether to keep the question and
  the answer on the step, recalling that the reader's name is not shown. **No thanks** keeps
  nothing (**Save it after all** reconsiders). A private tutorial keeps it at once; for a shared
  tutorial the write confirmation lists the chapter file that changes, and nothing is written
  before it.
- **Code tours** remember their stop while the tutorial is open: **Open in the code viewer**, then
  back to the Academy, finds the same stop.
- **Anonymous**: a saved question holds the step, the text pointed at, the question and the
  answer; no name, no date. Shared, it sits at the end of the chapter's file under "Questions
  from readers" (`igrasp-question` blocks), so teammates see it on the same card, and GitHub
  shows it as text. The preview folds its answer.
- **Remove** (the bin beside a question) works the same way: at once for a private tutorial,
  through the confirmation for a shared one. A chapter keeps at most 50 questions.

### Freshness, the AI review and verification

- **Freshness on open** (local, no token): every cited range is hashed and compared with the
  file. The tutorial's header and the library show a badge: *Up to date*, *Maybe outdated (n of
  m changed)* or *Sources missing*. The **freshness panel** lists the changed, moved and missing
  ranges (each opens the file at its lines) and the steps that cite them; the course map marks
  their chapters and the steps show a notice. Lines that only moved are **relocated**: saved
  silently for a private tutorial; for a shared one, **Update the moved citations** offers the
  change as a write you confirm.
- **Check with the AI** (marked as using AI, behind its confirmation card; one read-only call):
  the AI rereads the tutorial, as the markdown a teammate reads, against the project as it is
  now, with the freshness report. The **review screen** shows each written chapter as still
  correct or outdated with the reason; each proposed replacement step as a before/after rendered
  diff with **Accept** / **Reject** (`A` / `R` on a focused proposal) and **Accept all** /
  **Reject all**; and the topics the tutorial misses (**Not covered yet**). A proposal is
  validated like a written step before you see it. Nothing changes until you save: a private
  tutorial is saved; a shared one goes through the write confirmation. On a private tutorial a
  missing topic has **Write this chapter** (one chapter, its own card).
- **Mark as verified…** is your statement, after a confirmation: "You confirm this tutorial is
  correct for the project as it is now. IGrasp records the date, the commit and your name." The
  date, the HEAD commit and the git user name (read from the `.git` files, no git process) are
  recorded and the cited ranges hashed again, so the badge starts from now. A shared tutorial is
  written after the write confirmation (only its README changes). The AI review never sets it.

## Settings

Settings → **Learning → Tutorials**: the **default familiarity** and **default length** of a new
tutorial, the **tutorials folder** that Share with the project writes to (inside the open folder,
default `docs/tutorials`, created only when you share; an invalid folder is shown and not saved),
and **Forget tutorials…** (the folder's private tutorials, your progress in every tutorial and the
suggested subjects, from app data, after a confirmation; shared tutorials stay). The effects
toggle and the model are shared with the quiz.

## Privacy and where things live

- **In app data**, per folder: each private tutorial as `learning/tutorials/<folder>/<id>.json`,
  and in the folder's learning file your progress (keyed by the tutorial id), the AI's subject
  suggestions and the usage of the last 20 tutorial operations.
- **In the opened folder**, only after the write confirmation that lists the files: Share with
  the project, Save as… (when you choose a folder inside it), and the updates of a shared
  tutorial you confirmed (accepted proposals, moved citations, a verification). Nothing else
  writes there, and nothing at all without your click.
- **Sent to the provider**, only on a confirmation card's Start: the project profile, a map of
  the files, the inlined anchors (agent instruction files as context only, never cited), and for
  a review the tutorial and its freshness report. Every tutorial operation is read-only: the
  gateway denies every permission request whatever the settings.
- Cited files are read only inside the opened folder: a citation with `..`, an absolute path or a
  link leading out of it is neither read nor sent, and counts as missing.

## Limits

- The freshness check is not cached per disk revision as planned: it runs when a tutorial opens
  and each time the library lists, which reads every shared README and its chapters again. It is
  fast (see Performance).
- Relocation finds exact moves only: a range that moved and changed reads as changed, a renamed
  file as missing. The badge says "maybe"; the review and you decide.
- A review that finds nothing to change leaves the badge at *Maybe outdated* until you mark the
  tutorial verified (which hashes the ranges again).
- Review decisions are per proposed step, not per change inside a step as the plan intended.
- The label is **Check with the AI** (provider-neutral); the plan said "Check with Claude".
- Editing a tutorial by hand in the app comes with Phase 6; authors and history from git with
  Phase 7 (until then the `generated` date and the verification's name). Project Story works
  from the changelog, release notes and dated decisions, not the commit log.
- The mock's fixture project has no shared tutorial by default (its file lists stay unchanged):
  `window.__igraspMock.addSharedTutorial()` writes one to the fake disk.
- There is no GIF of a code tour in the README yet.

## Performance

`perf_tutorials` in `src-tauri/src/perf.rs` (ignored; run with the performance command of
[CLAUDE.md](../../CLAUDE.md)) measures the Academy on the 10k-document reference project. In a
debug build (release builds are blocked on the measuring machine by Windows Smart App Control):
the subject cards (corpus, subject detection and families) **253 ms** against a budget of 1 s,
and the freshness check of a tutorial citing 20 hashed ranges **3.3 ms** against 200 ms.

## Testing

- Rust: the staged runs with the mock provider (order, failure, cancel, bound), the families per
  profile fixture and on this repository, the validators on the shared cases
  (`src/test/fixtures/tutorial/cases/`, also asserted by the mock), the format fixtures
  (`src/test/fixtures/tutorial/format/<case>/`: the Rust writer and the mock's writer must
  produce the exact files; `IGRASP_UPDATE_FIXTURES=1` regenerates them from Rust), the step
  hashes (`step-hashes.json`), share plans and writes on a temporary folder, `.git` reading,
  app data, the composition of every tutorial request (read-only, the frontend's fields
  ignored), and the "only `ai_start` starts an operation" scan.
- Vitest: the engine against `xp.json`, the stores, every step component with the keyboard, the
  course map, the outline review, the review screen (only accepted steps change), sharing and
  freshness screens, the preview's banner and blocks, the mock (scripts `valid`, `retry`,
  `exhaust`, `thin`, `textOnly`, `slow`, `stageFail`), the "no token without a user action" test
  and the neutrality scan extended to the Academy.
- Playwright: `e2e/academy.spec.ts` (a tutorial from the cards read with the keyboard, spending
  only at each Start; sharing and the preview banner; a changed cited line checked locally then
  reviewed and written after the confirmations; every control named).

## Real runs

`real_academy` in `src-tauri/src/learning/tutorial/real.rs` is an ignored test that spends
tokens. It drives the same calls as the app (`compose_operation` and the gateway, as `ai_start`
does): the outline, every chapter as one staged run, each result saved as the frontend saves it;
with `IGRASP_ACADEMY_SHARE=1` it then shares the tutorial, changes a cited line, runs the local
freshness check and the AI review, applies the proposals and checks again. Run it on a temporary
clone, since sharing writes into the folder:

```sh
IGRASP_ACADEMY_ROOT=<temporary clone> IGRASP_ACADEMY_OUT=<folder> cargo test --manifest-path src-tauri/Cargo.toml real_academy -- --ignored --nocapture
```

Optional: `IGRASP_ACADEMY_SUBJECT`, `IGRASP_ACADEMY_FAMILIARITY`, `IGRASP_ACADEMY_LENGTH`,
`IGRASP_ACADEMY_GAP`, `IGRASP_ACADEMY_MODEL`, `IGRASP_ACADEMY_SHARE=1`.

Measured in this phase with the installed CLI, model `sonnet`:

| Project | Subject / options | Outline | Chapters (staged) | Review | Total |
|---|---|---|---|---|---|
| This repository (Tauri app) | "How a file change on disk reaches the preview and the toasts", contributing, standard | 1 attempt, 13 tool uses, 315 k in / 3.8 k out, $0.35, 36 s | 5 chapters, 40 steps, 2 attempts (1 rejected: a citation that did not check out), 1.57 M in / 30 k out, $1.58, 212 s | After appending a comment to the cited line `watcher.rs:329`: local badge "Maybe outdated (2 of 67)", 2 steps marked; the AI judged every chapter still correct, 0 proposals, 3 missing topics; $0.24, 16 s | 3 AI starts, $2.17 |
| Godot 4 2D platformer demo ([godot-demo-projects](https://github.com/godotengine/godot-demo-projects), sparse clone) | "The big picture", new here, standard | 1 attempt, 12 tool uses, 49 k / 2.7 k, $0.15, 19 s | 4 chapters, 31 steps, 1 attempt each, 378 k / 16 k, $0.56, 110 s | — | 2 starts, $0.71 |
| [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) | "How a request is authenticated", new here, quick, **I'm new to "FastAPI and SQLModel (I know Express and TypeORM)"** | 1 attempt, 14 tool uses, 114 k / 2.6 k, $0.15, 19 s | 3 chapters, 18 steps, 3 attempts (2 rejected: a quick-check question that did not hold), 279 k / 15 k, $0.39, 111 s | — | 2 starts, $0.54 |

An independent read of all 89 steps (40 + 31 + 18) found none generic or partly generic. Five
steps open with a short concept box (Autoload, World2D, Express body parsing, middleware, Axios
interceptors) applied in the next paragraph to cited project lines. About 117 citations were
checked: none points to a missing file or a wrong range, and every spot-it and quick-check answer
is right. Minor slips: one `Sources:` line of a Godot match step that does not support its pairs,
a "16:9" that is 5:3, a `--ignored` that should be `--include-ignored`, and two over-general
"always refetched" claims in chapter 5 of the IGrasp tutorial; the FastAPI tutorial bridges from
Express but never from TypeORM to SQLModel. Of the review's 3 missing topics, the watch status in
the UI is a real gap, the disk revision is real but off the subject, and the ignore files one is
overstated (chapter 1 covers them; the scanner itself is the gap).

- The number of AI starts equals the operations started explicitly, one per step of the run
  (the test asserts it): the outline, the chapters (one staged run, however many chapters), the
  review.
- The review that found nothing to change left the local badge at "Maybe outdated" until the
  tutorial is marked verified, which hashes the ranges again (see Limits).
