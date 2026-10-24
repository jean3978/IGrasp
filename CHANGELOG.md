# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Search in files no longer stays on "Searching…" with no results when a small search finishes
  before the app learns its id, and a search started while another was starting no longer mixes
  in the older results.
- Search results follow renamed files instead of dropping them.
- "Stopped at the result limit" is shown only when results were really left out, and the limit
  is now exact.
- After a rescan (for example toggling dotfiles), open documents get their broken-link flags and
  backlinks back; slow, outdated answers no longer overwrite newer ones.
- Adding or removing a folder's README updates the links to that folder.
- Open in Default Editor also checks the file's real name, so a symlink or a Windows name ending
  with a dot or a space (`run.bat.`) can never launch a script.

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
