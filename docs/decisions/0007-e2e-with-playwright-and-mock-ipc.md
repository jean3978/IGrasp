# 0007 — End-to-end tests with Playwright and a mock backend

- Status: Accepted
- Date: 2026-10-23

## Context

Each phase needs a few end-to-end smoke tests. Playwright cannot drive the system webviews
Tauri uses (WebView2 on Windows, WebKitGTK on Linux), and `tauri-driver` (WebDriver) only
supports Linux and Windows partially, with slow and flaky setups in CI.

## Decision

- The frontend talks to the backend only through the `Backend` interface (`src/ipc/types.ts`).
  It has two implementations: real Tauri IPC, and an **in-memory mock** with a fixture project
  (`src/ipc/mock/`), chosen at startup by the presence of the Tauri runtime.
- The mock follows the Rust behavior closely: markdown-only index with ignore rules, generations,
  `index://` and `fs://` events, sessions, settings normalization. Tests drive it through
  `window.__igraspMock` (write, delete or rename files, emit events).
- Playwright runs against the **production build** (`vite build` + `vite preview`) in Chromium,
  on Windows and Linux CI runners. The suite covers the splash and welcome screen, the tree
  rules, rendering (code, math, alerts), Mermaid, themes, a keyboard-only path, live reload with
  grouped toasts, and deleted files.
- The Rust side is covered by `cargo test` (index, scanner, watcher classification, app data,
  path guard), and real builds are checked manually before a release (checklist in
  CONTRIBUTING).

## Consequences

- The whole UI is testable quickly and deterministically, and the app runs in a plain browser
  for UI work (`npm run dev`).
- Behavior that only exists in the real webview (asset protocol, CSP, native dialogs, window
  chrome, WebKitGTK media support) is not covered automatically. A `tauri-driver` job can be
  added later for Linux.
- The mock must be kept in step with the Rust commands; both implement the same TypeScript
  interface, and the event payload types are generated from Rust.
