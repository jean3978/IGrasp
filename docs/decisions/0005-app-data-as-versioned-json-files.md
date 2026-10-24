# 0005 — App data as versioned JSON files

- Status: Accepted
- Date: 2026-10-23

## Context

IGrasp keeps settings, recent folders and per-folder sessions, and later read snapshots and chat
history. All of it must live in the OS app-data folder, never inside the opened project. The data
is small, read at startup and written on change.

## Decision

- One JSON file per concern in `app_data_dir()` (`settings.json`, `recent-folders.json`,
  `sessions.json`), each with a `version` field for future migrations.
- Our own small module (`src-tauri/src/appdata/`) instead of `tauri-plugin-store`:
  - **atomic writes**: a temp file in the same folder is written, synced, then renamed over the
    target, so a crash never leaves a half-written file;
  - **corruption recovery**: an unparsable file is renamed to `<name>.corrupt-<timestamp>.json`,
    defaults are used, and the frontend receives `appdata://recovered` to show a toast;
  - **typed contents** shared with the frontend through `ts-rs`;
  - all writes are serialized through one mutex, and values are cached in memory after the first
    read.
- Unknown fields are ignored and missing fields take their defaults (`#[serde(default)]`), so
  older and newer versions of the app can read each other's files.
- Sessions are capped at 50 folders (least recently saved evicted) and recent folders at 10.

## Consequences

- No dependency on the store plugin's file format or JavaScript-side access to app data.
- Each new kind of state needs a small amount of Rust code (a struct and accessor).
