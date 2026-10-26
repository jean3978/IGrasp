---
igrasp: tutorial-chapter
tutorial: poc-tutorials-trace-it-what-happens-when-a-file-changes-on-disk-2026-10-25
chapter: c1
---

# 1. The watcher: debounce, classify, plan

> **Hoot:** Before a tab reloads or a toast pops, `index/watcher.rs` has already decided what a burst of raw file events means, so let's watch that decision being made.

## 1. One debounced batch enters WatchContext::handle

`start_watcher` hands `notify_debouncer_full` a closure that calls `WatchContext::handle` once per `DEBOUNCE` window (200 ms). `handle` first bumps `disk_revision`, even for a batch that ends up ignored, because anything computed from the whole folder (the learning profile cache, for example) is now stale. It then reduces each event to a `SimpleEvent`: its `EventKind` plus root-relative paths, with `None` for paths outside the root or non-UTF-8. Only then does it take the index write lock, call `classify` and run `apply_plan`. Events that arrive before the first scan finishes are dropped, since that scan covers them.

Sources: [`src-tauri/src/index/watcher.rs:329-358`](../../../src-tauri/src/index/watcher.rs#L329-L358) — handle: disk_revision, SimpleEvent, classify, apply_plan · [`src-tauri/src/index/watcher.rs:76-89`](../../../src-tauri/src/index/watcher.rs#L76-L89) — SimpleEvent and Plan

## 2. Walking through classify

```igrasp-code-tour
stops:
- path: src-tauri/src/index/watcher.rs
  lines: 100-123
  annotation: '`classify` is a pure function: events, the current `Index`, and a `kind_on_disk` callback (file, folder or gone). The first three rules: skip `Access` events, send any ignore file to `full_rescan`, and pair a `RenameMode::Both` event into `plan.renamed` only when the source is a known file and the target is markdown.'
- path: src-tauri/src/index/watcher.rs
  lines: 124-142
  annotation: 'Per path: the root itself and anything under `.git` or `node_modules` (`is_skipped`) is dropped. Known markdown files that were modified go to `plan.modified`, and removals go to `removed_files` or `removed_dirs`. A remove of something the index never knew is ignored.'
- path: src-tauri/src/index/watcher.rs
  lines: 143-166
  annotation: Everything else (creates, renames, unknown paths) asks the disk. A non-markdown file is skipped, a vanished path is forgotten, and anything else lands in `rewalk`. The final `retain` drops re-walk paths already covered by an outer one, so a new folder is walked once.
- path: src-tauri/src/index/watcher.rs
  lines: 559-579
  annotation: 'The test that pins the ignore rules: a modified `docs/.gitignore` or `.git/info/exclude` sets `full_rescan`, while creations under `.git/objects` and `node_modules` produce `Plan::default()`.'
```

## 3. Where build churn is cut off

```igrasp-spot-it
prompt: Click the line that makes `classify` ignore a newly created file that is not markdown.
path: src-tauri/src/index/watcher.rs
lines: 143-157
answerLine: 145
explanation: The `Some(false) if !markdown => {}` arm means the path is a file on disk and not markdown, so it is dropped before it can reach `rewalk`. That is why compiler output or `target/` churn never costs a directory walk. The test `creations_and_new_folders_are_rewalked_but_other_files_skipped` checks it with `src/main.rs`.
```

## 4. A Modify event arrives for `.git/info/exclude`. What does `classify` do with it?

```igrasp-quiz
kind: multipleChoice
choices:
- It sets `full_rescan` for the whole folder
- It drops the path as part of `.git`
- It adds the path to `rewalk` only
- It adds the path to `modified` only
answer: 0
hint: Compare the order of `is_ignore_file` and `is_skipped` inside the loop, and look at the ignore-rules test.
explanation: '`is_ignore_file` matches `.git/info/exclude` explicitly and is tested at the top of the loop, before `is_skipped` would discard `.git` paths. Ignore rules can change which markdown is visible anywhere, so only a full re-index is safe.'
sources:
- path: src-tauri/src/index/watcher.rs
  lines: 91-98
  why: is_ignore_file and is_skipped
- path: src-tauri/src/index/watcher.rs
  lines: 109-127
  why: order of the checks
```

## 5. What each Plan field asks apply_plan to do

```igrasp-match
prompt: Match each `Plan` field to the work `apply_plan` does for it.
pairs:
- left: full_rescan
  right: Re-index the whole folder with `index_scope` and diff it against the index
- left: modified
  right: Re-stat the known file and keep it only if its size or mtime changed
- left: removed_files
  right: Drop the file from the index and report it as removed
- left: removed_dirs
  right: Remove the folder and every markdown file under it
- left: rewalk
  right: Run the ignore-aware walker on that path and diff the result with `diff_within`
explanation: '`classify` only decides; `apply_plan` touches the disk and the index. A `modified` entry whose mtime and size are unchanged produces no change, and a `rewalk` goes through the same walker as the full scan, so `.gitignore` still applies to files that appear later.'
sources:
- path: src-tauri/src/index/watcher.rs
  lines: 205-252
  why: apply_plan handles each Plan field
- path: src-tauri/src/index/watcher.rs
  lines: 80-89
  why: Plan definition
```

## 6. The poll fallback

`start_watcher` tries `new_debouncer` with the native watcher first. If creating it or `watch(&root, Recursive)` fails, for example when the Linux inotify limit is reached, it logs a warning and builds a `PollWatcher` debouncer with `POLL_INTERVAL` of 2 s. The handler is the same `WatchContext::handle`, so classification and everything after it are identical. Only the `fs://watch-status` event differs: `WatchMode::Native`, `Poll` with the reason, or `Off` if even polling fails. The status bar's "Polling for changes" text comes from that event.

Sources: [`src-tauri/src/index/watcher.rs:400-468`](../../../src-tauri/src/index/watcher.rs#L400-L468) — start_watcher with native and poll paths · [`src-tauri/src/index/watcher.rs:58-74`](../../../src-tauri/src/index/watcher.rs#L58-L74) — WatchMode and WatchStatusEvent

## 7. Run the classifier tests

```igrasp-try-it
instruction: Run the watcher's unit tests and read their names against the rules in `classify`. Then add `--ignored` to see `real_notifications_reach_the_handler`, which uses real file-system notifications. A name filter skips the ts-rs export tests, so run the full `npm run rust:test` before you commit.
command: cargo test --manifest-path src-tauri/Cargo.toml index::watcher
where: terminal
expected: The `index::watcher::tests` cases pass, including `renames_are_paired` and `access_events_are_ignored`; the real-notification test is listed as ignored.
sources:
- path: src-tauri/src/index/watcher.rs
  lines: 507-606
  why: classify unit tests
- path: src-tauri/src/index/watcher.rs
  lines: 733-748
  why: ignored real-notification test
```

## 8. Recap

- `WatchContext::handle` bumps `disk_revision` for every debounced batch, then runs `classify` and `apply_plan` under the index write lock.
- `classify` is pure: it skips Access events, `.git`, `node_modules` and non-markdown creations, and an ignore file (`.gitignore`, `.ignore`, `.git/info/exclude`) forces `full_rescan`.
- If native watching fails, `start_watcher` falls back to a 2 s `PollWatcher` that feeds the same handler and reports `WatchMode::Poll`.

Sources: [`src-tauri/src/index/watcher.rs:1-8`](../../../src-tauri/src/index/watcher.rs#L1-L8) — module overview
