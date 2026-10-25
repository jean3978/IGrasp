---
igrasp: tutorial
id: poc-tutorials-trace-it-what-happens-when-a-file-changes-on-disk-2026-10-25
title: 'Tracing a disk change through IGrasp: from notify event to tab, tree and toast'
intro: You will be able to follow one edited, replaced, renamed or deleted markdown file from the Rust watcher (`index/watcher.rs`) through the `fs://changes` and `graph://changed` events to the zustand stores that update the tree, tabs, toasts and link flags. You will also know where a fix to this flow goes and which tests, Rust or Vitest, cover it.
project: igrasp
subject: 'Trace it: what happens when a file changes on disk'
familiarity: contributing
length: standard
generated: 2026-10-25T15:55:56Z
provider: claude-cli
model: sonnet
generationCommit: d353601
chapters:
- id: c1
  title: 'The watcher: debounce, classify, plan'
  goal: 'Explain how `WatchContext::handle` in `src-tauri/src/index/watcher.rs` turns a debounced `notify` batch into a `Plan` via `classify`: which events are ignored (Access, `.git`, `node_modules`, non-markdown creations), when an ignore file forces `full_rescan`, and what the poll fallback is.'
  minutes: 4
  file: 01-the-watcher-debounce-classify-plan.md
- id: c2
  title: 'From plan to `fs://changes`: index diff and the replaced-in-place rule'
  goal: Trace `apply_plan` and `Index::diff_within` into `to_event`. Explain why a file removed and added in one batch is reported as `modified`, how `renamed` and `dirsChanged` are derived, and what `generation` guards.
  minutes: 4
- id: c3
  title: 'The frontend fan-out: bridge, tabs, tree and toasts'
  goal: 'Follow `fs://changes` through `eventBridge.ts` into `applyDiskChanges` (`diskChanges.ts`): its ordering, `useTree.applyChanges`, `useDocuments.reload` and `revision`, `keepScrollTop`, and the 1.5 s quiet window and grouping in `toasts.ts`.'
  minutes: 5
- id: c4
  title: The graph follow-up and how the flow is tested
  goal: Explain how the batch reaches `graph::apply` and `graph://changed`, how `useGraph.onChanged` refreshes links and backlinks, and how `diskChanges.test.ts` drives the flow with the mock backend (`writeFiles`, `deleteFiles`, `renameFile`, `emit`).
  minutes: 4
sources:
- path: src-tauri/src/index/watcher.rs
  lines: 329-358
  sha256: 03cc965f727a3719b6aada1e12957bc2e87c28b46220ba1f561e05375618f12d
- path: src-tauri/src/index/watcher.rs
  lines: 76-89
  sha256: 345f58685a90d7e3276262265d8d7095290dfa5c013de50aeeda000a28215e0f
- path: src-tauri/src/index/watcher.rs
  lines: 100-123
  sha256: acbf3705fe5ba3e8dd5fdab688f4c093294a0923aa29e638f996e101dfe45fff
- path: src-tauri/src/index/watcher.rs
  lines: 124-142
  sha256: 990fb8f1cffd71386c7d35db0c7a364ff9b120b5ecf60ddd208d0f8bcedf7e06
- path: src-tauri/src/index/watcher.rs
  lines: 143-166
  sha256: 3056baa8595cd273d23d18c2d2b6daac54a9b37492838d72634597557142074f
- path: src-tauri/src/index/watcher.rs
  lines: 559-579
  sha256: aea643371400c27b89e6ff34dcf77eb213799e3fc12b1f5f12f4b007008ee579
- path: src-tauri/src/index/watcher.rs
  lines: 143-157
  sha256: d9e6921a72dc387db0f145aa57853041970284e7fc32b3e85e0409e64e93fd7e
- path: src-tauri/src/index/watcher.rs
  lines: 91-98
  sha256: 412a35dde85ba6b71d4fa44c54b3cad00325e4eaddd6d399e49bbf22d274823b
- path: src-tauri/src/index/watcher.rs
  lines: 109-127
  sha256: d180cafe07bb0e52aafa43a4b78b03bed185a12ff40df8b9178cd9294e6ff9c2
- path: src-tauri/src/index/watcher.rs
  lines: 205-252
  sha256: ff0510ad336e25008037cdd4c08fb2cd8a78ca2350fd8c9cef3aef7aea8f1c66
- path: src-tauri/src/index/watcher.rs
  lines: 80-89
  sha256: b0a8fffbff5b4a7c716cf5a7e0d5a45017cbedfa953b9a7bfe2be5093c6c8809
- path: src-tauri/src/index/watcher.rs
  lines: 400-468
  sha256: 2db74e565ffc8be483198e1a07e66b1b1c59a7385df6e83b51a7d1baaf1c9ce8
- path: src-tauri/src/index/watcher.rs
  lines: 58-74
  sha256: aad4dd688cafe8870e12fc0869c7f2d3285021396ee10686e5766f526b97449e
- path: src-tauri/src/index/watcher.rs
  lines: 507-606
  sha256: 44ff801c0e8b75d22d0bfd15e39eb5b835fa1827dd2715ef287b5b5ecf3ace54
- path: src-tauri/src/index/watcher.rs
  lines: 733-748
  sha256: 1049d01b59715094c0f7b12b58521dd82dad5bd038a6a097c9aff0f9a07aab9d
- path: src-tauri/src/index/watcher.rs
  lines: 1-8
  sha256: cde42b2d511e66173f36006e3a4272546b58212995b4700ba7727858cff7bc29
---

# Tracing a disk change through IGrasp: from notify event to tab, tree and toast

You will be able to follow one edited, replaced, renamed or deleted markdown file from the Rust watcher (`index/watcher.rs`) through the `fs://changes` and `graph://changed` events to the zustand stores that update the tree, tabs, toasts and link flags. You will also know where a fix to this flow goes and which tests, Rust or Vitest, cover it.

**Project:** igrasp · **Subject:** Trace it: what happens when a file changes on disk · **For:** developers already contributing · **Length:** standard (~15 min) · **Written:** 2026-10-25 by Hoot with sonnet

## Chapters

1. [The watcher: debounce, classify, plan](01-the-watcher-debounce-classify-plan.md) — Explain how `WatchContext::handle` in `src-tauri/src/index/watcher.rs` turns a debounced `notify` batch into a `Plan` via `classify`: which events are ignored (Access, `.git`, `node_modules`, non-markdown creations), when an ignore file forces `full_rescan`, and what the poll fallback is. (4 min)
2. From plan to `fs://changes`: index diff and the replaced-in-place rule — Trace `apply_plan` and `Index::diff_within` into `to_event`. Explain why a file removed and added in one batch is reported as `modified`, how `renamed` and `dirsChanged` are derived, and what `generation` guards. (not written yet)
3. The frontend fan-out: bridge, tabs, tree and toasts — Follow `fs://changes` through `eventBridge.ts` into `applyDiskChanges` (`diskChanges.ts`): its ordering, `useTree.applyChanges`, `useDocuments.reload` and `revision`, `keepScrollTop`, and the 1.5 s quiet window and grouping in `toasts.ts`. (not written yet)
4. The graph follow-up and how the flow is tested — Explain how the batch reaches `graph::apply` and `graph://changed`, how `useGraph.onChanged` refreshes links and backlinks, and how `diskChanges.test.ts` drives the flow with the mock backend (`writeFiles`, `deleteFiles`, `renameFile`, `emit`). (not written yet)

<sub>Written by IGrasp's Academy. Open this folder in IGrasp to take the tutorial; the 16 cited ranges are checked against the files when it opens.</sub>
