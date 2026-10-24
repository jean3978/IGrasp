# 0002 — File access only through guarded Rust commands

- Status: Accepted
- Date: 2026-10-23

## Context

Markdown files can contain untrusted HTML, and AI agents write them. If the webview were ever
tricked into running script, broad file system permissions would let it read anything on the
machine. The app also must never write inside the opened folder in phase 1.

## Decision

- No `tauri-plugin-fs` and no `tauri-plugin-shell`. The frontend reads project files only through
  custom Rust commands (`read_markdown`, `list_dir`, …).
- The frontend sends **root-relative paths** with `/` separators. A `RootGuard` in Rust rejects
  `..` and absolute components, canonicalizes the joined path (resolving symlinks, using `dunce` to
  avoid Windows `\\?\` prefixes) and requires it to stay under the canonical root.
- Images and videos are loaded through Tauri's asset protocol. Its static scope is empty; when a
  folder is opened, Rust adds that folder with `asset_protocol_scope().allow_directory(root, true)`.
- `open_external` (open a file with the OS default app) applies the same guard in Rust; the
  `opener` plugin is only allowed to open `http(s)` URLs from the webview.

## Consequences

- Every new file-related feature needs a Rust command, which is a little more code but keeps one
  audited entry point.
- The asset protocol scope has no "remove" operation: folders opened earlier in the same session
  stay readable through it until the app exits. This is accepted because the user explicitly chose
  those folders. A custom URI scheme with HTTP Range support is the option if this ever matters.
