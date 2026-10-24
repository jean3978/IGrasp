# CLAUDE.md

Guidance for AI coding sessions working on IGrasp.

## What this is

IGrasp is a Tauri v2 desktop app (Windows + Linux) that shows only the markdown files of a folder
hierarchy, with a reading experience designed to help a human grasp what AI agents write in a
project. Rust backend in `src-tauri/`, React + TypeScript frontend in `src/`.

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Run the app | `npm run tauri dev` |
| Frontend only, mock backend, in a browser | `npm run dev` |
| Everything a commit must pass | `npm run check` |
| Frontend tests | `npm test` (Vitest) |
| Rust tests | `npm run rust:test` |
| Lint / format | `npm run lint`, `npm run format`, `npm run rust:fmt` |

## Conventions

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). No `any` without an
  `eslint-disable-next-line` comment explaining why.
- Rust edition 2024, `unsafe_code` denied, clippy clean with `-D warnings`.
- Conventional Commits, small focused commits, `Co-Authored-By:` trailer on AI commits.
- One branch per delivery phase (`phase-1-mvp`, …). Never push, merge to `main`, tag or publish a
  release without the maintainer asking.
- Nothing the app does may write inside the opened folder. App state lives in the OS app-data folder.

## Docs to keep up to date

- `docs/architecture.md` when components, IPC or data flow change.
- `docs/features/*.md` for the feature area you touch.
- `docs/decisions/NNNN-*.md`: add an ADR for any significant choice.
- `CHANGELOG.md` under `[Unreleased]`.
