# 0004 — Background index built with the `ignore` crate

- Status: Accepted
- Date: 2026-10-23

## Context

The file tree shows only markdown files, hides folders without markdown, respects `.gitignore`,
and must stay smooth on repositories with 10,000+ files. Scanning must never block the UI, and
later file-system events must apply the same ignore rules to files that appear after the scan.

## Decision

- Scan with `ignore::WalkBuilder` (the walker behind ripgrep): parallel, and it already implements
  `.gitignore`, `.ignore`, `.git/info/exclude`, parent-folder ignore files and hidden files.
  `require_git(false)` keeps `.gitignore` working when a subfolder of a repository is opened.
  `.git` and `node_modules` are always skipped; the user's extra patterns are added as override
  globs, so they apply even when ignored files are shown.
- The scan runs on a background thread, reports `index://progress` at most every 250 ms, and
  publishes the finished index with `index://ready`. A **generation** number tags every scan;
  opening another folder or rescanning cancels the previous scan and stale results are dropped.
- The tree is shown only once the index is ready (no partial trees, which would prune folders
  wrongly while their markdown is not found yet).
- The frontend lists folders **lazily** with `list_dir`; the index keeps, for every folder, the
  number of markdown files below it, so empty folders never appear.
- "Show ignored" runs a second, ignore-respecting walk to know which entries are ignored and dim
  them; "show dotfiles" only toggles the walker's hidden-file filter.
- Later file-system events re-walk only the affected folder through the same `WalkBuilder` and
  diff it against the index (see the watcher), so ignore rules apply to new files too.

## Consequences

- A 12,000-file tree scans well under the 3-second budget of the unit test in debug builds.
- The whole index of markdown files lives in memory (paths and a few numbers per file), which is
  small even for large repositories because only markdown files are kept.
