# Architecture

IGrasp is a [Tauri v2](https://tauri.app) application. A Rust process owns the window, the file
system and all background work; a React + TypeScript frontend running in the system webview
(WebView2 on Windows, WebKitGTK on Linux) renders the interface. They talk through typed IPC
commands and events.

```mermaid
flowchart LR
  subgraph Webview["Webview — React + TypeScript (src/)"]
    UI[Components<br/>features/*] --> Stores[zustand stores<br/>stores/*]
    Stores --> Client[IPC client<br/>ipc/client.ts]
    Bridge[Event bridge<br/>stores/eventBridge.ts] --> Stores
  end
  subgraph Rust["Rust — Tauri (src-tauri/)"]
    Commands[Commands<br/>commands/*] --> Guard[Root guard<br/>paths.rs]
    Commands --> Index[(Index<br/>index/model.rs)]
    Scanner[Scanner<br/>index/scanner.rs] --> Index
    Watcher[Watcher<br/>index/watcher.rs] --> Index
    Index --> Graph[(Document graph<br/>graph/*)]
    Watcher --> Graph
    Commands --> Graph
    Commands --> Search[Search<br/>search/*]
    Search --> Index
    Search --> Graph
    Commands --> AppData[(App data<br/>appdata/*)]
    Commands --> Gateway[AI gateway<br/>ai/gateway.rs]
    Gateway --> Provider[AiProvider<br/>ai/providers/*]
  end
  Provider -- "subprocess, cwd = opened folder" --> CLI[claude CLI]
  Gateway -- "ai://event" --> Bridge
  Client -- invoke --> Commands
  Scanner -- "index://progress, ready" --> Bridge
  Watcher -- "fs://changes" --> Bridge
  Graph -- "graph://progress, ready, changed" --> Bridge
  Search -- "search://results" --> Bridge
  Guard --> Folder[(Opened folder<br/>read-only)]
  AppData --> Disk[(OS app-data folder)]
```

## Rust backend (`src-tauri/src`)

| Module | Role |
|---|---|
| `lib.rs` | Builder: plugins (log, dialog, opener, window-state), state, commands, window fallback. |
| `state.rs` | `AppState`: app data plus the open `Workspace` (root guard, scan generation, options, shared index, cancel flag, watcher handle, document graph, symbol-search cache, running text search). Replacing or dropping the workspace cancels its background work. `ScanContext` is what the scan, the watcher and the graph builder share. |
| `paths.rs` | `RootGuard`: root-relative `/` paths in, canonical absolute paths out; rejects traversal, absolute, drive and UNC paths, and symlinks or junctions escaping the root. |
| `index/model.rs` | In-memory index of markdown files; folders exist only while they contain markdown; diffing for the watcher. |
| `index/scanner.rs` | Parallel, ignore-aware walk (`ignore` crate); scoped walks for the watcher. |
| `index/watcher.rs` | Debounced `notify` events → classification → targeted re-walk → `fs://changes`; then the same batch (with the raw event paths) goes to the graph; poll fallback. |
| `graph/` | The document graph ([ADR 0009](decisions/0009-document-graph-in-rust.md)): `parse.rs` (pulldown-cmark → headings, anchors, links with lines), `slug.rs` (github-slugger port), `links.rs` (target and status of a link), `mod.rs` (graph with a reverse target map, parallel build, incremental `apply`, events). |
| `search/` | `symbols.rs` (Ctrl+T, nucleo-matcher, cached candidates), `text.rs` (Ctrl+Shift+F, grep crates, streamed batches), `globs.rs` (VS Code-style include/exclude), `SearchRegistry` (one running search, cancellation). |
| `commands/` | `workspace.rs` (open/close/rescan/list, recent files), `files.rs` (read markdown and text files, open media externally, open with the default app, reveal in the file manager), `graph.rs` (link status, backlinks, broken links, status), `search.rs` (symbols, text, cancel), `appdata.rs` (settings, recents, sessions, app info), `ai.rs` (provider status, capabilities and choice, context and size estimate, start an operation for a user action, answer a permission, cancel, conversations per folder). |
| `appdata/` | Versioned JSON files in the OS app-data folder, written atomically, recovered when corrupt; `conversations.rs` keeps the AI conversations per folder. |
| `ai/` | AI providers behind one trait ([ADR 0015](decisions/0015-ai-provider-abstraction-and-gateway.md)): `types.rs` (neutral request, events, capabilities, status), `gateway.rs` (the only door: provider chosen in the settings, a user action per operation, one at a time, the permission policy, cancelled when the folder, window or app closes), `policy.rs` (permission kind → Ask / Allow / Deny), `context.rs` (instruction files and current file, bounded), `estimate.rs` (size buckets), `process.rs` (children die with the app), `providers/claude_cli/` ([ADR 0014](decisions/0014-claude-cli-integration.md): `cli.rs` probes, `turn.rs` one process per operation, `protocol.rs` wire format → events), `providers/mock.rs` (tests). |
| `error.rs` | `AppError`, serialized as `{ code, message }`. |

The frontend never reads files directly: there is no fs plugin and no shell plugin
([ADR 0002](decisions/0002-file-access-through-rust-commands.md)).

### IPC commands and events

| Command | Returns |
|---|---|
| `open_root`, `close_root`, `rescan`, `list_dir` | Folder info, generation, folder listings. |
| `list_recent_files(offset, limit)` | Markdown files newest first (Recent changes). |
| `read_markdown`, `read_text_file` | File contents (`read_text_file`: any text file, `NotText` / `TooLarge`, first 1 MB). |
| `open_external`, `open_with_default_app`, `reveal_in_file_manager` | Media only / text files that are not programs ([ADR 0013](decisions/0013-opening-files-with-the-default-app.md)) / any file or folder. |
| `get_graph_status`, `get_doc_links`, `get_backlinks`, `list_broken_links` | Graph progress and broken count, a document's links with status, documents linking to one, every broken link. |
| `search_symbols` | Ctrl+T hits (files and headings) for a query, with a request id. |
| `search_text`, `cancel_search` | Starts a full-text search (returns its id) / stops it. |
| `ai_status`, `ai_capabilities`, `ai_providers`, `ai_set_provider`, `ai_context`, `ai_estimate`, `ai_start`, `ai_respond_permission`, `ai_cancel` | Provider installed and logged in (cached 60 s) / what it supports / the providers / switch provider / what a message carries / its size / starts an operation for a user action in the open folder (returns its id) / answers a permission request / stops the operation. |
| `list_conversations`, `get_conversation`, `save_conversation`, `delete_conversation`, `forget_conversations` | The AI conversations of the open folder (app data only). |
| `get_settings`, `update_settings`, `get_recent_folders`, …, `get_session`, `save_session` | App data. |

| Event | When |
|---|---|
| `index://progress`, `index://ready`, `index://error` | Scan of a generation. |
| `fs://changes`, `fs://watch-status` | A batch of changes on disk; how the folder is watched. |
| `graph://progress`, `graph://ready`, `graph://changed` | Graph build (≤ 4/s), done, and documents whose links changed with the broken count. |
| `search://results` | A batch of full-text results (`done` on the last one). |
| `ai://event` | One provider-neutral event of an operation (`session`, `textDelta`, `text`, `toolUse`, `toolResult`, `permissionRequest`, `usage`, `error`, `done`). |
| `appdata://recovered` | A corrupt app-data file was reset. |

## Frontend (`src`)

| Folder | Role |
|---|---|
| `ipc/` | The `Backend` interface, its Tauri implementation (the only code calling `invoke`/`listen`) and the in-memory mock used in the browser and in tests. `generated/` holds the TypeScript types exported from Rust by ts-rs. |
| `stores/` | zustand stores: `workspace` (layout: sidebar view, right panel), `tree`, `tabs` (document and code tabs, pending scroll targets), `documents`, `textFiles`, `history`, `recentFiles`, `graph`, `outline`, `quickOpen`, `search`, `settings`, `toasts`, `recent`, `ui`, `ai` (provider status and capabilities, conversation, pending permissions, usage); `session.ts` (save/restore), `diskChanges.ts`, `eventBridge.ts` (backend events → stores). |
| `features/` | UI by feature: `titlebar` (menu bar, toolbar, window controls, `menuActions.ts`), `shell` (layout, activity bar, sidebar host, status bar), `explorer`, `search`, `recent`, `links` (broken links, backlinks), `outline`, `rightpanel`, `quickopen`, `code` (code viewer), `tabs`, `preview` (markdown pipeline, link resolver, reveal helpers), `mermaid`, `toasts`, `settings`, `shortcuts`, `welcome`, `splash`, `about`, `ai` (chat panel, event reducer, line diff). |
| `components/` | Shared UI: buttons and `VirtualRows` (the virtualized, keyboard-navigable list behind every new view). |
| `styles/` | Design tokens and the three themes. |
| `lib/` | Pure helpers (paths, link classification, platform). |

Every user action is defined once in `features/titlebar/menuActions.ts`; menus, toolbar buttons
and keyboard shortcuts all dispatch through it.

### Markdown pipeline

```mermaid
flowchart LR
  MD[markdown] --> P[remark-parse + gfm<br/>front matter, math]
  P --> R[remark-rehype<br/>+ rehype-raw]
  R --> A[GitHub alerts]
  A --> L[source lines<br/>data-line]
  L --> S{{rehype-sanitize}}
  S --> Slug[heading ids]
  Slug --> K[KaTeX]
  K --> H[Shiki]
  H --> M[Mermaid blocks]
  M --> J[React elements]
```

Untrusted HTML is sanitized **before** the trusted generators (KaTeX, Shiki) run
([ADR 0003](decisions/0003-markdown-pipeline-sanitize-before-generators.md)). The pipeline, KaTeX,
Shiki languages and Mermaid are loaded on first use.

## Data flows

### Opening a folder

```mermaid
sequenceDiagram
  actor User
  participant UI as Frontend
  participant R as Rust
  User->>UI: Open Folder (dialog) or a recent folder
  UI->>R: open_root(path)
  R->>R: canonicalize, allow asset access, start background scan
  R-->>UI: RootInfo (generation, toggles)
  UI->>R: get_session(root)
  R-->>UI: Session (tabs, folders, layout)
  R-->>UI: index://progress (≤ 4/s)
  R-->>UI: index://ready
  UI->>R: list_dir("") and expanded folders
  UI->>UI: restore tabs (missing files dropped), scroll positions
  R->>R: start watching the folder
```

Every scan has a **generation**; results and events of an older generation are ignored, so
opening another folder or toggling dotfiles while a scan runs is safe.

### A file changes on disk

```mermaid
sequenceDiagram
  participant Agent as AI agent / editor
  participant W as Rust watcher
  participant B as Event bridge
  participant UI as Tree, tabs, toasts
  Agent->>W: writes 50 files
  W->>W: debounce 200 ms, classify, re-walk changed paths
  W-->>B: fs://changes (added, modified, removed, renamed, dirsChanged)
  B->>UI: refresh loaded folders, reload open documents
  B->>UI: toasts (1.5 s quiet window, grouped above 3 changes)
  W->>W: graph.apply: re-parse changed docs, re-check links to changed paths
  W-->>B: graph://changed (docs, removed, brokenCount)
  B->>UI: refresh link flags of open docs, backlinks, Broken Links view
```

### The document graph

```mermaid
flowchart TB
  Ready[index://ready] --> Build[graph::start_build]
  Build --> Workers[up to 8 readers<br/>read + pulldown-cmark]
  Workers -->|batches of 64| Graph[(Graph<br/>docs + reverse target map)]
  Graph --> Resolve[resolve every link<br/>index, anchors, disk]
  Resolve --> GReady[graph://ready]
  Changes[watcher batch<br/>Changes + raw paths] --> Apply[graph::apply]
  Apply -->|re-parse changed docs| Graph
  Apply -->|re-check links pointing at changed paths| Graph
  Apply --> GChanged[graph://changed]
```

Headings and anchors use the same slugs as the preview (two shared fixtures are asserted by both
test suites), and a link to a heading stays `NotChecked` until its target is parsed, so the UI
never flags a link it is not sure about.

### From a keystroke to a highlighted line

```mermaid
sequenceDiagram
  actor User
  participant P as Search panel
  participant S as search store
  participant R as Rust search
  participant D as Document tab
  User->>P: types "agent" (200 ms debounce)
  P->>S: run()
  S->>R: search_text(request) (cancels the previous search)
  R-->>S: searchId
  R-->>S: search://results batches (every 50 ms / 200 matches)
  S->>P: merged results by file (virtualized tree)
  User->>P: Enter on a match (or F4)
  P->>S: openMatch → tab with pending { line, highlight }
  S->>D: render the document (data-line on blocks)
  D->>D: scroll to the block of the line, flash it, CSS highlight of "agent"
```

## State on disk

All state lives in the OS app-data folder (`%APPDATA%\io.github.jean3978.igrasp` on Windows,
`~/.local/share/io.github.jean3978.igrasp` on Linux), never in the opened folder:
`settings.json`, `recent-folders.json`, `sessions.json`, `conversations/` (`index.json` maps each
folder to a `c0001.json` of its AI conversations), and `logs/` (in the OS log folder).

## Decisions

See [docs/decisions](decisions/README.md) for the reasoning behind each major choice.
