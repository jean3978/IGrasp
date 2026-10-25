# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-10-25

Phase 4 — Quiz Me: Hoot the owl asks you questions about how the open project is made, written by
the AI from the project's own files, each citing the lines that prove its answer. Built for
developers on any kind of project (games, web, tools, libraries), with nothing generic.

### Added

- **Project profile** detected locally, without AI, from a marker table: kinds, engines with
  versions (Unreal, Unity, Godot, Bevy, ...), frameworks, languages, modules, build, tests, CI
  and a one-line summary, with the files that justify each value. Correct it (remove, add, notes
  for the generators) and the corrections are kept per folder in app data
  ([ADR 0021](docs/decisions/0021-project-profile-from-a-marker-table.md)).
- **Quiz Me** (Learn menu, `Ctrl+Alt+Q`): a Quiz tab with subjects proposed from the profile,
  5 to 30 questions, **Fixed** (one AI call) or **Adaptive** (rounds of 5 at your level, each
  round started by your Next round), **Whole project** or **Documentation only** sources, the
  model, and the confirmation card before anything is sent. Multiple choice and true/false
  cards played with the keyboard, a hint, the explanation, and **Read more →** opening the cited
  file at its lines. **Look it up** (`L`) opens the cited files before you answer, in a glowing
  window with Hoot perched on top, its eyes following the pointer. Five flames show your level;
  the order follows it.
- **New-quiz wizard**: kind of quiz, subject, then options, one step at a time. Subjects grouped as **Global** concepts (architecture, tech stack,
  security, data and storage, state, design patterns, error handling, concurrency, UI,
  networking, configuration, the engine's model, decisions, build, testing) and **Features**
  (feature pages and folders, a game's own systems such as player, enemies or NPCs, common
  features found by name), each detected locally and named as a concept, never a folder path;
  **your own subject** typed freely; and **Check specific code**: files or folders you pick (or
  open in tabs) for detailed, line-level questions, e.g. before submitting a change. Other
  subjects ask about understanding a concept and its implementation, not one-line trivia.
- **Grounded generation**: the prompt and JSON schema belong to the app; every question is
  checked (a real file of the project, a line range inside it, never an agent instruction file
  or a secret, the scope, no duplicate, a hint that does not give the answer, and a question
  that names something of the project). Rejected questions are sent back with their reasons, at
  most twice, inside the same operation, and the retry is shown
  ([ADR 0022](docs/decisions/0022-grounded-generation-pipeline.md)).
- **Hoot**, an original SVG owl with five animated states and local speech lines; still poses
  under reduced motion ([ADR 0023](docs/decisions/0023-hoot-the-owl.md)).
- **Effects**: confetti on a right answer, sparks for a streak, a ring on a level up (an
  in-house particle system, off under reduced motion or with Settings → Learning → Effects).
- **Results**: score, level reached, best streak, time, tokens and cost, every answer with its
  sources; **Play again** (no AI), **Keep going** (more at your level) and **New quiz**. The quiz
  in progress is saved after each answer and survives a restart; the last 20 quizzes are kept
  per folder.
- **Save results…**: a markdown report with front matter, a summary table and every question as
  a task list, written where you choose in the save dialog (default `quiz-results/`).
- **Shareable quiz files** (**Save quiz…**, default `quizzes/`): markdown with an
  `igrasp: quiz` front matter and one `igrasp-quiz` block per question, readable on GitHub and
  replayed by anyone **without the AI** from Saved quizzes, Learn → Open Quiz File… or the
  preview's **Play this quiz** banner. Cited lines are hashed: a changed source shows a notice
  on the reveal ([ADR 0024](docs/decisions/0024-shareable-learning-files-as-markdown.md)).
- **Preview**: quiz files show the banner and their question blocks as cards with the answer
  folded (parsed as YAML after sanitization, rendered as text).
- **Settings → Learning**: questions per quiz, default mode and sources, effects, results and
  quizzes folders, Forget this folder's quizzes, and the project profile with Reset to detected.
- AI layer: `structuredOutput` and `attempt` events, validated runs with capped retries in the
  gateway (`ai/run.rs`), and an ignored `real_quiz` test that runs a real generation.

### Changed

- The app writes inside the opened folder only what you save through a save dialog (results
  and quiz files); it still writes nothing there on its own.
- The Keyboard Shortcuts tab lists the Learn menu and the quiz keys.

## [0.3.0] - 2026-10-24

Phase 3 — Claude: an AI chat that understands the open folder, edits you review in the rendered
document, and questions about the text you highlight or a region you drag. The AI layer is
provider-neutral (Claude through your installed `claude` CLI is the first provider) and spends
tokens only when you ask.

### Added

- **AI chat**: a floating, movable and resizable panel (`Ctrl+Alt+C`) that talks to the AI
  provider in the open folder, resumes the conversation between messages, shows the usage of
  each answer (tokens, cost, duration) and explains a missing or logged-out provider
  ([ADR 0014](docs/decisions/0014-claude-cli-integration.md)). It looks like a chat, in the
  provider's colours (`--ai-*` tokens in every theme, a soft bloom behind the panel): bubbles
  with an avatar, a rounded message box that grows with its text, the model picker and a
  one-line status in the header. Each answer appears in one piece, rendered like a document
  (tables, code, Mermaid), with an animated "…" while the provider writes; while a permission
  or confirmation card waits, the answer written so far is shown. `Escape` stops a running
  answer, then closes the panel; with the chat closed the status bar shows the running operation
  with Stop and a badge when a permission waits. The panel's place and size are remembered per
  folder in the session.
- **AI provider abstraction and gateway**: provider-neutral contracts and events, an
  `AiProvider` trait with the Claude CLI and a mock implementation, and a single gateway that
  only starts an operation for a user action and stops it when the folder, the window or the
  app closes ([ADR 0015](docs/decisions/0015-ai-provider-abstraction-and-gateway.md)). The
  provider is chosen by `settings.ai.provider` (`ai_providers`, `ai_set_provider`); the provider
  status is cached for 60 s (**Check again** bypasses it).
- **Models from the CLI**: the model picker lists exactly the models the installed Claude CLI
  offers to the account, read from its `initialize` answer (once per CLI version and account, no
  message, no token), with their descriptions as tooltips. The choice is remembered in
  `settings.ai.model`.
- **AI tools over the document**: a small toolbar in the top-right corner of the view (every
  tab, and the empty area) with **AI Chat**, **Ask About Selected Text** and **Ask About a
  Region** ([ADR 0020](docs/decisions/0020-viewport-ai-tools-and-text-selections.md)).
- **Text mode** (`Ctrl+Alt+S`, View menu): highlight text like in an editor; releasing the mouse
  (anywhere, even over the chat) attaches it with the source lines that hold it, narrowed from
  the block to the highlighted text. Opening another file turns it off.
- **Region** (`Ctrl+Alt+R`, View menu): drag a rectangle over a markdown or code tab (mouse, or
  arrows + Enter); the source of the blocks it covers is attached as text.
- For both, the chat opens **next to the selection** without covering it, with the draft "About
  this selection:" or "About this region:"; the selection stays **highlighted** while the chat
  is open, and one **selection line** at the top of the chat recalls it ("Selection · lines 3–7 ·
  Start of the text…", ✕ to drop it). Nothing is sent until Send.
- **Quick actions** on the selection: Rewrite, Shorten, Expand, Fix grammar, Make a table, Make a
  diagram, Explain. Each sends one message; the editing ones ask for one edit of exactly the
  highlighted text, which goes through the permission settings and the inline review.
- **"Uses AI" marker**: a small sparkle (with the provider's name in its tooltip) on every
  control that can start an AI operation.
- **Confirmation card**: a message whose estimated size (`ai_estimate`, from metadata only:
  small / medium / large) reaches `settings.ai.confirmFrom` (default large) asks for a
  confirmation before it starts.
- **Context**: a bar above the message box lists what the message carries, the provider's
  instruction files from the root down to the current file's folder and the current file, with
  sizes; ✕ leaves a document out. The list is computed when the panel opens and when the active
  tab changes, never on disk changes. `ai_start` receives the paths still listed and Rust reads
  them through the root guard, inlining up to 32 KB per instruction file and 96 KB for the
  current file (larger files are listed for the model to read).
- **Permissions**: every permission request says what it would do (markdown edit, other file
  edit, command, web, other). `settings.ai.permissions` sets Ask / Allow / Deny per kind (all Ask
  by default); the gateway answers by itself when the settings say Allow or Deny, refuses every
  write of a read-only operation, and the chat shows each automatic decision. A prompt also
  offers **Allow for this conversation** (a rule listed in the panel header, cleared by New
  conversation). The CLI runs with `--permission-mode default` so its own default mode never
  bypasses the app's policy; its own allow rules are documented as a limit
  ([ADR 0019](docs/decisions/0019-permission-policy-history-and-floating-chat.md)).
- **Settings → AI**: the provider status, the provider and default model, one Ask / Allow / Deny
  row per permission category with warnings and Reset to defaults, the confirmation threshold,
  the conversations kept per folder and **Forget this folder's conversations**.
- **Inline edit review**: a markdown edit inside the folder opens its tab in review mode, a
  rendered diff at block level with Accept / Reject per change (`A` / `R` on a focused change), a
  review bar with Accept all (`Alt+Shift+A`), Reject all (`Alt+Shift+R`), Open in chat and
  Apply. Only the accepted changes are written, by the provider: the app sends a neutral edit
  (the accepted hunks, or the composed content of a `Write`) and the provider maps it to its own
  tool input. The document stays where the reader was when the review closes and the written
  file reloads. The chat shows an Edit card with **Review in preview**, the status bar leads to
  the review when the chat is closed, and other edits keep the line-diff card
  ([ADR 0017](docs/decisions/0017-rendered-markdown-diff-at-block-level.md)).
- **Conversation history per folder** (app data, `conversations/`): each conversation is saved
  when an operation ends and on New conversation (`Ctrl+Alt+N`), trimmed to
  `settings.ai.historyLimit` conversations and 400 items each, and recovered like the other
  app-data files when corrupt. **History** (`Ctrl+Alt+H`) lists, filters, deletes and reopens
  them; a conversation the provider no longer knows offers **Start a new conversation from
  here**. Commands `list_conversations`, `get_conversation`, `save_conversation`,
  `delete_conversation`, `forget_conversations`.
- **Mock AI provider** for the browser dev mode and the tests, scripting every case the UI
  handles (one or two hunks, rewrite, new file, code edit, command, web, slow, crash, lost
  conversation) and applying the same permission policy as the gateway.
- Tests: the "no token without a user action" checks (Rust over the whole backend, Vitest over
  the UI), the provider-neutrality scan of the frontend, Playwright smoke tests for the chat,
  the inline review, the selections and the quick actions, and ignored tests against the real
  CLI.

### Changed

- Roadmap: a **Tutorials** phase (Hoot's Academy) is added as Phase 5; Editing, Git and the
  Mermaid visual editor move to Phases 6, 7 and 8. The quiz and tutorials are grounded in the
  whole project, not only its markdown files
  ([ADR 0016](docs/decisions/0016-learning-features-grounded-in-the-project.md)).
- Accessibility of the AI features: events reach screen readers through one polite live region
  (streamed text is not read as it arrives); the chat panel follows the toolbar in the Tab
  order; focus moves to the first undecided change when a review opens, to the document when it
  is answered, to the message box when a card is answered, back to the AI Chat button when the
  chat closes, and back where it was when a region selection is cancelled; the keyboard region
  selection announces its size; the review toolbar sits on its own row above each change and
  decided changes show the version not kept dashed and muted.
- Sessions also remember the AI panel (open, position, size); sessions saved by 0.2.0 load
  unchanged. The sidebar and right panel widths saved are the ones the user set; a panel the
  layout squeezes in a small window returns to it.
- The preview keeps source line markers (`data-line`) on lists and GitHub alert blocks, and keeps
  the previous render on screen while a new version renders (a reload never blanks a document).
- Tooltips and menus are drawn above every floating panel.

### Fixed

- A file saved through a temporary file renamed over it (as editors and the AI CLI save) showed
  "deleted on disk" with its old content until it was opened again: the watcher reported it as
  removed and added in one batch. That is now a modification, and the open tab reloads in place.
- The sidebar and the right panel could not be resized: a drag stopped after its first step,
  because each width it reported came back to the panel as its default size.

### Performance

- A 400-item conversation renders a streamed event in one frame (about 17 ms); the block diff of
  a 5 000-line document takes about 130 ms.

### Known limitations

- The Claude CLI integration was verified on Windows only, and the text mode and the selection
  highlight in Chromium; the Linux run is pending
  ([ADR 0014](docs/decisions/0014-claude-cli-integration.md),
  [ADR 0020](docs/decisions/0020-viewport-ai-tools-and-text-selections.md)).
- Quick actions ask the model to change only the selection; they cannot force it. The review
  shows any change outside the selection, to reject.
- Allow rules in the user's own Claude CLI settings let the CLI run those tools without asking;
  every call still appears in the chat.

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
