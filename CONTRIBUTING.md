# Contributing to IGrasp

Thanks for your interest! This guide explains how to build, run and test IGrasp, and how changes
are committed.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 24.15 (or ≥ 22.22.2) | Enforced by `engines` + `engine-strict`. |
| npm | ≥ 11 | |
| Rust | stable (≥ 1.90) | Installed with [rustup](https://rustup.rs). `rust-toolchain.toml` selects the channel. On Windows use the MSVC toolchain. |
| Windows | Microsoft C++ Build Tools ("Desktop development with C++"), WebView2 (preinstalled on Windows 11) | Building the MSI locally also needs the VBScript optional feature. |
| Linux | `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` | Plus `patchelf xdg-utils` to build the AppImage. |

## Build and run

```sh
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # build installers into src-tauri/target/release/bundle
```

`npm run dev` starts only the web frontend in a browser, backed by an in-memory mock of the Rust
backend (useful for UI work and used by the end-to-end tests).

## Checks

Every commit must pass:

```sh
npm run check
```

It runs, in order: `typecheck`, `lint` (ESLint, no warnings allowed), `format:check` (Prettier),
`test` (Vitest), `rust:fmt -- --check`, `rust:clippy` (`-D warnings`) and `rust:test`.

Useful individual commands:

| Command | What it does |
|---|---|
| `npm run lint:fix` / `npm run format` | Fix lint issues / format TypeScript, CSS, JSON and YAML. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run test:e2e` | Playwright smoke tests against the production build with the mock backend (run `npx playwright install chromium` once). |
| `npm run rust:fmt` | Format the Rust code. |
| `cargo test --release --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture` | Performance checks on a generated 10,000-document project, with the budgets of the phase 2 plan. |
| `node scripts/gen-large-project.mjs [folder]` | Writes the same large project to open in the app. |

## Manual checks before a release

Automated tests use the mock backend in Chromium; these need the real app on **Windows 11** and
**Ubuntu 22.04** (or newer):

- [ ] Open a large project (`scripts/gen-large-project.mjs`): the tree, the graph (status bar
      broken count) and Ctrl+T / Ctrl+Shift+F stay responsive; note the timings.
- [ ] `Alt+←` / `Alt+→` and the mouse back / forward buttons move through the history and never
      navigate the webview (check GNOME and KDE on Linux).
- [ ] Open in Default Editor opens a `.rs` or `.md` file, and refuses `.exe`, `.bat`, `.sh`, `.js`
      with a message; Reveal in File Manager works in Explorer and Nautilus.
- [ ] Edit a linked file outside the app: links in the open document are flagged or unflagged,
      the Broken Links view and backlinks update, and the code viewer offers Reload.
- [ ] High Contrast: search highlights, broken-link underlines and focus rings are clearly
      visible.
- [ ] Video playback (Linux needs the GStreamer packages) and the "Open externally" fallback.

## Commit convention

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`,
  `refactor:`, `test:`, `chore:`, `ci:` (optionally scoped, e.g. `feat(backend): …`).
- Small, focused commits, one logical change each, and every commit builds and passes the checks.
- Explain *why* in the body when it is not obvious.
- Commits written with an AI assistant carry a `Co-Authored-By:` trailer naming it.

## Branches and releases

- One branch per delivery phase (`phase-1-mvp`, `phase-2-navigation`, …), merged into `main` when
  the phase is done and tagged (`v0.1.0` for phase 1, `v0.2.0` for phase 2, …).
- Release builds are produced by the `build` workflow when a `v*` tag is pushed. The workflow creates
  a **draft** release; a maintainer reviews and publishes it.

## Documentation

IGrasp documents itself in markdown so it can be read with IGrasp:

- `docs/architecture.md`: the overall architecture.
- `docs/decisions/`: Architecture Decision Records, one per significant choice.
- `docs/features/`: one page per feature area, updated together with the code.
- `CHANGELOG.md`: updated under `[Unreleased]` with every user-visible change.

## Pull request checklist

- [ ] `npm run check` passes.
- [ ] Docs and changelog updated.
- [ ] Tested on Windows and Linux (or say which one you could not test).
