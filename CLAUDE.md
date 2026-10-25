# CLAUDE.md

Guidance for AI coding sessions working on IGrasp.

## What this is

IGrasp is a Tauri v2 desktop app (Windows + Linux) that shows only the markdown files of a folder
hierarchy, with a reading experience designed to help a human grasp what AI agents write in a
project. Rust backend in `src-tauri/`, React + TypeScript frontend in `src/`. Read
`docs/architecture.md` first.

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Run the app | `npm run tauri dev` |
| Frontend only, mock backend, in a browser | `npm run dev` (http://localhost:1420) |
| Everything a commit must pass | `npm run check` |
| Frontend unit tests | `npm test` (Vitest + jsdom) |
| End-to-end smoke tests | `npm run test:e2e` (Playwright, production build, mock backend) |
| Rust tests | `npm run rust:test` (also regenerates `src/ipc/generated`) |
| Performance tests (10k documents) | `cargo test --release --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture` |
| A real quiz (spends tokens) | `IGRASP_QUIZ_ROOT=<folder> cargo test --manifest-path src-tauri/Cargo.toml real_quiz -- --ignored --nocapture` (also `IGRASP_QUIZ_SUBJECT`, `IGRASP_QUIZ_CUSTOM`, `IGRASP_QUIZ_PATHS`) |
| A real Academy tutorial (spends tokens; may write in the folder) | `IGRASP_ACADEMY_ROOT=<temporary clone> IGRASP_ACADEMY_OUT=<folder> cargo test --manifest-path src-tauri/Cargo.toml real_academy -- --ignored --nocapture` (also `IGRASP_ACADEMY_SUBJECT`, `_FAMILIARITY`, `_LENGTH`, `_GAP`, `_MODEL`, `_SHARE=1`) |
| The quiz subjects of a folder (no AI) | `IGRASP_SUBJECTS_ROOT=<folder> cargo test --manifest-path src-tauri/Cargo.toml print_subjects -- --ignored --nocapture` |
| Large project to open in the app | `node scripts/gen-large-project.mjs [folder]` |
| Lint / format | `npm run lint`, `npm run format`, `npm run rust:fmt`, `npm run rust:clippy` |

## Project structure

- `src-tauri/src/`: `commands/` (IPC commands), `index/` (model, scanner, watcher), `graph/`
  (document graph: parser, slugger, link resolution, build and incremental updates), `search/`
  (Ctrl+T symbols, full-text search, globs), `appdata/` (settings, recents, sessions and
  `conversations.rs`, the AI history per folder, as JSON),
  `ai/` (AI providers behind one trait and the gateway that requires a user action per
  operation; `policy.rs` permission kind → Ask / Allow / Deny, `context.rs` instruction files and
  current file read through the root guard, `estimate.rs` size classes, `no_start.rs` the test
  that only `ai_start` starts an operation; `providers/claude_cli/` spawns the `claude` CLI,
  `providers/mock.rs` is the Rust test provider; `run.rs` validated runs: one operation, capped
  retries announced by `attempt`, and staged runs: several validated runs under one operation,
  `RunPlan::Staged`, `StageBuilder`, `MAX_STAGES`, `AiEvent::Stage`), `profile/` (the project
  profile from a marker table, local),
  `learning/` (corpus and agent files (`corpus::read_text` reads only inside the root), subjects,
  Hoot's tone, `role.rs` the player's role read as a
  family of crafts, `save.rs` the save dialog behind a trait, `quiz/` schema, difficulty, prompt with a snapshot, validator with shared fixtures,
  `compose.rs` the quiz request built in `ai_start`, `file.rs` quiz files; `tutorial/` Hoot's
  Academy: `schema.rs`, `prompt.rs`, `validate.rs`, `compose.rs` (outline, `ChapterStages`),
  `operation.rs` (`compose_operation` for `ai_estimate` and `ai_start`), `cost.rs`,
  `families.rs` (subject cards), `suggest.rs`, `review.rs` (Check with the AI), `markdown.rs`
  (the shared format, owned by Rust), `share.rs` (write plans and atomic writes), `freshness.rs`,
  `progress.rs` (`step_hash`), `repo.rs` (`.git` read as files), `real.rs` (the ignored
  `real_academy` test)), `commands/tutorials.rs` (the Academy's local commands),
  `appdata/learning.rs` (corrections, quiz in progress, history, tutorial progress, suggested
  subjects, tutorial usage per folder), `appdata/tutorials.rs` (one JSON file per private
  tutorial), `paths.rs` (root guard), `state.rs`, `error.rs`, `perf.rs` (ignored performance
  tests).
- `src/ipc/`: `types.ts` (the `Backend` interface), `tauri.ts` (the only module that calls
  `invoke`/`listen` or imports `@tauri-apps/*`), `mock/` (in-memory backend + fixture project),
  `generated/` (ts-rs output: never edit by hand).
- `src/stores/`: zustand stores; `eventBridge.ts` routes backend events to them; `session.ts`
  saves and restores per-folder state. The AI is three stores: `aiProvider.ts` (status,
  capabilities, model), `aiConversation.ts` (items, operation, permissions, history) and
  `aiPanel.ts` (floating panel, draft, context bar, attachment, placement next to a
  selection); `capture.ts` holds the region overlay, the text mode and the selection highlight.
  Learning is `projectProfile.ts`, `quiz.ts` (its `start` is the only quiz call to `aiStart`),
  `academy.ts` (home, cards, library, options, confirmation, generations, review; its `start` is
  the only tutorial call to `aiStart`), `tutorialPlayer.ts` (the open tutorial and the progress)
  and `tutorialWrite.ts` (write plan, confirmation, write), `stepQuestions.ts` (questions saved
  on a step: asked in the chat about a step card, anonymous).
- `src/features/<area>/`: UI by feature, with its CSS next to it. Sidebar views and right-panel
  sections build on `src/components/VirtualRows.tsx` (virtualized rows, keyboard focus).
  `features/ai` is the chat, the AI tools toolbar over the view, the quick actions and the
  inline review; `features/diff` the rendered block diff (two markdown strings in, reused by
  later phases); `features/capture` the text and region selections (source lines, narrowing to
  the highlighted text, highlight; `stepCapture.ts` a step card of the Academy, pointed at or
  asked about as a whole). Selections go to the AI as text, never as images.
  `features/quiz` is the Quiz tab (the new-quiz wizard `QuizWizard.tsx` with `SubjectPicker.tsx`
  and `quizRoles.ts`, engine, cards, `LookUpDialog.tsx`, results, `quizMarkdown.ts`,
  `quizFile.ts`, `effects/`), `features/hoot` the owl (`?hoot=1` shows its states and moments),
  `features/profile` the profile card and dialog. `features/academy` is the Academy tab
  (`AcademyTab`, `AcademyHome`, `TutorialOptions`, `AcademyConfirm`, `AcademyGeneration`,
  `OutlineReview`, `TutorialView`, `CourseMap`, `ChapterPlayer`, `steps/` the ten step types (`Recap.tsx` the end of a chapter),
  `FreshnessPanel`, `ReviewScreen`, `WriteConfirmDialog`, `GraduationScreen`, `StepQuestions`; `academyEngine.ts`
  the XP rules; `tutorialBlocks.ts` the preview's block parser). `src/components/CodeView.tsx`
  is the read-only code view of Look it up, code tours and Spot it.
- `src/features/titlebar/menuActions.ts`: every user action. Menus, toolbar buttons and
  shortcuts (`features/shortcuts/keymap.ts`) dispatch through it.
- `e2e/`: Playwright smoke tests. `scripts/`: the large-project generator. `docs/`:
  architecture, ADRs, feature pages, and one implementation plan per phase in `docs/plan/`.

## IPC conventions

- Paths sent to Rust are **root-relative with `/` separators** (`""` is the root); only
  `open_root` takes an absolute path. Rust resolves them through `RootGuard`.
- Types crossing IPC are Rust structs with `#[derive(Serialize, TS)]`,
  `#[serde(rename_all = "camelCase")]` and `#[ts(export)]`; `cargo test` writes them to
  `src/ipc/generated`, and CI fails if they are out of date. `u64`/`i64` map to `number`.
- Errors are `AppError` → `{ code, message }` → `BackendError` in TypeScript.
- Every scan has a generation; events and listings of an older generation are ignored.
- When adding a command, implement it in Rust, in `ipc/tauri.ts` and in `ipc/mock/` (the mock
  must behave like Rust: it powers the browser dev mode and all frontend tests). The mock's
  graph, symbol search and text search live in `mockGraph.ts`, `mockSymbols.ts`, `mockText.ts`;
  the Academy's in `mockFamilies.ts` and `mockTutorial*.ts` (generation, pool, validator, store,
  markdown writer, freshness, review, share). `window.__igraspMock.addSharedTutorial()` writes a
  shared tutorial to the fake disk (none by default).
- Heading anchors must stay identical between Rust and the preview: `src/test/fixtures/slugs.json`
  and `src/test/fixtures/markdown/headings.json` are asserted by both `cargo test` and Vitest.
  When a markdown fixture changes, update `headings.json` with what the Vitest test receives.
- `cargo test` filtered by name may skip the ts-rs export tests (they are named
  `<module>::export_bindings_*`): run it unfiltered before committing so `src/ipc/generated` is
  current.

## Coding conventions

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). No `any`
  without an `eslint-disable-next-line` comment explaining why.
- Store actions are function-typed properties (not methods), and IPC calls live in stores, not
  components.
- Colors only through the CSS tokens in `src/styles`; check all three themes. The AI chat and
  its tools use the `--ai-*` tokens (the provider's warm accent), the rest of the app its own.
- Rust edition 2024, `unsafe_code` denied, clippy clean with `-D warnings`, errors through
  `AppError`.
- Untrusted markdown: anything new in the preview must keep sanitization before trusted
  generators (ADR 0003) and must never let the webview navigate.

## Workflow

- Conventional Commits, small focused commits that each pass `npm run check`, with a
  `Co-Authored-By:` trailer on AI commits.
- One branch per delivery phase (`phase-1-mvp`, …), merged into `main` and tagged when the phase
  is done. Never push, merge, tag or publish a release without the maintainer asking.
- Nothing the app does on its own may write inside the opened folder; app state lives in the OS
  app-data folder. Only explicit user actions on files (accepted AI edits, quiz "Save as…",
  sharing, saving or updating a tutorial after its confirmation; later, editing) write there.
- AI (from Phase 3): no token without a user action. Every AI call goes through the
  single backend gateway, triggered by an explicit IPC request from a user action; never from
  watchers, timers, startup or event handlers. Features use the provider-neutral `AiProvider`
  layer only, never the `claude` CLI directly; Claude is the only provider for now. No
  provider name or wire-format token in `features/ai`, the AI stores, `ipc` or the mock
  (`neutrality.test.ts` scans them): labels come from the provider status.
- The frontend never builds a provider's tool input. Accepting part of an edit sends the neutral
  `Allow { updatedEdit }` (accepted hunks, or the composed content of a whole-file write); the
  provider maps it (`protocol::tool_input_for`). Permission kinds are classified by the provider
  and decided by `ai/policy.rs` from `settings.ai.permissions`.
- The mock AI provider (`src/ipc/mock/mockAi.ts`) must behave like the Rust one: same events,
  same policy. Its instruction-file name is `AGENTS.md` (the fixture has one at the root and in
  `docs/`), so the context bar can be tested without a provider name.
- Quiz and tutorials (ADR 0016) are grounded in the whole project: every item cites project
  files, nothing generic (an industry standard only as this project applies it), written for the
  player's role (developers by default). The wizard's role, kind of quiz and subject all reach
  the prompt; what a role is offered comes from its family (`learning/role.rs` and
  `quizRoles.ts`, which must agree on `src/test/fixtures/quiz/roles.json`).
- Learning prompts and schemas live in Rust (`learning/`); the frontend never sends a prompt for a
  quiz, only a `QuizGenerationInput`. Agent instruction files are context, never cited. Hoot's
  lines are local (`hootLines.ts`). The validator's rules exist twice (`validate.rs` and
  `mockQuizValidate.ts`) and must agree on `src/test/fixtures/quiz/`. Replays (Play again, quiz
  files) never call the AI. The quiz file conventions (ADR 0024) are shared with the tutorials.
- Tutorials: the frontend sends only a `TutorialRequest`; Rust owns the tutorial format
  (`markdown.rs`, ADR 0025) and the mock's writer (`mockTutorialMarkdown.ts`) must produce the
  same bytes on `src/test/fixtures/tutorial/format/<case>/` (`IGRASP_UPDATE_FIXTURES=1 cargo test`
  regenerates them from Rust). The validators agree on `src/test/fixtures/tutorial/cases/`, the
  step hashes (`stepHash` in `src/lib/tutorial.ts`, `progress::step_hash`) on `step-hashes.json`,
  and the XP rules (`academyEngine.ts`) are pinned by `xp.json`. Chapters are one staged run;
  reading, freshness, sharing and verifying never call the AI, and the AI never sets the
  verification.
- Writes in the opened folder from the learning features go only through
  `save_quiz_markdown` after the save dialog, and, for the Academy, through `write_tutorial`
  after `plan_tutorial_write` and the write confirmation that lists the files; the frontend never
  passes a path (only the `relPath` of an existing shared README).
- Keep docs current: `docs/architecture.md`, the `docs/features/` page of the area you touch, an
  ADR in `docs/decisions/` for significant choices, and `CHANGELOG.md` under `[Unreleased]`.
