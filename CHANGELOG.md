# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **AI chat (proof of concept)**: a floating chat panel (`Ctrl+Alt+C`) that talks to the AI
  provider in the open folder (Claude through the installed `claude` CLI today), streams the
  answer, shows proposed markdown edits as a diff with Accept / Reject and other tool calls with
  Allow / Deny, resumes the conversation between messages, and explains a missing or logged-out
  provider ([ADR 0014](docs/decisions/0014-claude-cli-integration.md)).
- **AI provider abstraction and gateway**: provider-neutral contracts and events, an
  `AiProvider` trait with the Claude CLI and a mock implementation, and a single gateway that
  only starts an operation for a user action and stops it when the folder, the window or the
  app closes ([ADR 0015](docs/decisions/0015-ai-provider-abstraction-and-gateway.md)).
- **"Uses AI" marker**: a small sparkle (with the provider's name in its tooltip) on every control that can start an AI operation and on the AI Chat button and menu item.
- **Confirmation, usage and stop**: a message whose estimated size reaches the "confirm from"
  threshold (`settings.ai.confirmFrom`, default large) shows a confirmation card (provider,
  model, documents, size class) and starts only on Start; each answer shows its token usage,
  cost and duration; with the chat closed, a status bar item shows the running operation with
  Stop and a badge when a permission waits.
- **AI permission kinds**: every permission request says what it would do (markdown edit, other
  file edit, command, web, other), and accepting an edit carries a neutral edit (all or some of
  its hunks) that the provider maps back to its own tool input. The mock provider scripts every
  case the UI handles (one or two hunks, rewrite, new file, code edit, command, web, image,
  slow, crash, lost conversation).
- **AI permission policy and settings**: `settings.ai` (provider, model, permission rules per
  kind, confirmation threshold, history limit). The gateway answers a request by itself when the
  settings say Allow or Deny, refuses every write of a read-only operation, and the chat shows
  each automatic decision ("Allowed by your settings: Bash …"). The CLI runs with
  `--permission-mode default` so its own default mode never bypasses the app's policy.
- **AI context and size estimate**: `ai_context` lists what a message carries (the provider's
  instruction files from the root down to the current file's folder, then the current file,
  with sizes); `ai_start` takes the paths the user kept and reads them in Rust through the root
  guard, inlining up to 32 KB per instruction file and 96 KB for the current file (larger files
  are listed for the model to read). `ai_estimate` sizes a message from metadata (small /
  medium / large). A region capture (source lines and text) can travel with a message.
- **AI provider setting and remembered model**: the gateway is built from `settings.ai.provider`
  (unknown ids fall back to Claude) and `ai_set_provider` switches it, refused while an
  operation runs; `ai_providers` lists the choices. The model picked in the chat is remembered
  in `settings.ai.model`. Models declare whether they accept images. The provider status check
  is reused for 60 s; **Check again** bypasses it.
- **AI conversations per folder** (app data): `conversations/index.json` maps each folder to a
  file of its conversations (title, provider and model, resume id, usage, transcript items),
  newest first, trimmed to `settings.ai.historyLimit` conversations and 400 items each, and
  recovered like the other app-data files when corrupt. Commands `list_conversations`,
  `get_conversation`, `save_conversation`, `delete_conversation`, `forget_conversations`.
- **Floating AI chat panel**: the chat is a movable, resizable panel over the window (drag its
  header or press Alt+arrows on its title; resize from any edge or corner, or Alt+Shift+arrows),
  kept inside the window, and remembered per folder with its open state in the session.
  `Escape` stops a running answer, then closes the panel; the focus returns to the AI Chat
  button.
- **AI conversation history per folder**: each conversation is saved (app data) when an
  operation ends and on New conversation; the panel's **History** (`Ctrl+Alt+H`) lists them with
  date, model and tokens, filters, deletes, and reopens one to continue it; New conversation is
  `Ctrl+Alt+N`. A conversation the provider no longer knows offers **Start a new conversation
  from here**. Settings → AI → **Forget this folder's conversations**. The chat store is split
  into provider, conversation and panel stores.
- **AI context bar**: above the message box, the instruction files from the root down to the
  current file's folder and the current file, with sizes, listed when the panel opens and when
  the active tab changes (never on disk changes); ✕ leaves a document out of the messages sent
  from that file, and Send passes exactly the paths still listed to `ai_start`.
- **AI permission prompts and settings**: a prompt shows the tool, a summary and its input with
  Allow, Deny and **Allow for this conversation** (a rule listed in the panel header with a ✕,
  cleared by New conversation; matching requests are answered without asking and shown in the
  transcript). Settings → AI gains the provider status, the provider and default model, one
  Ask / Allow / Deny row per permission category with warnings and Reset to defaults, the
  confirmation threshold and the history limit.
- **AI edit review in the preview**: a markdown edit inside the folder opens its tab in review
  mode, a rendered diff with Accept / Reject per change (`A` / `R` on a focused change), a review
  bar with Accept all (`Alt+Shift+A`), Reject all (`Alt+Shift+R`), Open in chat and Apply; only
  the accepted changes are written. The chat shows an Edit card with **Review in preview**, the
  status bar leads to the review when the chat is closed, and other edits keep the line-diff
  card. GitHub alerts, display math and footnotes keep their own blocks in the rendered diff.

### Changed

- Roadmap: a **Tutorials** phase (Hoot's Academy) is added as Phase 5; Editing, Git and the
  Mermaid visual editor move to Phases 6, 7 and 8. The quiz and tutorials are grounded in the
  whole project, not only its markdown files
  ([ADR 0016](docs/decisions/0016-learning-features-grounded-in-the-project.md)).

## [0.2.0] - 2026-10-24

Phase 2 — Navigation: find anything, follow links, and see what changed.

### Added

- **Search everything (Ctrl+T)**: fuzzy search over every file name and markdown heading
  (`#` for headings only, `/` for paths), recent files first, opening a heading scrolls to it.
- **Search in files (Ctrl+Shift+F)**: a Search view with match case, whole word and regular
  expressions, files to include / exclude globs, results streamed and grouped by file with
  highlights, F4 / Shift+F4 to step through matches, query history. Search only, no replace.
- **Activity bar** switching the sidebar between Explorer, Search, Recent Changes and Broken
  Links, with shortcuts and badges; the view is saved per folder.
- **Recent changes**: files by last modification, grouped by day, with markers on files changed
  since the folder was opened.
- **Back and forward** through the documents read: `Alt+←` / `Alt+→`, mouse buttons, toolbar.
- **Right panel** (`Ctrl+Alt+B`) with an **outline** that follows the scroll position, filters
  and collapses (`Ctrl+Shift+O`), and **backlinks** of the active document.
- **Links**: links to documents open in the app and scroll to their `#heading`; folder links
  reveal the folder and open its README; links to source files open a **read-only code viewer**
  (syntax highlighting, line numbers, `#L10-L20`, go to line, wrap, Open in default editor,
  Reveal in file manager); the hovered link's target shows in the status bar.
- **Broken links**: missing files, missing headings, wrong case and links outside the folder are
  underlined with the reason in a tooltip, listed in the Broken Links view with filters, and
  counted in the status bar.
- A document graph in Rust (headings, anchors, links, backlinks) built in the background and kept
  current by the file watcher.

### Changed

- `Ctrl+T`, `Ctrl+Shift+F` and `Alt+←` / `Alt+→` are no longer reserved.
- Shortcuts without Ctrl or Alt are never taken while typing in a text box.
- Sessions also remember the sidebar view, the right panel and code viewer tabs (sessions saved
  by 0.1.0 load unchanged).

### Performance

- On 10,000 documents (release build): graph built in ~0.4 s, 50 changed files updated in ~26 ms,
  Ctrl+T in 10–20 ms, full-text search in 20–35 ms with a warm cache.

## [0.1.0] - 2026-10-24

The first version: a fast, live, read-only viewer for the markdown documentation of a project.

### Added

- Open a folder with the system dialog or from the recent folders (missing folders are flagged
  and can be removed).
- Markdown-only Explorer: `.md`/`.markdown` files and the folders that contain them;
  `.gitignore`, `.ignore` and `.git/info/exclude` respected; `.git` and `node_modules` always
  skipped; toggles for dotfiles and ignored files; extra ignore patterns in Settings; background
  indexing with progress; lazy, virtualized tree that stays smooth with 10,000+ files; full
  keyboard navigation.
- Preview: GitHub Flavored Markdown, GitHub alerts, Shiki code highlighting with a copy button,
  KaTeX math, YAML front matter card, images and videos with an "Open externally" fallback,
  anchor, web and relative markdown links, HTML sanitization.
- Mermaid diagrams with zoom, pan, fit, reset, full screen and copy source.
- VS Code-style tabs (preview and pinned tabs, context menu, keyboard shortcuts).
- Live reload of the tree and open documents when files change on disk, keeping the scroll
  position; deleted and renamed files handled; polling fallback when native watching is
  unavailable.
- Change notifications with batching (one grouped notification for bursts), details and muting.
- Light, Dark, High Contrast and Follow System themes.
- VS Code-style title bar with menus (File, Edit, View, Help), mnemonics and a native-frame
  fallback.
- Settings: theme, font size, reading width, window frame, notifications, ignore patterns,
  defaults, app-data folder, reset.
- Per-folder session restore (tabs, scroll positions, expanded folders, layout) and window
  position and size.
- SVG logo, app icons and an animated splash screen.
- Keyboard shortcuts reference (F1), About dialog, accessibility pass (focus, roles, contrast,
  reduced motion).
- Continuous integration on Windows and Linux (lint, unit tests, end-to-end smoke tests, build
  check) and installer builds (NSIS, MSI, AppImage, .deb).
