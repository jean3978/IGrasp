# Phase 1 — MVP implementation plan

Status: **proposed** (awaiting review) · Target tag: `v0.1.0` · Branch: `phase-1-mvp`

IGrasp is a Tauri v2 desktop app (Windows + Linux) that shows only the markdown
files of a folder hierarchy, with a reading experience designed to help a human
grasp what AI agents are writing in a project. Phase 1 builds the foundation and
the read-only viewer. Nothing in this phase writes inside the opened folder.

---

## 1. Scope

### 1.1 In scope (definition of done)

| Area | Deliverable |
|---|---|
| Open folder | Pick a folder with the system dialog; remember it in "Open Recent" (max 10, MRU, remove entry, missing-folder detection). |
| File tree | Markdown-only hierarchy (`.md`, `.markdown`, case-insensitive); folders without markdown descendants hidden; `.gitignore` respected; `.git` and `node_modules` always skipped; "show hidden" toggle; background index with progress; lazy loading per folder; virtualized rendering; smooth at 10k+ files. |
| Preview | GFM (tables, task lists, footnotes, strikethrough, autolinks), GitHub alerts (`> [!NOTE]` …), Shiki code highlighting, KaTeX math, YAML front matter as a header card, images and videos (relative paths and URLs) with a video fallback card and "Open externally", HTML sanitization, anchor links, external links in the system browser. |
| Mermaid | Diagrams rendered with `securityLevel: 'strict'`; per-diagram toolbar: zoom in/out, pan, fit, reset, full screen, copy source. |
| Tabs | VS Code behavior: single click = preview tab (reused), double click = pinned; close, switch, middle-click close, keyboard. |
| Live reload | Open files refresh when changed on disk, keeping scroll position; deleted files show a banner. |
| Toasts | Added (green) / modified (blue) / deleted (red); grouped toast when many files change, clickable to list them; mute toggle in View menu and Settings. |
| Themes | Light, Dark, High Contrast, Follow System; toolbar button. |
| Branding | SVG logo, generated app icons, animated in-app splash (CSS, never blurry, respects reduced motion). |
| Settings | Theme, font size, reading width, toast muting, extra ignore patterns. Stored in app data. |
| Session restore | Per folder: open tabs, pinned state, active tab, scroll positions, expanded folders, sidebar width/visibility. Window size/position restored. |
| Accessibility | Full keyboard navigation (tree, tabs, menus, dialogs, toolbar), visible focus, ARIA roles, contrast checked in all themes. |
| Repo & CI | All community files, docs structure, CI on Windows + Linux (lint, tests), installer builds (NSIS, MSI, AppImage, .deb). |

### 1.2 Explicitly out of scope (later phases)

Search (Ctrl+T, Ctrl+Shift+F), recent-changes view, back/forward history, outline
panel, full internal-link resolution and broken-link detection, backlinks, code
file viewer, editing, file management, edit conflicts, all git features, Claude,
quiz, Mermaid visual editor, Mermaid SVG/PNG export, remappable shortcuts.
Phase 1 reserves the shortcuts those features will use (see §12.6) so nothing
has to be rebound later.

---

## 2. Prerequisites and toolchain

Verified on the development machine on 2026-10-23: Node 24.7.0 and npm 11.5.1
are installed; **Rust is not installed**; Python is not installed (not needed).

| Tool | Requirement | Why |
|---|---|---|
| Rust (stable, MSVC on Windows) | `winget install --id Rustlang.Rustup`, then `rustup default stable-msvc` | Tauri 2.12 requires Rust ≥ 1.90; pinned by `rust-toolchain.toml` (`channel = "stable"`). |
| Microsoft C++ Build Tools | "Desktop development with C++" workload | Linker and Windows SDK for the Rust MSVC target. |
| WebView2 | Preinstalled on Windows 11 | App runtime. |
| VBScript (optional feature) | Only to build the MSI locally | WiX `light.exe` needs it. |
| Node.js | **≥ 24.15** (or ≥ 22.22.2) | `jsdom@30` (Vitest DOM env) requires it. Update the local Node 24.7 before starting. `engines` in `package.json` enforces it. |
| npm | ≥ 11 | Lockfile v3; `.npmrc` sets `save-exact=true`. |
| Linux build deps | `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` (+ `patchelf xdg-utils` for bundling) | Tauri v2 prerequisites. |

Package manager: **npm** (no extra install, works identically on CI runners).
Tauri CLI is used through the npm package `@tauri-apps/cli` (`npm run tauri …`),
so no global `cargo install tauri-cli` is needed.

---

## 3. Project scaffolding

### 3.1 Repository layout

```
IGrasp/
├─ .editorconfig
├─ .gitattributes
├─ .gitignore                      (exists)
├─ .npmrc                          save-exact=true, engine-strict=true
├─ .prettierrc, .prettierignore
├─ eslint.config.js                flat config
├─ package.json, package-lock.json
├─ tsconfig.json, tsconfig.app.json, tsconfig.node.json
├─ vite.config.ts, vitest.config.ts, playwright.config.ts
├─ rust-toolchain.toml
├─ CLAUDE.md, README.md, LICENSE, CONTRIBUTING.md, SECURITY.md, CHANGELOG.md
├─ .github/
│  ├─ ISSUE_TEMPLATE/bug_report.yml, feature_request.yml, config.yml
│  ├─ PULL_REQUEST_TEMPLATE.md
│  ├─ dependabot.yml
│  └─ workflows/ci.yml, build.yml
├─ .vscode/extensions.json, settings.json
├─ assets/branding/                igrasp.svg, igrasp-mono.svg, splash.svg (sources)
├─ docs/
│  ├─ architecture.md
│  ├─ decisions/0001-… .md
│  ├─ features/*.md
│  ├─ plan/phase-1.md              (this file)
│  └─ screenshots/                 (filled at the end of the phase)
├─ e2e/                            Playwright smoke tests
├─ src/                            React frontend (see 3.2)
└─ src-tauri/                      Rust backend (see 3.3)
```

### 3.2 Frontend layout (`src/`)

```
src/
├─ main.tsx                        React root, providers, mock-IPC switch
├─ App.tsx                         Splash → Welcome | Workspace
├─ vite-env.d.ts
├─ ipc/
│  ├─ client.ts                    typed command wrappers (invoke) — the ONLY place that calls invoke
│  ├─ events.ts                    typed event subscriptions (listen) → store dispatch
│  ├─ generated/                   TS types exported by ts-rs from Rust (committed, CI-checked)
│  └─ mock/                        in-memory backend for browser dev + Playwright
├─ stores/                         zustand stores (pure TS, unit-tested)
│  ├─ workspace.ts  tree.ts  tabs.ts  documents.ts  toasts.ts  settings.ts  session.ts
├─ features/
│  ├─ splash/        SplashOverlay, logo animation
│  ├─ welcome/       WelcomeScreen, RecentFolders
│  ├─ shell/         WorkspaceLayout, Sidebar, StatusBar, Toolbar, ThemeMenu
│  ├─ explorer/      ExplorerPanel, FileTree, TreeRow, ExplorerToolbar
│  ├─ tabs/          TabBar, Tab, TabContextMenu, EmptyState
│  ├─ preview/       MarkdownPreview, useMarkdown, pipeline/ (unified setup, sanitize schema,
│  │                 shiki, katex, alerts, frontmatter), components/ (Img, Video, Link, Pre,
│  │                 FrontMatterCard, Alert, TaskCheckbox), DeletedBanner
│  ├─ mermaid/       MermaidBlock, MermaidToolbar, MermaidFullscreen, mermaidRuntime
│  ├─ toasts/        ToastHost, Toast, GroupedToastDetails
│  ├─ settings/      SettingsTab, sections
│  ├─ shortcuts/     keymap.ts, useGlobalShortcuts, ShortcutsReferenceTab
│  ├─ menu/          menuActions.ts (shared by native menu events, buttons, shortcuts)
│  └─ about/         AboutDialog
├─ components/ui/                  Button, IconButton, Menu, Dialog, Tooltip, Switch, Select,
│                                  VisuallyHidden (thin wrappers over radix-ui)
├─ styles/
│  ├─ tokens.css                   semantic variables (--bg, --fg, --accent, --border, …)
│  ├─ themes/light.css dark.css high-contrast.css
│  ├─ base.css                     reset, focus ring, scrollbars, reduced-motion
│  └─ markdown.css                 .markdown-body (GitHub-like), alerts, katex, shiki vars
├─ lib/                            paths.ts, debounce.ts, platform.ts, format.ts
└─ test/                           setup.ts, fixtures/markdown/*.md, helpers
```

### 3.3 Backend layout (`src-tauri/`)

```
src-tauri/
├─ Cargo.toml, Cargo.lock, build.rs
├─ tauri.conf.json
├─ capabilities/default.json
├─ icons/                          generated by `tauri icon`
└─ src/
   ├─ main.rs                      calls igrasp_lib::run()
   ├─ lib.rs                       Builder: plugins, state, menu, commands, setup
   ├─ error.rs                     AppError (thiserror) → serialized { code, message }
   ├─ state.rs                     AppState { workspace: RwLock<Option<Workspace>>, appdata: AppData }
   ├─ paths.rs                     RootGuard: canonicalize (dunce), rel↔abs, containment checks
   ├─ commands/
   │  ├─ mod.rs  workspace.rs (open/close root, list_dir)  files.rs (read_markdown, open_external)
   │  └─ appdata.rs (settings, recent, session)
   ├─ index/
   │  ├─ model.rs                  Index, DirNode, FileMeta, diff
   │  ├─ scanner.rs                ignore::WalkBuilder parallel scan, progress, cancellation
   │  └─ watcher.rs                notify-debouncer-full, event classification, re-walk, batching
   ├─ appdata/
   │  ├─ mod.rs                    atomic JSON file store, versioning, corruption recovery
   │  ├─ settings.rs  recent.rs  session.rs
   └─ menu.rs                      native menu bar, emits "menu://action"
```

### 3.4 Configuration decisions

- **TypeScript 5.9.3, strict**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `moduleResolution: bundler`. TypeScript 7 is current but
  `typescript-eslint` only supports `< 6.1`, so 5.9 is pinned (see risks).
- **Vite 8** (`@vitejs/plugin-react` 6 requires it), dev server fixed on port 1420,
  `clearScreen: false`, `envPrefix: ['VITE_', 'TAURI_ENV_']`, build target
  `chrome105` on Windows / `safari17` on Linux (Mermaid 12 ships ES2024 code; see risks).
- **ESLint 10 flat config**: `typescript-eslint` (type-checked rules), `react-hooks`,
  `react-refresh`, `eslint-config-prettier`. `no-explicit-any: error` (a comment
  with `eslint-disable-next-line` explains any exception). `eslint-plugin-jsx-a11y`
  does not yet declare ESLint 10 support, so accessibility is verified by tests
  and manual audit instead (re-evaluate when it updates).
- **Prettier**: `printWidth 100`, `singleQuote`, `trailingComma all`, LF.
- **Rust**: edition 2024, `rustfmt` default, `clippy` with `-D warnings` in CI,
  `#![deny(unsafe_code)]`.
- **npm scripts**: `dev`, `build`, `tauri`, `typecheck`, `lint`, `lint:fix`, `format`,
  `format:check`, `test` (vitest run), `test:watch`, `test:e2e`, `rust:fmt`,
  `rust:clippy`, `rust:test`, and `check` = typecheck + lint + format:check + test +
  rust:fmt --check + rust:clippy + rust:test. Every commit must pass `npm run check`.
- `.vscode/extensions.json` recommends rust-analyzer, Tauri, ESLint, Prettier;
  `settings.json` enables format-on-save with Prettier and rustfmt.

---

## 4. Repository and community files

| File | Content |
|---|---|
| `README.md` | Starts with `> [!IMPORTANT]` stating that **IGrasp is AI-generated and conscientiously prompted**: the point is not to learn how to build it (it is a disposable app) but to understand the structure of big, long-term projects. Then: one-paragraph pitch, screenshots/GIF (placeholder until the UI exists), features, download/installation (links to GitHub Releases), requirements (WebView2 on Windows; WebKitGTK 2.44+ and GStreamer packages `gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav gstreamer1.0-gl` on Linux; Claude CLI for Claude features, from Phase 5), build from source, keyboard shortcuts, roadmap (7 phases with status checkboxes), license. Title fixed to "IGrasp" (currently "IGrasph", see §17). |
| `LICENSE` | MIT, "Copyright (c) 2026 Jean-Rene Choiniere". |
| `CONTRIBUTING.md` | Prerequisites, `npm install`, `npm run tauri dev`, `npm run check`, test commands, Playwright, commit convention (Conventional Commits, `Co-Authored-By` trailer for AI commits), branch-per-phase workflow, PR checklist. |
| `SECURITY.md` | Supported versions (latest release), private reporting via GitHub Security Advisories, response expectations, scope notes (local app, no network services). |
| `CHANGELOG.md` | Keep a Changelog format; `[Unreleased]` during the phase, `[0.1.0]` at the end. |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Form: version, OS, steps, expected/actual, logs path (`app data/logs`). |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Problem, proposal, alternatives. `config.yml`: `blank_issues_enabled: false`. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Summary, type, checklist (`npm run check`, docs updated, tested on Windows/Linux). |
| `.github/dependabot.yml` | Weekly updates for `npm`, `cargo`, `github-actions`, grouped minor/patch. |
| `.editorconfig` | UTF-8, LF, final newline, 2 spaces (TS/JSON/CSS/MD/YAML), 4 spaces for `*.rs`, CRLF for `*.bat`/`*.cmd`. |
| `.gitattributes` | `* text=auto eol=lf`, `*.bat text eol=crlf`, `*.cmd text eol=crlf`, binaries (`png ico icns webp mp4 gif woff2`) as `binary`, `package-lock.json`/`Cargo.lock` `-diff` optional, `docs/screenshots/** binary`. |
| `CLAUDE.md` | Build/test/lint commands, project structure, IPC conventions (rel paths, camelCase, ts-rs), coding conventions (strict TS, no `any`, zustand stores, Rust error handling), docs to keep updated, phase workflow (branch per phase, plan → implement → verify → tag). |
| `docs/architecture.md` | Backend/frontend/IPC/data flow with Mermaid diagrams (component diagram, sequence for open folder → scan → tree, sequence for watcher → toast/live reload). |
| `docs/decisions/` | ADRs listed in §16. |
| `docs/features/` | `file-tree.md`, `markdown-preview.md`, `mermaid.md`, `tabs-and-session.md`, `live-reload-and-toasts.md`, `themes-and-settings.md`, `branding-and-splash.md`, `keyboard.md`. |

---

## 5. Continuous integration

### 5.1 `ci.yml` — lint and tests (push + pull_request)

| Job | Runner | Steps |
|---|---|---|
| `lint` | ubuntu-24.04 | setup-node 24 (npm cache) → `npm ci` → `typecheck`, `lint`, `format:check` → dtolnay/rust-toolchain stable + Swatinem/rust-cache → `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` → `cargo test` then `git diff --exit-code src/ipc/generated` (ts-rs bindings in sync). |
| `test` | matrix: ubuntu-22.04, windows-latest | Linux: apt Tauri deps. `npm ci` → `vitest run --coverage` → `cargo test` → `npx playwright install --with-deps chromium` → `vite build` → Playwright smoke suite (mock IPC) → upload `playwright-report` on failure. |
| `build-check` | matrix: ubuntu-22.04, windows-latest | `npm run tauri build -- --no-bundle` (compiles the real app, no installers) to catch platform-specific Rust breakage fast. |

`RUSTFLAGS: -D warnings` and `CARGO_TERM_COLOR: always` as workflow env. Concurrency
group per ref with cancel-in-progress. Pinned action majors: `actions/checkout@v4`,
`actions/setup-node@v4`, `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2`.

### 5.2 `build.yml` — installers

Triggers: `workflow_dispatch`, push of tags `v*`. Matrix `ubuntu-22.04` (AppImage,
.deb — 22.04 for glibc compatibility) and `windows-latest` (NSIS, MSI). Uses
`tauri-apps/tauri-action@v1`. On tag: creates a **draft** release (`releaseDraft: true`)
so nothing is published without a human decision. On manual run: `uploadWorkflowArtifacts: true`
only. `bundle.targets` in `tauri.conf.json`: `["nsis","msi","appimage","deb"]`.
No updater, no code signing in Phase 1 (documented in README: SmartScreen warning expected).

---

## 6. Backend design (Rust)

### 6.1 State and lifetime

```
AppState
├─ appdata: AppData                 // settings/recent/sessions files, Mutex-guarded writes
└─ workspace: RwLock<Option<Workspace>>
   Workspace {
     root: PathBuf (canonical, via dunce),
     generation: u64,              // bumps on every open/rescan; stale results are dropped
     options: ScanOptions { show_hidden, extra_ignores },
     index: Arc<RwLock<Index>>,
     scan: ScanHandle { cancel: Arc<AtomicBool>, join: JoinHandle },
     watcher: Option<WatchHandle>,  // debouncer + handler thread + stop flag
   }
```

Opening a new root cancels the running scan, stops the watcher, drops the index,
then starts fresh. Long work runs on `std::thread` (walker is sync and parallel)
and reports to the webview with `app.emit(..)`.

### 6.2 Path guard (`paths.rs`)

- Frontend never sends absolute paths for project files; it sends **root-relative
  paths with `/` separators** (`RelPath`). The backend joins with the root, rejects
  any `..` or absolute component, canonicalizes with `dunce::canonicalize` (resolves
  symlinks; strips Windows `\\?\`), and requires `canonical.starts_with(root)`.
  Violations return `AppError::OutsideRoot`.
- Only `open_root` accepts an absolute path (the one the dialog returned).
- `open_external` applies the same guard before calling `tauri_plugin_opener::open_path`.

### 6.3 Index model (`index/model.rs`)

```
Index {
  dirs:  HashMap<RelPath, DirNode>,     // "" = root
  files: HashMap<RelPath, FileMeta>,
}
DirNode  { name, rel_path, subdirs: BTreeSet<String>, files: BTreeSet<String>, md_count: u32, hidden: bool }
FileMeta { name, rel_path, size: u64, modified_ms: i64, hidden: bool }
```
`md_count` = markdown files in the subtree; `list_dir` returns only subdirs with
`md_count > 0`. Mutations (`insert_file`, `remove_file`, `remove_dir`) adjust
`md_count` up the ancestor chain and prune empty dirs. `Index::diff(&old_subtree, &new_subtree)`
yields `added / modified / removed`, used by both rescans and the watcher.

### 6.4 Scanner (`index/scanner.rs`)

- `ignore::WalkBuilder::new(root)` with `hidden(!show_hidden)`, `git_ignore(!show_hidden)`,
  `git_exclude(true)`, `git_global(false)`, `require_git(false)` (so `.gitignore` works
  when a subfolder of a repo is opened), `follow_links(false)`, `threads(min(cpus, 8))`,
  `overrides` built from the user's extra ignore patterns (each pattern added as
  `!pattern`, the override syntax for "ignore"), and `filter_entry` that always skips
  `.git` and `node_modules` and lets through only directories and markdown files.
- `build_parallel().run(..)` visitors push `(RelPath, FileMeta)` into a crossbeam-style
  `std::sync::mpsc` channel; a collector thread builds the `Index`, emits
  `index://progress` at most every 250 ms, and checks `cancel` (visitor returns
  `WalkState::Quit` when set).
- On completion: swap into `workspace.index`, emit `index://ready`. Errors on
  individual entries (permission denied) are counted and reported in `ready.skipped`.
- A unit test generates a 12k-file temp tree (10% markdown, nested, with `.gitignore`
  and `node_modules`) and asserts correctness plus a generous time budget (< 3 s in debug).

### 6.5 Watcher (`index/watcher.rs`)

- `notify_debouncer_full::new_debouncer(Duration::from_millis(200), None, handler)`
  watching the root recursively with `RecommendedWatcher`. If creating or watching
  fails with the inotify limit error (`ENOSPC`), retry with `PollWatcher` (2 s
  interval) and emit `fs://watch-status { mode: "poll", reason }` so the UI can
  suggest raising `fs.inotify.max_user_watches`.
- The handler receives `Vec<DebouncedEvent>` and classifies paths:
  1. any component `.git` or `node_modules` → ignore;
  2. `.gitignore` / `.ignore` / `.git/info/exclude` changed → **full rescan** (debounced 500 ms);
  3. `Modify(Data|Metadata)` of a known markdown file → stat → `modified`;
  4. `Remove` of a known file → `removed`; of a known dir → remove subtree → `removed[]`;
  5. anything else (`Create`, `Rename`, unknown paths, new dirs) → **targeted re-walk**:
     re-list the affected directory through the same ignore-aware `WalkBuilder`
     (using `filter_entry` to descend only into ancestors of the target and into the
     target itself, full depth for new directories) and `Index::diff` against the
     current subtree. This is what makes `.gitignore` rules apply to files that
     appear later, without re-scanning everything.
- Changes are accumulated per debounce tick and emitted once as `fs://changes`.
  Renames detected by the debouncer are reported as `renamed: [{from,to}]` in
  addition to removed/added so the frontend can carry a tab over.
- The classifier is a pure function (`classify(events, &index) -> Plan`) covered by
  unit tests; one integration test uses a temp dir and real notify with generous timeouts,
  marked `#[ignore]` on CI if it proves flaky (tracked as a risk).

### 6.6 App data (`appdata/`)

Location: `app.path().app_data_dir()` (Windows `%APPDATA%\<identifier>`, Linux
`~/.local/share/<identifier>`). Identifier: `io.github.jean3978.igrasp` (must not
change after the first release, see §17). Files:

| File | Content |
|---|---|
| `settings.json` | `{ version: 1, theme, fontSize, readingWidth, toastsMuted, ignorePatterns, showHiddenFiles }` |
| `recent-folders.json` | `{ version: 1, entries: [{ path, name, lastOpenedMs }] }` (max 10) |
| `sessions.json` | `{ version: 1, sessions: { [canonicalRootPath]: Session } }` (max 50, LRU) |
| `logs/igrasp.log` | `tauri-plugin-log`, rotated at 2 MB, keep 3 |

Writes are atomic (`tempfile::NamedTempFile` in the same dir + `persist`), serialized
through a `Mutex`. Unreadable/corrupt JSON is renamed to `<name>.corrupt-<timestamp>.json`,
defaults are used, and `appdata://recovered` is emitted (toast). `version` enables
future migrations. Unit tests: round trip, atomicity (no partial file after simulated
failure), corruption recovery, LRU trimming.

### 6.7 Native menu (`menu.rs`)

Built with `tauri::menu::MenuBuilder` at setup, attached to the main window:

- **File**: Open Folder… (`Ctrl+O`), Open Recent ▸ (rebuilt when recents change),
  Close Folder, separator, Settings (`Ctrl+,`), separator, Exit (`Alt+F4` predefined).
- **Edit**: predefined Copy, Select All (nothing else to edit yet).
- **View**: Toggle Sidebar (`Ctrl+B`), Show Hidden Files (check item), Mute Toasts
  (check item), Theme ▸ (radio: Light/Dark/High Contrast/Follow System), Zoom In/Out/Reset.
- **Help**: Keyboard Shortcuts (`F1`), About IGrasp.
- Git menu is **omitted until Phase 4** (an empty disabled menu would be confusing; see §17).

`on_menu_event` emits `menu://action { id }`; the frontend routes it through the
same `menuActions.ts` used by toolbar buttons and keyboard shortcuts, so behavior
has a single source of truth. Check/radio state is pushed back to the menu via
`set_menu_checked` when settings change.

---

## 7. IPC contracts

Types are Rust structs with `#[derive(Serialize, Deserialize, TS)]`,
`#[serde(rename_all = "camelCase")]`, exported by **ts-rs** into
`src/ipc/generated/` during `cargo test` and checked in CI. The sketches below are
the contract, not the final code.

### 7.1 Commands (`invoke`)

| Command | Input | Output | Notes |
|---|---|---|---|
| `open_root` | `{ path: string }` (absolute, from dialog) | `RootInfo { path, name, isGitRepo, generation }` | Validates dir, canonicalizes, stops previous workspace, adds root to asset-protocol scope, starts scan + watcher, updates recents. Returns before the scan ends. |
| `close_root` | — | `void` | Cancels scan, stops watcher, clears index. |
| `rescan` | `{ showHidden?: boolean }` | `void` | Restarts the scan with new options (hidden toggle, ignore patterns changed). |
| `list_dir` | `{ relPath: string }` | `DirListing { relPath, generation, dirs: DirEntry[], files: FileEntry[] }` | Only dirs with `mdCount > 0`. Sorted: dirs first, then natural order, case-insensitive. Errors `IndexNotReady` if called before `ready`. |
| `read_markdown` | `{ relPath: string }` | `FileContent { relPath, content, size, modifiedMs }` | UTF-8 with BOM stripped, invalid bytes replaced (lossy), line endings preserved. Files > 20 MB return `TooLarge`; between 2 and 20 MB the UI renders plain text with a "large file" notice (§9.2). |
| `open_external` | `{ relPath: string }` | `void` | Opens a project file with the OS default app (video fallback). Guarded. |
| `open_url` | — | — | Not a custom command: uses `@tauri-apps/plugin-opener` `openUrl`, scoped to `http(s)` in capabilities. |
| `get_settings` | — | `Settings` | |
| `update_settings` | `{ patch: Partial<Settings> }` | `Settings` | Merges, persists, emits `settings://changed` (keeps native menu in sync). |
| `get_recent_folders` | — | `RecentFolder[]` | Each with `exists: boolean`. |
| `remove_recent_folder` / `clear_recent_folders` | `{ path }` / — | `RecentFolder[]` | |
| `get_session` | `{ rootPath }` | `Session \| null` | |
| `save_session` | `{ rootPath, session: Session }` | `void` | Debounced by the frontend; also flushed on close-requested. |
| `get_app_info` | — | `{ version, tauriVersion, os, appDataDir, logDir }` | About dialog, bug reports. |

Errors are `AppError` → `{ code: 'NoRootOpen' | 'OutsideRoot' | 'NotFound' | 'InvalidPath' | 'TooLarge' | 'IndexNotReady' | 'Io' | 'AppData', message }`.

### 7.2 Events (`listen`)

| Event | Payload |
|---|---|
| `index://progress` | `{ generation, scannedEntries, markdownFiles, elapsedMs }` (≤ 4/s) |
| `index://ready` | `{ generation, markdownFiles, dirs, elapsedMs, skipped }` |
| `index://error` | `{ generation, message }` |
| `fs://changes` | `{ generation, added: FileEntry[], modified: FileEntry[], removed: string[], renamed: {from,to}[], dirsChanged: string[] }` |
| `fs://watch-status` | `{ mode: 'native' \| 'poll' \| 'off', reason?: string }` |
| `menu://action` | `{ id: MenuActionId }` |
| `settings://changed` | `Settings` |
| `appdata://recovered` | `{ file: string }` |

### 7.3 Shared types

```ts
type Theme = 'light' | 'dark' | 'high-contrast' | 'system';
type ReadingWidth = 'narrow' | 'medium' | 'wide' | 'full';
interface Settings { version: 1; theme: Theme; fontSize: number /* 12–24 */; readingWidth: ReadingWidth;
  toastsMuted: boolean; ignorePatterns: string[]; showHiddenFiles: boolean; }
interface DirEntry  { name: string; relPath: string; mdCount: number; hidden: boolean }
interface FileEntry { name: string; relPath: string; size: number; modifiedMs: number; hidden: boolean }
interface Session { version: 1; tabs: SessionTab[]; activeTab: string | null; expandedDirs: string[];
  sidebar: { visible: boolean; widthPx: number }; showHidden: boolean; savedAtMs: number }
interface SessionTab { relPath: string; pinned: boolean; scrollTop: number }
```

### 7.4 Frontend IPC layer

`src/ipc/client.ts` exports one function per command; `src/ipc/events.ts` exports
`subscribeAll(dispatch)`. Both are implemented twice: `tauri/` (real `invoke`/`listen`)
and `mock/` (in-memory fixture project, fake events triggerable through
`window.__igraspMock` for Playwright). The implementation is chosen at startup by
the presence of `window.__TAURI_INTERNALS__`. Nothing else imports `@tauri-apps/api`.

---

## 8. Tauri security

| Control | Decision |
|---|---|
| File access | No `plugin-fs`, no `plugin-shell`. Every project read goes through Rust commands guarded by `RootGuard` (§6.2). App data is only touched by the `appdata` module. |
| Capabilities (`capabilities/default.json`, window `main`) | `core:default`, `core:window:allow-show`, `core:window:allow-set-title`, `core:window:allow-close`, `core:window:allow-destroy`, `core:window:allow-theme`, `dialog:allow-open`, `opener:allow-open-url` with scope `https://**` and `http://**` only, `window-state:default`, `log:default`. No `opener:allow-open-path` (done in Rust after the guard). |
| Asset protocol | `assetProtocol.enable: true`, static `scope: []`. When a root is opened, Rust calls `app.asset_protocol_scope().allow_directory(root, true)`. The scope has no "un-allow", so roots opened in the same session stay readable until exit; this is acceptable (the user opened them) and recorded in an ADR. Paths are resolved by the frontend with `convertFileSrc(abs)` only after a lexical containment check. |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: http://asset.localhost https: http: data: blob:; media-src 'self' asset: http://asset.localhost https: http: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; frame-src 'none'; form-action 'none'`. `dangerousDisableAssetCspModification: ["style-src"]` so Tauri does not inject a style nonce (a nonce would make browsers ignore `'unsafe-inline'`, breaking Shiki/KaTeX/Mermaid inline styles). Scripts stay hash-protected. |
| HTML in markdown | `rehype-sanitize` with an explicit schema (§9.3), applied **before** trusted generators run. |
| Mermaid | `securityLevel: 'strict'` (DOMPurify inside Mermaid, no click handlers, no HTML labels). |
| Navigation | All anchor clicks intercepted; the webview never navigates. `dragDropEnabled: false` (no accidental file drops navigating the webview). |
| Misc | `withGlobalTauri: false`; devtools disabled in release; `open_external` limited to files under the root. |

---

## 9. Markdown pipeline

### 9.1 Stages (unified, async)

```
remark-parse
→ remark-gfm                      tables, task lists, footnotes, strikethrough, autolinks
→ remark-frontmatter ['yaml']
→ remarkExtractFrontMatter         (own 5-line plugin: parse with `yaml`, store in file.data, drop node)
→ remark-math
→ remark-rehype { allowDangerousHtml: true, footnoteLabel: 'Footnotes' }
→ rehype-raw                       parse inline HTML
→ rehype-github-alerts { build: customAlertBuild }   > [!NOTE] etc. → <div class="markdown-alert" data-alert="note">
→ rehype-sanitize (schema §9.3)    ← sanitizes untrusted content FIRST
→ rehype-slug                      heading ids (used by anchor links now, outline in Phase 2)
→ rehype-katex { output: 'htmlAndMathml' }           trusted generator
→ rehypeShikiFromHighlighter (@shikijs/rehype/core)   trusted generator, dual theme CSS vars
→ hast-util-to-jsx-runtime         → React elements with component overrides
```

Sanitizing before KaTeX/Shiki means their markup (inline styles, class names) is
never stripped, while user HTML cannot smuggle a `style` attribute: the schema only
allows `className` values the generators depend on (`language-*`, `math-inline`,
`math-display`, `markdown-alert*`, `task-list-item`, `footnotes`, `contains-task-list`).

### 9.2 Rendering component

`useMarkdown(content, relPath, themeKey)` runs the processor off the React render
(effect + cancellation token so only the latest result lands), caches the processor
instance, and returns `{ frontMatter, element, error }`. The pipeline result is
memoized by `(content hash, relPath)`; theme changes do **not** reprocess because Shiki
emits both light and dark colors as CSS variables (`defaultColor: false`) and the
active one is selected in CSS. Files above 2 MB render as plain preformatted text
with a notice (risk mitigation). A Web Worker is **not** used in Phase 1 but the
hook boundary is designed so the processor can move to one later.

### 9.3 Sanitize schema (deltas from `defaultSchema`)

- Allow tags: `video`, `source`, `details`, `summary`, `kbd`, `sup`, `sub`, `input` (checkbox only, `disabled`).
- Allow attributes: `img[src alt title width height loading]`, `video[src controls poster width height muted loop preload]`,
  `source[src type]`, `a[href title]`, `input[type checked disabled]`, `div[data-alert]`, `td/th[align]`,
  `*[id]` only for headings and footnotes (`clobberPrefix: 'user-content-'`).
- Protocols: `href: ['http','https','mailto']`, `src: ['http','https']` (relative paths pass).
- Strip: `style` attributes, `script`, `iframe`, `object`, `embed`, `form`, event handlers (default).

### 9.4 Component mapping

| Element | Component | Behavior |
|---|---|---|
| `pre > code.language-mermaid` | `MermaidBlock` | §10. |
| `pre > code` (other) | `CodeBlock` | Copy button, language badge; Shiki already applied. |
| `img` | `AssetImage` | Resolves `src`: `http(s)` as-is; relative → `root/dir(file)/src`; leading `/` → root-relative; containment check → `convertFileSrc`. Broken image → inline placeholder with path. |
| `video` / `source` | `AssetVideo` | Same resolution, `controls preload="metadata"`. On `error` or unsupported type → `VideoFallback` card: file name, "Open externally" (→ `open_external`), and on Linux a hint to install GStreamer packages (link to README section). |
| `a` | `PreviewLink` | `#anchor` → scroll to `user-content-<id>` in the preview container; `http(s)/mailto` → `openUrl`; relative `.md` link that exists in the index → open in tab (minimal; full resolution, anchors across files and broken-link flags are Phase 2); otherwise tooltip "Not available yet". |
| `input[type=checkbox]` | `TaskCheckbox` | Read-only, accessible label. |
| `div[data-alert]` | `Alert` | Icon (lucide) + title + GitHub colors per type. |
| front matter | `FrontMatterCard` | Key/value grid above the document; arrays as chips; nested objects collapsed JSON; raw YAML toggle. |

### 9.5 Shiki

`createHighlighterCore` from `shiki/core` with `createJavaScriptRegexEngine` (no WASM),
themes `github-light`, `github-dark`, `github-dark-high-contrast`, and a starter
language set (`markdown`, `json`, `yaml`, `toml`, `bash`, `powershell`, `typescript`,
`tsx`, `javascript`, `rust`, `python`, `go`, `java`, `c`, `cpp`, `csharp`, `sql`, `html`,
`css`, `diff`, `dockerfile`, `mermaid`). Unknown languages are loaded on demand
(`loadLanguage` with dynamic import from `@shikijs/langs/*`) and fall back to plain
text while loading or if unsupported. The highlighter is created lazily on first
code block.

### 9.6 KaTeX

`rehype-katex` is loaded with a dynamic import on first math node, together with
`katex/dist/katex.min.css` (fonts bundled by Vite). `strict: 'ignore'`, `throwOnError: false`
(errors render red text with the TeX source).

---

## 10. Mermaid preview

- `mermaid` 12 is dynamically imported on the first diagram (it is the largest dependency).
  `initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default',
  look: 'classic', fontFamily: var(--font-ui) })`. Mermaid 12 switched to the `neo` look
  and ELK layout by default; `classic` look keeps diagrams familiar, and ELK vs dagre is
  evaluated during implementation (§17).
- Rendering: `mermaid.parse(src, { suppressErrors: true })` → if invalid, show an
  error card with the message and the source; else `mermaid.render(uniqueId, src)` →
  inject `svg` string (already sanitized by Mermaid in strict mode) into a container.
  Re-render on theme change (diagram colors depend on theme) with a cache keyed by
  `(source, theme)`.
- Interaction: `react-zoom-pan-pinch` `TransformWrapper` around the SVG (wheel zoom with
  Ctrl or toolbar, drag to pan, pinch on touchpads). Toolbar (visible on hover/focus,
  always visible in full screen): zoom in, zoom out, fit (`centerView` with computed
  scale from SVG viewBox vs container), reset (1:1), full screen, copy source.
  Keyboard: `+`/`-`/`0`/`F` when the diagram is focused; `Esc` leaves full screen.
- Full screen: a modal overlay (radix Dialog) covering the window, same toolbar,
  focus trapped, returns focus to the diagram on close. Not the browser Fullscreen API
  (keeps the OS window as-is, more predictable on Linux).
- Export SVG/PNG is deferred to Phase 2 (needs a save dialog + a write command outside the root).

---

## 11. Frontend architecture

### 11.1 Component tree

```
<App>
├─ <SplashOverlay/>                         until settings loaded + min 1.2 s, then fades
├─ <WelcomeScreen/>                         when no root: logo, Open Folder, Open Recent, shortcuts hint, version
└─ <WorkspaceLayout/>                       when root open
   ├─ <Toolbar/>                            root name, Open Folder, theme menu, toggle sidebar, mute toasts
   ├─ <Group orientation="horizontal">      react-resizable-panels v4
   │  ├─ <Panel id="sidebar" collapsible>  <ExplorerPanel/>
   │  │     ├─ <ExplorerToolbar/>           show hidden, collapse all, refresh
   │  │     └─ <FileTree/>                  role="tree", virtualized rows, roving tabindex
   │  ├─ <Separator/>
   │  └─ <Panel id="main">
   │        ├─ <TabBar/>                    role="tablist", preview/pinned styles, context menu
   │        └─ <TabContent/>                switch on tab.kind:
   │              ├─ <DocumentTab/>         <DeletedBanner/>? <FrontMatterCard/> <MarkdownPreview/>
   │              ├─ <SettingsTab/>
   │              ├─ <ShortcutsReferenceTab/>
   │              └─ <EmptyState/>          (no tab)
   ├─ <StatusBar/>                          index status, watch mode, md count, toasts muted, theme
   └─ <ToastHost/>  <AboutDialog/>  <MermaidFullscreen/> (portals)
```

### 11.2 State management (zustand 5)

| Store | State | Key actions |
|---|---|---|
| `workspace` | `root: RootInfo \| null`, `indexStatus: idle/scanning/ready/error + counts`, `watchMode`, `sidebar {visible,width}` | `openRoot`, `closeRoot`, `setIndexProgress`, `setReady` |
| `tree` | `listings: Map<relDir, DirListing>`, `expanded: Set<relDir>`, `focusedRow`, `showHidden` | `ensureLoaded(dir)`, `toggle(dir)`, `applyChanges(FsChanges)` (patch loaded listings, re-fetch `dirsChanged` ∩ loaded), `flatRows` selector (memoized) |
| `tabs` | `tabs: Tab[]` (`kind: 'document' \| 'settings' \| 'shortcuts'`, `relPath`, `pinned`, `scrollTop`, `deleted`), `activeId`, `previewTabId` | `openDocument(relPath, {pin})`, `pin`, `close`, `closeOthers`, `activate`, `move`, `setScroll`, `markDeleted`, `renamePath` |
| `documents` | `byPath: Map<relPath, {content, modifiedMs, status, error}>` | `load(relPath)`, `reload(relPath)` (on `fs://changes`), `evict` (when no tab uses it) |
| `toasts` | `items`, `pendingBatch`, `muted` | `ingestChanges(FsChanges)` (§12.3), `dismiss`, `openDetails` |
| `settings` | mirror of `Settings`, `effectiveTheme` | `load`, `update(patch)` (optimistic + persist), system theme listener |
| `session` | — (module, not UI state) | subscribes to `tabs`/`tree`/`workspace`, debounces 750 ms → `save_session`; `restore(root)` on open; flush on `onCloseRequested` |

Rules: stores hold serializable data only; components subscribe with selectors;
IPC calls live in store actions (not components); every store has Vitest coverage
with the mock IPC.

### 11.3 Data flows

- **Open folder**: dialog → `open_root` → `workspace.root` set, screen switches →
  `index://progress` updates status bar → `index://ready` → `tree.ensureLoaded('')`
  → session restore (expanded dirs loaded lazily, tabs recreated, active tab content
  loaded, scroll applied after first layout) → window shown if first launch.
- **Click file**: single click → `tabs.openDocument(path)` reuses the preview tab;
  double click → pinned. `documents.load` → `read_markdown` → `MarkdownPreview`.
- **Disk change**: `fs://changes` → `tree.applyChanges` → `documents.reload` for open
  paths (modified) → `tabs.markDeleted` (removed) / `tabs.renamePath` (renamed) →
  `toasts.ingestChanges` (unless muted).

---

## 12. Feature details

### 12.1 File tree
- Rows flattened from `expanded` + `listings`; `@tanstack/react-virtual` renders only
  visible rows (row height 22 px, overscan 10). 10k rows stay smooth because only the
  flattened array changes.
- Lazy: expanding a folder calls `list_dir` once; a spinner row shows while loading.
- Sorting: folders first; natural, case-insensitive. Hidden/ignored entries (when shown)
  are dimmed with an "ignored" tooltip.
- Hidden toggle semantics: shows dot-prefixed entries **and** gitignored entries;
  `.git` and `node_modules` stay excluded; user ignore patterns stay applied (§17).
  Toggling calls `rescan` (fast, parallel) and keeps the expanded set.
- Index status row at the top while scanning ("Indexing… 1,240 files"); tree is usable
  as soon as `ready` (no partial trees, which avoids flicker and wrong folder pruning).

### 12.2 Tabs
- Preview tab title in italics (VS Code). Opening a new file by single click replaces
  the preview tab unless it is pinned. Double-click on a tree row or on the tab pins it.
- Close: `×` button, middle click, `Ctrl+W`. Switch: `Ctrl+Tab` / `Ctrl+Shift+Tab`,
  `Ctrl+PageUp/PageDown`, `Alt+1..9`. Context menu: Pin, Close, Close Others, Close All,
  Copy Path (relative), Copy Absolute Path.
- One tab per path. Deleted on disk → yellow banner "This file was deleted on disk"
  with Close; if the file reappears, banner disappears and content reloads.
- Drag to reorder is **optional** (last step if time allows; keyboard `Ctrl+Shift+PageUp/Down` is enough).

### 12.3 Toasts with batching and muting
- Rust already coalesces events in 200 ms windows. The frontend adds a **quiet window
  of 1.5 s**: changes arriving within it accumulate into one pending batch.
- When the window closes: ≤ 3 changes → individual toasts (added green, modified blue,
  deleted red, each with the file name, click opens the file); > 3 → a single grouped
  toast "12 files modified · 3 added · 1 deleted" that keeps updating in place while
  the storm continues. Clicking it opens `GroupedToastDetails` (popover list grouped
  by kind, click a file to open; "Dismiss").
- Lifetimes: 5 s (single), 8 s (grouped), paused on hover/focus, max 4 visible,
  oldest collapses into the grouped one. Announced via `aria-live="polite"`.
- Muting (View menu check item, Settings switch, status bar icon): no toasts are
  shown; live reload still happens; the status bar shows a small counter "3 changes"
  that resets when clicked.
- Pure batching logic in `toasts.ts` with unit tests (timers faked).

### 12.4 Themes
- `data-theme="light|dark|high-contrast"` on `<html>`; `system` resolves via
  `matchMedia('(prefers-color-scheme: dark)')` and Tauri's `onThemeChanged`.
- Semantic tokens in `tokens.css` (background layers, foreground, muted, accent,
  border, focus, success/info/danger for toasts, selection). High contrast: pure
  black/white, 2 px borders everywhere, 3 px yellow focus ring, no transparency, no
  shadows, underlined links; contrast ≥ 7:1 for text.
- Shiki dual-theme variables; HC uses `github-dark-high-contrast`. Mermaid uses
  `dark` / `default` and, for HC, `base` with `themeVariables` for black/white/yellow.
- Toolbar theme button opens a radix dropdown with the four options (radio items);
  also in View menu. Choice persisted in settings immediately.
- System font stack (`Segoe UI`, `system-ui`, `Ubuntu`, `Cantarell`, sans-serif; monospace
  `Cascadia Code`, `Consolas`, `DejaVu Sans Mono`); no bundled fonts (license hygiene, size).

### 12.5 Settings tab
Sections: Appearance (theme, font size slider 12–24 with live preview, reading width
narrow/medium/wide/full), Notifications (mute toasts), Files (extra ignore patterns,
one gitignore-style glob per line; show hidden files by default), Data (app data
folder path with "Open folder", "Reset settings"), About (version, links). Changes
apply instantly and persist through `update_settings`; ignore-pattern changes trigger
`rescan`. Future settings (beginner mode, Claude, quiz, shortcuts) arrive with their phases.

### 12.6 Keyboard accessibility
- Global: `Ctrl+O` open folder, `Ctrl+,` settings, `Ctrl+B` sidebar, `Ctrl+W` close tab,
  `Ctrl+Tab`/`Ctrl+Shift+Tab` switch tabs, `Ctrl+Shift+E` focus explorer, `Ctrl+=`/`Ctrl+-`/`Ctrl+0`
  font size, `F1` shortcuts reference, `Esc` closes overlays/menus/full screen.
- Tree (`role="tree"`, APG pattern): `↑/↓` move, `→` expand or go to first child,
  `←` collapse or go to parent, `Home/End`, `Enter` open (pinned), `Space` preview,
  type-ahead by first letters, `*` expand siblings.
- Tabs (`role="tablist"` with manual activation), menus/dialogs/tooltips via radix
  (focus trap, Escape, arrow keys). Skip link "Skip to document" first in DOM order.
- Preview container is focusable (`tabIndex=0`) so PageUp/PageDown/arrows scroll it;
  Mermaid toolbars and full screen reachable by Tab.
- Reserved for later phases (not bound now): `Ctrl+T`, `Ctrl+Shift+F`, `Alt+←/→`, `F2`,
  `Delete`, `Ctrl+S`, `Ctrl+E`.
- `prefers-reduced-motion` disables splash and toast animations.

### 12.7 Session restore
- Saved: open tabs (path, pinned, scrollTop), active tab, expanded dirs, sidebar
  visibility/width, show-hidden flag. Trigger: debounced 750 ms after any change,
  on `close_root`, and on `onCloseRequested` (prevent default → flush → destroy).
- Restored on `index://ready`: expanded dirs are re-expanded (lazy loads in parallel,
  missing dirs dropped), tabs recreated (missing files dropped silently), active tab
  content loaded, scrollTop applied in a layout effect and re-applied once after
  images/Mermaid settle (ResizeObserver, max 1 s).
- Window size/position/maximized: `tauri-plugin-window-state`.

---

## 13. Branding: logo, icons, splash

- **Concept**: "grasp" = a hand holding knowledge. Primary mark: a rounded-square
  badge; inside, a markdown page (folded corner, three text lines, the middle one
  rendered as a `#` heading glyph) held by two curved strokes that read both as
  fingers wrapping the page and as the letter **G**. Palette: deep indigo → violet
  gradient background (`#3b2fa8` → `#6d4de0`), page in warm off-white, accent line in
  amber. A monochrome variant (single path, currentColor) is used in the UI at
  16–24 px (toolbar, status bar, About). Two or three variants are sketched in step 9
  and the best one is kept; the rest are deleted (no dead assets).
- **SVG rules**: viewBox `0 0 512 512`, no raster, no text elements (convert to paths),
  no filters that rasterize badly; safe area 10 % for OS masks; strokes ≥ 12 units so
  the 16 px icon stays legible.
- **Icons**: `npm run tauri icon assets/branding/igrasp.svg` generates `src-tauri/icons/`
  (`.ico`, `.icns`, `32x32.png`, `128x128.png`, `128x128@2x.png`, Windows Store set).
  Tauri 2 CLI accepts SVG input directly, so no MPL-licensed rasterizer is needed.
  Generated icons are committed.
- **Splash**: in-app overlay in the main window, not a separate window (the React app
  boots in well under a second, a second window would flash). The main window starts
  `visible: false` with `backgroundColor` matching the dark token; the frontend loads
  settings, applies the theme, shows the window, then plays the animation: logo path
  stroke-draw (0 → 100 % over 700 ms), fill fade-in, subtle scale 0.96 → 1, then
  the badge "settles" and the overlay fades to the Welcome/Workspace screen (min total
  1.2 s, max until settings + session loaded). Inline `<svg>` (never blurry at any DPI);
  pure CSS keyframes (no Lottie dependency). Disabled by `prefers-reduced-motion`
  (static logo for 400 ms).

---

## 14. Libraries (exact versions, licenses)

Versions checked against the npm and crates.io registries on 2026-10-23. `package.json`
pins exact versions (`save-exact`); `Cargo.toml` uses caret ranges with `Cargo.lock`
committed. All runtime licenses are MIT, ISC, or MIT/Apache-2.0 dual (all MIT-compatible).
Dev-only tools under Apache-2.0 do not ship in the app.

### 14.1 Frontend runtime (npm)

| Package | Version | License | Purpose |
|---|---|---|---|
| react / react-dom | 19.3.1 | MIT | UI |
| @tauri-apps/api | 2.12.4 | MIT OR Apache-2.0 | invoke, listen, convertFileSrc, window |
| @tauri-apps/plugin-dialog | 2.8.3 | MIT OR Apache-2.0 | folder picker |
| @tauri-apps/plugin-opener | 2.7.2 | MIT OR Apache-2.0 | external links |
| @tauri-apps/plugin-window-state | 2.5.0 | MIT OR Apache-2.0 | window geometry |
| @tauri-apps/plugin-log | 2.10.1 | MIT OR Apache-2.0 | frontend logs → file |
| unified | 11.0.5 | MIT | pipeline |
| remark-parse | 11.0.0 | MIT | |
| remark-gfm | 4.0.1 | MIT | |
| remark-frontmatter | 5.0.0 | MIT | |
| remark-math | 6.0.0 | MIT | |
| remark-rehype | 11.1.2 | MIT | |
| rehype-raw | 7.0.0 | MIT | |
| rehype-sanitize | 6.0.0 | MIT | |
| rehype-slug | 6.0.0 | MIT | |
| rehype-katex | 7.0.1 | MIT | |
| rehype-github-alerts | 4.2.0 | MIT | `> [!NOTE]` |
| hast-util-to-jsx-runtime | 2.3.6 | MIT | hast → React |
| unist-util-visit | 5.1.0 | MIT | own plugins |
| shiki (+ @shikijs/rehype, /langs, /themes, same version) | 4.5.0 | MIT | highlighting, JS regex engine |
| katex | 0.19.1 | MIT | math |
| mermaid | 12.2.0 | MIT | diagrams |
| yaml | 2.9.1 | ISC | front matter |
| zustand | 5.0.16 | MIT | state |
| @tanstack/react-virtual | 3.14.22 | MIT | tree virtualization |
| react-resizable-panels | 4.14.8 | MIT | sidebar/main split (v4 API: Group/Panel/Separator) |
| react-zoom-pan-pinch | 4.2.0 | MIT | Mermaid zoom/pan |
| radix-ui | 1.8.1 | MIT | accessible menu, dialog, tooltip, switch, select |
| lucide-react | 1.61.0 | ISC | icons |
| clsx | 2.1.1 | MIT | class names |

Transitive note: Mermaid depends on `dompurify` (dual MPL-2.0 OR Apache-2.0; Apache
applies). All other transitive licenses are checked at step 2 with `npx license-checker-rseidelsohn`
(run ad hoc, not a dependency) and `cargo deny`-style review via `cargo tree`.

### 14.2 Frontend dev (npm)

| Package | Version | License |
|---|---|---|
| typescript | **5.9.3** (not 7.x, see risks) | Apache-2.0 |
| vite | 8.3.5 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| @tauri-apps/cli | 2.12.4 | MIT OR Apache-2.0 |
| @types/react / @types/react-dom | 19.3.0 | MIT |
| @types/node | 26.6.5 | MIT |
| eslint | 10.13.0 | MIT |
| typescript-eslint | 8.72.0 | MIT |
| eslint-plugin-react-hooks | 7.1.1 | MIT |
| eslint-plugin-react-refresh | 0.5.7 | MIT |
| eslint-config-prettier | 10.1.8 | MIT |
| globals | 17.13.0 | MIT |
| prettier | 3.9.10 | MIT |
| vitest / @vitest/coverage-v8 | 5.0.5 | MIT |
| jsdom | 30.1.3 | MIT |
| @testing-library/react | 16.3.3 | MIT |
| @testing-library/dom | 10.4.2 | MIT |
| @testing-library/jest-dom | 7.0.1 | MIT |
| @testing-library/user-event | 14.6.8 | MIT |
| @playwright/test | 1.64.1 | Apache-2.0 |

### 14.3 Backend (crates)

| Crate | Version | License | Purpose |
|---|---|---|---|
| tauri (features: `protocol-asset`) | 2.12.5 | MIT OR Apache-2.0 | runtime |
| tauri-build | 2.7.4 | MIT OR Apache-2.0 | build script |
| tauri-plugin-dialog | 2.8.3 | MIT OR Apache-2.0 | |
| tauri-plugin-opener | 2.7.2 | MIT OR Apache-2.0 | |
| tauri-plugin-window-state | 2.5.0 | MIT OR Apache-2.0 | |
| tauri-plugin-log | 2.10.1 | MIT OR Apache-2.0 | |
| serde (derive) | 1.0.229 | MIT OR Apache-2.0 | |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | |
| notify | 8.2.0 | CC0-1.0 | file watching |
| notify-debouncer-full | 0.7.0 | MIT OR Apache-2.0 | 200 ms debounce, rename pairing |
| ignore | 0.4.33 | Unlicense OR MIT | gitignore-aware parallel walk |
| thiserror | 2.0.21 | MIT OR Apache-2.0 | errors |
| ts-rs | 12.0.1 | MIT | TS bindings |
| log | 0.4.34 | MIT OR Apache-2.0 | |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | Windows canonical paths |
| tempfile | 3.27.0 | MIT OR Apache-2.0 | atomic writes; test fixtures |

Rejected on license or compatibility grounds: `@resvg/resvg-js` (MPL-2.0; not needed,
Tauri CLI rasterizes SVG), `@axe-core/playwright` (MPL-2.0; manual a11y audit instead),
`@fontsource-variable/inter` (OFL-1.1; system fonts instead), `eslint-plugin-jsx-a11y`
(no ESLint 10 support yet), TypeScript 7 (unsupported by typescript-eslint), `libgit2`
bindings (project rule: git CLI only, Phase 4).

---

## 15. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Rust unit | `cargo test` | path guard (traversal, symlink escape, UNC), index model (`md_count`, pruning, diff), scanner on temp fixtures (gitignore, hidden, `node_modules`, case-insensitive extensions, 12k-file budget), watcher classifier (pure), app data (atomic, corrupt recovery, LRU), ts-rs export. |
| Frontend unit | Vitest + jsdom + RTL | stores (tabs preview/pin semantics, tree flattening, toast batching with fake timers, session debounce), markdown pipeline snapshots on `src/test/fixtures/markdown/*.md` (GFM, alerts, footnotes, math, front matter, `<script>` stripped, `style` stripped, relative image resolution, task lists), components (tree keyboard navigation, tab bar, theme switch, settings persistence via mock IPC). |
| E2E | Playwright (Chromium) against `vite build` + `vite preview` with mock IPC | splash → welcome; open fixture folder → tree shows expected nodes and hides empty folders; click → preview renders heading and code block; Mermaid renders an `<svg>`; theme switch updates `data-theme`; keyboard-only path (Tab, arrows, Enter) opens a file; fake `fs://changes` produces a grouped toast and reloads the open tab. |
| Manual (per phase checklist in CONTRIBUTING) | Windows 11 + Ubuntu 22.04 VM | real folder with 10k+ files, external edits by an editor and by a script writing 50 files, AppImage/NSIS smoke. |

Playwright cannot drive the real WebView2/WebKitGTK; the mock-IPC approach tests the
whole frontend and is recorded as an ADR. A `tauri-driver` (WebDriver) job may be
added later for Linux.

---

## 16. Architecture Decision Records to write in this phase

1. `0001-tauri-v2-react-vite-stack.md`
2. `0002-file-access-through-rust-commands.md` (no fs plugin; root guard; asset scope widening)
3. `0003-markdown-pipeline-sanitize-before-generators.md` (unified order, CSP `style-src` choice)
4. `0004-background-index-with-ignore-crate.md` (lazy `list_dir`, targeted re-walk on events)
5. `0005-app-data-as-versioned-json-files.md` (vs `tauri-plugin-store`)
6. `0006-native-menu-bar-for-mvp.md` (vs custom VS Code-style title bar)
7. `0007-e2e-with-playwright-and-mock-ipc.md`
8. `0008-pin-typescript-5-and-vite-8.md`

---

## 17. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Toolchain churn**: TypeScript 7 (Go port) is `latest` but unsupported by typescript-eslint; Vite 8 (rolldown) and Vitest 5 are recent majors. | Pin TS 5.9.3 and exact versions; lockfile committed; Dependabot grouped PRs; CI on both OSes catches breakage. |
| 2 | **Old WebKitGTK on Linux**: Mermaid 12 ships ES2024 code (Safari 17.4+ ≈ WebKitGTK 2.44). Older distros fail to load diagrams. | Document minimum WebKitGTK 2.44 in README; CI runs on Ubuntu 22.04 (ships 2.44+ via updates); Mermaid is loaded lazily and failures show an error card instead of breaking the page. |
| 3 | **CSP vs inline styles**: Tauri's style nonce would disable `'unsafe-inline'` and break Shiki/KaTeX/Mermaid styling. | `dangerousDisableAssetCspModification: ["style-src"]`; scripts remain hash-protected; verified by a Playwright check that a code block has colors. |
| 4 | **inotify watch limit** on Linux with 10k+ directories. | Detect `ENOSPC`, fall back to `PollWatcher`, show status + hint in UI and README. |
| 5 | **Scan time** on slow/network disks or huge trees. | Parallel walk, progress events, cancellation, generation counter; 12k-file benchmark test; tree hidden until `ready` to avoid wrong pruning. |
| 6 | **Watcher correctness**: gitignored files appearing later, directory moves, editors writing via temp+rename. | Targeted ignore-aware re-walk instead of path heuristics; debouncer-full rename pairing; re-read tolerant of transient empty files; pure classifier with tests. |
| 7 | **Windows path quirks** (`\\?\` prefix, case-insensitive FS, separators). | `dunce`; compare canonical paths; `/`-separated rel paths in IPC; tests on Windows CI. |
| 8 | **Asset scope cannot be narrowed** after a folder is opened. | Accept for the session (user chose those folders); ADR; custom URI scheme with Range support as a future option. |
| 9 | **Large markdown files** block the main thread during processing. | > 2 MB rendered as plain text; processor memoized; design keeps a Web Worker possible. |
| 10 | **Mermaid bundle size and render errors**. | Dynamic import; `parse` first; error card; cache per (source, theme). |
| 11 | **Scroll restore flicker / wrong position** after images and diagrams load. | Apply in layout effect, re-apply once when layout settles (ResizeObserver, ≤ 1 s). |
| 12 | **Playwright cannot drive the WebView.** | Mock IPC e2e (ADR); manual checklist on real builds; optional tauri-driver later. |
| 13 | **High-contrast legibility** of third-party output (Shiki, Mermaid, KaTeX). | Dedicated HC Shiki theme, Mermaid `base` theme variables, manual contrast audit in step 26. |
| 14 | **Native menu looks different per OS** and not VS Code-like. | Accept for MVP (ADR 0006); actions are centralized so a custom menu bar can replace it later without touching behavior. |
| 15 | **MSI build needs WiX + VBScript**; AppImage glibc compatibility. | MSI only built in CI (`windows-latest` has it) and documented locally; AppImage built on Ubuntu 22.04. |
| 16 | **Node version**: jsdom 30 needs Node ≥ 24.15; the dev machine has 24.7. | `engines` + `engine-strict`; update Node before step 2; `happy-dom` 21 (MIT) is the fallback DOM if jsdom causes trouble. |
| 17 | **ts-rs drift** between Rust and TS. | Bindings generated in `cargo test`, committed, `git diff --exit-code` in CI. |
| 18 | **Toast storms** from agents writing hundreds of files. | Two-level batching (200 ms backend, 1.5 s frontend quiet window), max 4 visible, grouped toast updated in place, mute. |
| 19 | **Remote images over plain `http:`** leak the user's IP / mixed content. | Allowed per requirements (URLs); documented; a "block remote images" setting is a candidate for a later phase. |
| 20 | **Session file growth** across many folders. | LRU 50 entries; scroll positions only (no content). |

---

## 18. Order of work (small, committable steps)

Each step is one commit (Conventional Commits, `Co-Authored-By` trailer) on
`phase-1-mvp`, builds, and passes `npm run check`. "Verify" is what to run or try
before committing.

**M0 — Repository foundation**
1. `docs: add phase 1 implementation plan` (this file).
2. `chore: scaffold Tauri v2 + React 19 + TypeScript 5.9 + Vite 8` — `package.json`, configs, `src-tauri` skeleton with identifier/window config, `rust-toolchain.toml`, `.npmrc`, `.vscode`. Verify: `npm run tauri dev` opens a window with "IGrasp".
3. `chore: add lint, format and test tooling` — ESLint flat config, Prettier, Vitest + RTL + jsdom setup, `cargo fmt`/`clippy` config, `npm run check`. Verify: `npm run check` green with one trivial test on each side.
4. `ci: lint and test on Windows and Linux` — `ci.yml` (lint, test, build-check). Verify: workflow file validated with `actionlint` locally if available; otherwise first push.
5. `docs: add community files` — LICENSE, CONTRIBUTING, SECURITY, CHANGELOG (Unreleased), `.github` templates + dependabot, `.editorconfig`, `.gitattributes`, README skeleton with the AI-generated notice and roadmap, title fixed to IGrasp. Verify: `git ls-files --eol` shows LF.
6. `docs: add CLAUDE.md, architecture skeleton and first ADRs` — ADR 0001, 0002, 0008; `docs/features/README.md` index.

**M1 — Backend foundation**
7. `feat(backend): error type, app state and app-data store` — `error.rs`, `state.rs`, `appdata/*` with settings/recent/sessions, atomic writes, recovery; commands `get_settings`, `update_settings`, `get_recent_folders`, `remove_recent_folder`, `clear_recent_folders`, `get_session`, `save_session`, `get_app_info`; ts-rs export; tests. ADR 0005.
8. `feat(frontend): IPC client layer, generated types and mock backend` — `ipc/client.ts`, `ipc/events.ts`, `ipc/tauri`, `ipc/mock` with a fixture project; `settings` store; tests.

**M2 — Shell, theme, branding**
9. `feat: theme system and app shell` — tokens, three theme files, `system` resolution, `ThemeMenu`, `WorkspaceLayout` with resizable sidebar, `StatusBar`, `Toolbar`, radix-based `components/ui`. Verify: switch themes live; HC renders.
10. `feat: SVG logo, app icons and animated splash` — `assets/branding/*.svg`, `tauri icon`, window `visible:false` + show after theme applied, `SplashOverlay` with CSS animation and reduced-motion path. ADR note in features doc. Verify: no white flash; sharp at 200 % scaling.
11. `feat: welcome screen with open folder and open recent` — dialog plugin, `open_root`/`close_root` with `RootGuard` and asset-scope widening, recents MRU with missing detection and removal, `workspace` store. Verify: open, close, reopen from recents, missing folder greyed.

**M3 — Index and tree**
12. `feat(backend): background markdown index with ignore rules` — `index/model.rs`, `index/scanner.rs`, `list_dir`, `rescan`, progress/ready events; fixture tests incl. 12k budget. ADR 0004.
13. `feat(frontend): lazy virtualized file tree with keyboard navigation` — `tree` store, `FileTree` (ARIA tree, roving tabindex, type-ahead), `ExplorerToolbar` (show hidden → `rescan`, collapse all), index status row. Verify on a real large repo.

**M4 — Reading**
14. `feat(backend): read_markdown command` — BOM, lossy UTF-8, size limits, tests.
15. `feat: VS Code-style tabs` — `tabs` + `documents` stores, `TabBar`, preview vs pinned, close/switch shortcuts, context menu, `EmptyState`. Verify: single vs double click semantics.
16. `feat: markdown preview pipeline with GFM, alerts, front matter and sanitization` — unified setup, sanitize schema, `FrontMatterCard`, `Alert`, `TaskCheckbox`, `markdown.css`, `useMarkdown` with cancellation and 2 MB guard; snapshot fixtures. ADR 0003.
17. `feat: Shiki code highlighting with dual themes` — core highlighter, JS engine, lazy languages, `CodeBlock` copy button; tests.
18. `feat: KaTeX math rendering` — lazy load, error rendering; tests.
19. `feat: images, videos with fallback, and link handling` — `AssetImage`, `AssetVideo`, `VideoFallback` + `open_external` command, `PreviewLink` (anchors, external via opener, minimal relative `.md` open). Verify: relative image, URL image, unplayable video on Linux shows fallback.
20. `feat: Mermaid diagrams with zoom, pan, fit and full screen` — `MermaidBlock`, runtime init (strict), toolbar, `react-zoom-pan-pinch`, fullscreen dialog, copy source, theme-aware re-render. Verify in all themes.

**M5 — Live updates**
21. `feat(backend): file watcher with debounce, targeted re-walk and batching` — `index/watcher.rs`, `fs://changes`, poll fallback, classifier tests, integration test.
22. `feat(frontend): apply disk changes to tree and live-reload open files` — `tree.applyChanges`, `documents.reload` with scroll preservation, `DeletedBanner`, rename carry-over. Verify: edit in VS Code, delete, rename, create nested folder with a `.gitignore`.
23. `feat: toasts with batching, details and muting` — `toasts` store (fake-timer tests), `ToastHost`, grouped details, mute in status bar + settings; `aria-live`. Verify with a script writing 50 files.

**M6 — Menu, shortcuts, settings, session**
24. `feat: native menu bar and centralized actions` — `menu.rs`, `menu://action`, `menuActions.ts`, `useGlobalShortcuts`, `ShortcutsReferenceTab`, `AboutDialog`. ADR 0006.
25. `feat: settings tab` — appearance, notifications, files (ignore patterns → rescan), data section; persisted via `update_settings`; tests.
26. `feat: session restore and window state` — `session` module, restore sequence, flush on close, `tauri-plugin-window-state`. Verify: close with 3 tabs scrolled, reopen, same state.
27. `feat: accessibility pass` — focus rings, skip link, tab order audit, HC contrast audit of Shiki/Mermaid/KaTeX/toasts, reduced motion everywhere, screen-reader labels. Document in `docs/features/keyboard.md`.

**M7 — Quality and release**
28. `test: Playwright smoke tests with mock IPC` — `e2e/*.spec.ts`, `playwright.config.ts`, CI job wiring. ADR 0007.
29. `ci: build Windows and Linux installers` — `build.yml` with tauri-action, draft release on tag, artifacts on manual run; `bundle.targets`. Verify by `workflow_dispatch` once pushed (user decides when to push).
30. `docs: feature docs, architecture diagrams and README for 0.1.0` — all `docs/features/*.md`, `docs/architecture.md` with Mermaid diagrams, README (features, install, requirements incl. GStreamer packages, shortcuts, roadmap Phase 1 ✓), `CHANGELOG.md` `[0.1.0]`, `CLAUDE.md` refresh, screenshots/GIF captured from the app.
31. `chore: release 0.1.0` — version bump in `package.json`, `Cargo.toml`, `tauri.conf.json`. Merge to `main` and tag `v0.1.0` happen in the close-phase step, after review.

Optional if time allows (after 27): tab drag-reorder; "N changes" counter when muted;
Mermaid keyboard zoom.

---

## 19. Open questions for review

1. **Name**: the README title and the GitHub remote use "IGrasph"; everything else says
   "IGrasp". The plan assumes **IGrasp** and fixes the README; the repository name is
   the owner's call.
2. **Bundle identifier** `io.github.jean3978.igrasp` (determines the app-data folder;
   cannot change later without a migration).
3. **Menu bar**: native OS menu (proposed for MVP) vs a custom VS Code-style title bar
   and menu now.
4. **Git menu**: omit until Phase 4 (proposed) or show it disabled.
5. **"Show hidden" semantics**: one toggle for dotfiles + gitignored entries (proposed)
   vs two separate toggles.
6. **Mermaid look**: `classic` look (proposed) vs Mermaid 12's new `neo` look; dagre vs ELK layout.
7. **Internal `.md` links** in Phase 1: minimal "open if it exists" (proposed) or strictly nothing until Phase 2.
8. **Plain `http:` remote images**: allow (proposed, per requirements) or https-only.
9. **GStreamer in the AppImage** (`bundleMediaFramework`, +15–35 MB): not bundled (proposed; README lists packages) or bundled.
10. **Node**: require ≥ 24.15 (proposed) or switch the DOM test environment to `happy-dom`.
