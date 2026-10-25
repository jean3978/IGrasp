# 0021 — Project profile detected locally from a marker table

- Status: Accepted
- Date: 2026-10-25

## Context

The quiz (Phase 4) and tutorials (Phase 5) must be about **this** project (ADR 0016). A
generator that does not know whether it is looking at a Godot game, a Rust CLI or a React app
writes vague questions, and asking the AI to find out would spend tokens on every quiz, before
the user has asked for anything. IGrasp opens projects of any kind, on any engine or framework.

## Decision

- A **project profile** (`src-tauri/src/profile/`) is built **locally, without AI or network**,
  from one bounded walk of the open folder that follows the scan's ignore rules (gitignore,
  dotfolders, the user's patterns): kinds (game, web frontend, CLI, ...), engines with their
  versions, frameworks, languages by share of bytes, top-level modules with a role, build, test
  and CI setup, and the main documents.
- Detection is a **marker table** (`profile/markers.rs`): file names, extensions and manifest
  keys (`project.godot`, `*.uproject`, `ProjectSettings/ProjectVersion.txt`, `Cargo.toml`
  `[[bin]]`, `package.json` dependencies, ...) mapped to what they prove, each with a
  confidence and the files kept as evidence. Manifests are parsed with real parsers (TOML, JSON),
  never executed.
- Adding an ecosystem is a table row plus a **fixture** project in `profile/tests.rs`; the
  repository itself is a dogfooding fixture.
- The walk has budgets (files, depth, bytes read) and reports `truncated` instead of slowing
  down. The profile is cached per folder until the watcher reports a change.
- The user sees the profile (quiz home, Settings → Learning) and **corrects** it: remove or add
  kinds, engines and frameworks, and write free notes for the generators. Corrections are stored
  per folder in app data (`learning/<folder>.json`), never in the folder.
- Subject proposals (`learning/subjects.rs`) are derived from the profile and the corpus, also
  without AI.

## Consequences

- Opening the Quiz tab costs nothing; the first token is spent only when the user confirms a
  generation, and every generation receives the profile, so prompts stay short and specific.
- The profile is only as good as the table: an unknown ecosystem shows as languages and modules
  only until a row is added. Corrections cover the gap meanwhile.
- Binary assets (Unreal `.uasset`, Unity scenes in binary mode) are known by name and place,
  never by content.
- Phase 5 (tutorials) reuses the profile, the subjects and the corrections unchanged.
