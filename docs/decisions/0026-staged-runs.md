# 0026 — Staged runs: several validated runs under one user action

- Status: Accepted
- Date: 2026-10-25

## Context

A tutorial is written in two steps (ADR 0025): an outline, then its chapters. The outline is one
validated run (ADR 0022). The chapters are several provider calls: one per chapter, each checked
by its own validator, each with its own repairs. The specification wants the chapters to arrive
one after the other after a single consent, so the reader can start chapter 1 while the next ones
are written.

The gateway's rule (ADR 0015) is one user action, one bounded operation, and nothing else
starts a provider. Writing four chapters must therefore be one operation the user authorized
with one click, bounded before it starts, and cancellable at any moment.

Two other shapes were possible:

- **A click per chapter**, as the quiz's adaptive rounds. Each chapter would need its own
  confirmation card and its own wait. Reading chapter 1 while chapter 2 is written would need
  the user to come back and click. The path exists anyway, for one chapter: **Write it** on an
  unwritten chapter of the course map, and **Write this chapter** for a missing topic.
- **One large call for every chapter.** It would lose the per-chapter validation and repair
  (a single rejected step would send the whole tutorial back), the early reading, and a bounded
  cost per call.

## Decision

- **A staged run** (`ai/run.rs`) is several validated runs, one after the other, under **one
  operation id**. The gateway's `start` takes a `RunPlan`: `Validated(validator)` (one validated
  run) or `Staged(builder)`. Only `AiGateway::start` starts either (`ai/no_start.rs` scans for
  it).
- **A `StageBuilder`** says how many stages the run has (`stages()`, fixed when it starts) and
  builds stage `n` (`next(n, accepted)`): the request, its validator and a label shown to the
  user, given the accepted outputs of the stages before it. A plan of 0 stages or more than
  **`MAX_STAGES` = 8** (an outline's maximum number of chapters) is refused.
- **Events.** `AiEvent::Stage { number, of, label }` announces each stage ("Chapter 2 of 4: …").
  Each stage's events pass through (`attempt`, `toolUse`, `usage`, …); its `structuredOutput` is
  emitted as it is, so the frontend saves the chapter at once and the reader can open it. The
  stage's own `done` is swallowed; **exactly one `done`** ends the run.
- **Failure and cancel.** Each stage keeps the validated run's capped retries (at most two
  repairs, announced by `attempt`). A stage that fails (its validator gave up, or the provider
  failed) **ends the run** with `done(Failed)`; the chapters written so far stay saved. Cancel
  stops the current stage and prevents the next.
- **The tutorial's builder** (`ChapterStages` in `learning/tutorial/compose.rs`) writes the
  chapters the user ticked, in the order given. Each stage is a **fresh prompt** with the
  accepted outline, the chapter's goal and key sources, and the **recaps of the chapters already
  written** (in the saved tutorial or accepted earlier in this run), so a chapter does not repeat
  another. The provider's resume is used only for repairs inside a stage. A repeated or
  out-of-range chapter index is refused when the plan is composed.
- **The confirmation card** says the number of calls: "4 calls in one operation, one chapter at
  a time", with the cost line of the folder's last comparable operation (or the range measured
  by the proof of concept).
- **Plan review, question 2** (one staged run versus a click per chapter versus one large call):
  answered as recommended, a staged run. **Question 3** (a fresh prompt per chapter with the
  recaps, versus continuing the outline's conversation): answered as recommended, fresh; it
  bounds the cost per chapter, lets a chapter be written in any order or again later, and the
  proof of concept measured the same cost range for both. **Question 4** (a failed stage stops
  the run, versus continuing with the next chapters): answered as recommended, stop; a project
  that lacks material for chapter 2 is unlikely to have it for chapter 3, and the user keeps
  the written chapters and may write the rest with a new click.

## Consequences

- One click authorizes at most eight chapters, each bounded by its retries; the user sees the
  stage, the attempts and the files read, and can stop at any moment.
- The usage line sums the stages and attempts; the tutorial records each operation's usage, and
  the folder keeps the last 20 for the cost line.
- A stage cannot start without the operation the user started, and nothing continues after the
  run's `done`. Unit tests with the Rust mock provider cover the order of the stages under one
  operation, a failed stage, a cancel, and the bound.
- Phase 6 and later can reuse staged runs for any sequence of checked calls that one user action
  authorizes.
