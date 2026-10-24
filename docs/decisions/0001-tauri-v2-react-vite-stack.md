# 0001 — Tauri v2 with a React + TypeScript + Vite frontend

- Status: Accepted
- Date: 2026-10-23

## Context

IGrasp is a desktop app for Windows and Linux. It needs native file system access, a file
watcher, and calls to the `git` and `claude` command-line tools, together with a rich
document-rendering UI (markdown, Mermaid, code highlighting, diffs, graphs).

## Decision

- **Tauri v2** with a Rust backend: small installers, the system webview instead of a bundled
  Chromium, and a capability-based permission model.
- **React 19 + TypeScript + Vite** for the frontend: the markdown (unified/remark/rehype), Mermaid,
  React Flow and Monaco ecosystems are all JavaScript-first.
- **zustand** for state: small, testable stores with no boilerplate.
- **npm** as package manager (nothing extra to install, identical on CI runners).

## Consequences

- Rendering differs slightly between WebView2 (Chromium) and WebKitGTK; both are tested in CI and
  features avoid engine-specific APIs.
- Old Linux distributions with WebKitGTK < 2.44 are not supported (Mermaid ships ES2024 code).
- Two languages to maintain; the IPC boundary is typed from Rust with `ts-rs` to keep them in sync.
