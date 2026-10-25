# 0022 — Grounded generation pipeline with validated runs

- Status: Accepted
- Date: 2026-10-25

## Context

A quiz question is only useful if it is true for this project and points at the file that proves
it (ADR 0016). Models invent plausible line numbers, cite files that do not exist, drift into
generic trivia, or cite the instruction files written for agents. The checks must be done by the
app, the retries must stay within one user action (ADR 0015: no token without a user action,
retries capped and visible), and the frontend must stay provider-neutral.

## Decision

- **The app owns the prompt and the schema.** `learning/quiz/prompt.rs` writes a
  provider-neutral prompt (the profile, the subject, the scope, the difficulty plan, Hoot's tone,
  the grounding rules) and `learning/quiz/schema.rs` a JSON schema of the answer. The frontend
  sends only a `QuizGenerationInput` (subject, count, mode, scope, exclusions); it never sends a
  prompt for a quiz. The request is composed in Rust in `ai_start` (`learning/quiz/compose.rs`).
- **An audience from the role.** The wizard's role sets the prompt's audience: developers (and
  roles that write code) by default; other roles get questions about how their work fits into
  the project, in plain words, with a focus per common role (artists, sound, level and game
  designers, producers, QA, writers). The grounding rules do not change with the role.
- **Role, kind and subject together.** The role is read as a family (`learning/role.rs`, mirrored
  in `quizRoles.ts` on a shared fixture). The wizard offers the kinds of quiz and ranks the
  subjects for that family (no code check for a role that does not read code); the prompt names
  the kind and asks only what this role needs to know about this subject. Industry-standard
  concepts and processes are allowed when the answer depends on how the project applies them
  (at most about a third of the questions); a definition alone stays invalid.
- **Documentation gaps are a result.** The schema's optional `docsNote` reports what the
  project's documentation lacks for the subject and the reader; it is kept in the quiz record
  apart from `materialNote` (too little material) and shown with the results.
- **Two question styles.** Proposed subjects (global concepts and features) and typed subjects
  ask for understanding: concepts, implementation, collaboration between parts, trade-offs, and
  explicitly not one-line trivia. A code check (`SourceScope::Paths`, files or folders) asks for
  precise, line-level questions on that code only. The style is a block of the app's prompt,
  chosen by the scope, never by the frontend.
- **Structured output is a neutral event.** A provider maps its structured answer to
  `AiEvent::StructuredOutput(Value)`; the Claude CLI's `result.structured_output` is mapped in
  `protocol.rs` and its internal tool call is hidden. A provider without structured output
  falls back to the last text block parsed as JSON.
- **Typed validation** (`learning/quiz/validate.rs`): every question must parse into the typed
  struct, have a valid answer index and distinct choices (a right choice half as long again as every wrong
  one and 20 characters longer gives itself away and is rejected), cite at least one file that exists in
  the corpus (never an agent instruction file, never a secret), with a line range inside the file
  for text files (at most 120 lines, inside the file), respect the scope (Documentation only cites
  markdown only), not be a duplicate of an earlier question, not give the answer away in its
  hint, and not be **generic**: the question must name something of the project (a path or file
  name of the corpus, a module, the project's name, or a distinctive word of the cited lines,
  after removing a shared list of stop words). Each rejection has a code (`Rejection`) and a
  message for the model. The same rules run in the mock (`mockQuizValidate.ts`) against shared
  JSON fixtures (`src/test/fixtures/quiz/`).
- **Validated runs** (`ai/run.rs`): one gateway operation may make up to 3 attempts (2 retries)
  when not enough questions pass. A retry resumes the attempt's conversation with a repair prompt
  that lists the kept questions and the rejection reasons; each retry is announced with
  `AiEvent::Attempt` and shown on the generation screen; cancelling stops between attempts as
  well as during one. When the cap is reached, the questions that passed are kept if there are
  enough, else the run fails with the reasons. Only `AiGateway::start` starts a run.
- **Adaptive order over a fixed pool**: a fixed quiz is written in one call and the engine
  (`quizEngine.ts`) orders it by the player's level; an adaptive quiz writes rounds of 5 at the
  current level, each round started only by the player's **Next round** click.

## Consequences

- Questions cite real lines of real files; a rejected attempt costs a visible retry rather than
  a wrong question. Real runs on this repository accepted every question at the first attempt.
- Generation takes one call per quiz (or per round), never one per question.
- The prompt, schema and validator are the shared base of Phase 5's tutorial generator.
- The validator is conservative: a correct question with an unusual citation (a file outside the
  corpus caps) can be rejected; the repair prompt usually recovers it.
