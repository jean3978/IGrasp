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
| Large project to open in the app | `node scripts/gen-large-project.mjs [folder]` |
| Lint / format | `npm run lint`, `npm run format`, `npm run rust:fmt`, `npm run rust:clippy` |

## Project structure

- `src-tauri/src/`: `commands/` (IPC commands), `index/` (model, scanner, watcher), `graph/`
  (document graph: parser, slugger, link resolution, build and incremental updates), `search/`
  (Ctrl+T symbols, full-text search, globs), `appdata/` (settings, recents, sessions as JSON),
  `ai/` (AI providers behind one trait and the gateway that requires a user action per
  operation; `providers/claude_cli/` spawns the `claude` CLI), `paths.rs` (root guard), `state.rs`, `error.rs`, `perf.rs` (ignored performance
  tests).
- `src/ipc/`: `types.ts` (the `Backend` interface), `tauri.ts` (the only module that calls
  `invoke`/`listen` or imports `@tauri-apps/*`), `mock/` (in-memory backend + fixture project),
  `generated/` (ts-rs output: never edit by hand).
- `src/stores/`: zustand stores; `eventBridge.ts` routes backend events to them; `session.ts`
  saves and restores per-folder state.
- `src/features/<area>/`: UI by feature, with its CSS next to it. Sidebar views and right-panel
  sections build on `src/components/VirtualRows.tsx` (virtualized rows, keyboard focus).
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
  graph, symbol search and text search live in `mockGraph.ts`, `mockSymbols.ts`, `mockText.ts`.
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
- Colors only through the CSS tokens in `src/styles`; check all three themes.
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
  app-data folder. Only explicit user actions on files (later phases: editing, accepted AI
  edits, quiz "Save as…", sharing a tutorial) write there.
- AI (from Phase 3): no token without a user action. Every AI call goes through the
  single backend gateway, triggered by an explicit IPC request from a user action; never from
  watchers, timers, startup or event handlers. Features use the provider-neutral `AiProvider`
  layer only, never the `claude` CLI directly; Claude is the only provider for now.
- Quiz and tutorials (ADR 0016) are grounded in the whole project: every item cites project
  files, nothing generic, written for developers.
- Keep docs current: `docs/architecture.md`, the `docs/features/` page of the area you touch, an
  ADR in `docs/decisions/` for significant choices, and `CHANGELOG.md` under `[Unreleased]`.
