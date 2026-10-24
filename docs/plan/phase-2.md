# Phase 2 — Navigation implementation plan

Status: **implemented** on `phase-2-navigation` (review answers in §16; deviations in the phase summary) · Target tag: `v0.2.0` · Branch: `phase-2-navigation`

Phase 1 delivered a fast, live, read-only viewer. Phase 2 makes a large documentation tree
*navigable*: find anything by name or heading (Ctrl+T), search every file's content
(Ctrl+Shift+F), see what changed recently, move back and forward through what was read, follow
links between documents and into source code, see the outline of a document, and find out which
links are broken and which documents link here. Nothing in this phase writes inside the opened
folder.

---

## 1. Scope

### 1.1 In scope (definition of done)

| Area | Deliverable |
|---|---|
| Search everything (Ctrl+T) | A quick-open dialog over **file names and markdown headings**, fuzzy matched and ranked in Rust, with recent files first; `#` prefix restricts to headings. Opens the file (and scrolls to the heading). First results in under 50 ms for 10k files. |
| Search in files (Ctrl+Shift+F) | A sidebar **Search** view with the VS Code layout: query box with **match case**, **whole word** and **regex** toggles, collapsible **files to include / exclude** globs, results grouped by file with match highlighting, counts, collapse all, clear, refresh, F4 / Shift+F4 to step through results. Results stream in while the search runs and can be cancelled. **Search only, no replace.** |
| Search index in Rust | A **document graph** built in the background after the markdown index is ready: for every markdown file its headings (text, level, GitHub-compatible slug, line) and its links (target, fragment, status). Kept current by the file watcher. Full-text search runs over the live file set, so it is always current by construction (§3.4 explains why there is no inverted index). |
| Sidebar views | A VS Code-style **activity bar** switching the left panel between **Explorer**, **Search**, **Recent changes** and **Broken links**; remembered per folder. |
| Recent changes | Sidebar view listing markdown files **sorted by last modified time**, grouped by day, live-updated by the watcher, with a marker on files changed since the folder was opened in this session. |
| History (Alt+← / Alt+→) | Back / forward through the documents the user read (tabs, links, search results, quick open), including mouse back/forward buttons. |
| Outline | A collapsible table of contents of the active document, built from its headings, in a new **right panel**; follows the scroll position; click to jump; filter box; full keyboard support. |
| Internal links and anchors | Relative links between markdown files open in the app, `other.md#heading` scrolls to the heading after opening, `#heading` scrolls in place, links to folders reveal them in the Explorer (and open their README when present), case mismatches are opened and flagged, external links keep opening in the system browser, with the URL shown in the status bar on hover. |
| Code file viewer | Links to non-markdown text files open a **read-only, syntax-highlighted viewer** tab (Shiki, line numbers, `#L10-L20` line ranges, wrap toggle, copy) with **Open in default editor** and **Reveal in file manager** buttons. Binary and huge files get a card instead of content. |
| Broken links | Links whose file or anchor does not exist are **flagged in the preview** (wavy underline, tooltip with the reason) and listed in a **Broken links** sidebar view grouped by document, with counts and a status-bar item. |
| Backlinks | A **Backlinks** section in the right panel listing the documents that link to the active one, with the linking line, live-updated. |
| Performance | Every feature stays smooth with 10k+ files (§7 has the numbers and how they are measured). |
| Quality | Rust and Vitest coverage for every new module, Playwright smoke tests for every feature, docs and README updated, `v0.2.0` released from `main`. |

### 1.2 Explicitly out of scope (later phases)

- Replace in files, search in non-markdown files, multi-line regex search, saved searches.
- File management (new, rename, delete, duplicate, reveal from the tree), editing, and edit
  conflicts.
- "What changed since I last looked" (last-read tracking and snapshots), rendered diffs,
  per-file history, staleness hints: these need the Git phase. Recent changes in this phase is
  purely "sorted by modification time".
- A Git menu and anything Claude or Quiz related.
- Search across several opened folders; only one root is open at a time.

---

## 2. What Phase 1 gives us to build on

| Existing piece | Reused by |
|---|---|
| `index/model.rs` `Index` (files with `modified_ms`, folders with counts), `SharedIndex` | Recent changes (sort by `modified_ms`), file-name part of Ctrl+T, the file set searched by Ctrl+Shift+F, link-target existence checks. |
| `index/watcher.rs` `fs://changes` (added / modified / removed / renamed) | Document graph updates, recent changes refresh, link status refresh, search result invalidation. |
| `paths.rs` `RootGuard::resolve` / `join_lexical` | Every new command that touches disk (`read_text_file`, `open_with_default_app`, `reveal_in_file_manager`). |
| Generation counter on scans and events | All new events and listings carry `generation`; stale ones are ignored exactly like Phase 1. |
| `features/titlebar/menuActions.ts` + `features/shortcuts/keymap.ts` | Every new action and shortcut (§6.12) is added there, so menus, buttons and keys stay consistent. `RESERVED_SHORTCUTS` loses `Ctrl+T`, `Ctrl+Shift+F`, `Alt+Left`, `Alt+Right` and keeps `F2`, `Delete`, `Ctrl+S`, `Ctrl+E`. |
| `stores/tabs.ts` (preview vs pinned semantics, one tab per path) | The new `code` tab kind shares the preview slot and all shortcuts. |
| `features/preview/links.ts` `classifyLink` + `PreviewLink` | Extended into full link resolution with status (§6.7). `scrollToAnchor` already handles the `user-content-` prefix. |
| `rehype-slug` with `ID_PREFIX` | The outline reads ids straight from the rendered tree; the Rust slugger must produce the same slugs (§3.2). |
| `@tanstack/react-virtual`, `treeKeyboard.ts` (ARIA tree helpers) | Search results, recent changes, broken links and the outline are virtualized trees reusing the same keyboard helpers. |
| `ipc/mock/` fixture + `window.__igraspMock` | Every new command gets a mock implementation so the browser dev mode, Vitest and Playwright keep working. |
| `react-resizable-panels` layout, `session.ts` | Right panel and sidebar view are added to the layout and the per-folder session. |
| Shiki core + lazy languages (`CodeBlock`) | The code viewer reuses the highlighter and theme wiring. |

---

## 3. Backend design (Rust)

### 3.1 Module layout

```
src-tauri/src/
├─ index/            (unchanged: model, scanner, watcher) + a hook that notifies the graph
├─ graph/
│  ├─ mod.rs         Graph (per-doc metadata + reverse link index), build, incremental update, events
│  ├─ parse.rs       pulldown-cmark → DocMeta (headings, links, html anchors), byte offset → line
│  ├─ slug.rs        github-slugger-compatible slugs with per-document de-duplication
│  └─ links.rs       link target resolution (relative, root-absolute, fragments) and status
├─ search/
│  ├─ mod.rs         SearchRegistry: running searches, ids, cancel flags
│  ├─ symbols.rs     fuzzy search over file names and headings (Ctrl+T)
│  ├─ text.rs        full-text search with the grep crates, streamed in batches (Ctrl+Shift+F)
│  └─ globs.rs       VS Code-style include/exclude patterns → globset
├─ commands/
│  ├─ workspace.rs   + list_recent_files
│  ├─ files.rs       + read_text_file, open_with_default_app, reveal_in_file_manager
│  ├─ graph.rs       get_doc_links, get_backlinks, list_broken_links, get_graph_status
│  └─ search.rs      search_symbols, search_text, cancel_search
└─ state.rs          Workspace gains graph: SharedGraph and searches: SearchRegistry
```

`Workspace` keeps owning everything; dropping it (close, reopen, rescan) still cancels all
background work through the shared `cancel` flag, which the graph builder and every running
search check.

### 3.2 Document graph (`graph/`)

Purpose: one in-memory structure answers "which headings does this file have", "what does this
file link to and does the target exist", "who links to this file", and "which links are broken
anywhere", for the whole folder, in microseconds. It is the "search index" for headings; file
names come straight from `Index`.

```
Graph {
  docs:      HashMap<RelPath, DocMeta>,
  backlinks: HashMap<RelPath, BTreeSet<RelPath>>,   // target doc → docs linking to it
  by_target: HashMap<RelPath, BTreeSet<RelPath>>,   // any target path (md or not) → docs linking to it
  ready:     bool, parsed: u32, total: u32, broken: u32,
}
DocMeta {
  modified_ms: i64, size: u64,
  headings: Vec<Heading { level: u8, text: String, slug: String, line: u32 }>,
  anchors:  BTreeSet<String>,            // heading slugs ∪ ids/names of inline <a id> / <a name>
  links:    Vec<Link { href: String, text: String, line: u32, target: LinkTarget, status: LinkStatus }>,
}
LinkTarget = External(url) | Anchor(fragment) | File { rel_path, fragment: Option<String> } | Outside | Unsupported
LinkStatus = Ok | MissingFile | MissingAnchor | CaseMismatch { actual: RelPath } | OutsideRoot | NotChecked
```

- **Parsing** (`parse.rs`): `pulldown-cmark` with `ENABLE_TABLES | ENABLE_FOOTNOTES |
  ENABLE_STRIKETHROUGH | ENABLE_TASKLISTS | ENABLE_YAML_STYLE_METADATA_BLOCKS` (front matter is
  skipped, not parsed as a heading) and `into_offset_iter()` so every heading and link knows its
  byte range; a precomputed table of line starts turns offsets into 1-based lines. Heading text
  is the concatenation of `Text` and `Code` events inside the heading (what `rehype-slug` slugs
  through `hast-util-to-string`). Links: inline, reference, collapsed, shortcut and autolinks;
  images are not links (not validated in this phase). Inline HTML is scanned with two small
  regexes for `<a href>` (a link) and `id="…"` / `name="…"` (an anchor). Heading attributes
  (`{#id}`) stay off, because remark does not support them either.
- **Slugs** (`slug.rs`): a port of `github-slugger` (lower-case, strip the characters its
  `regex.js` strips, spaces → `-`, duplicates get `-1`, `-2`, … per document). A JSON fixture
  `src/test/fixtures/slugs.json` (`[{ "input": "…", "slugs": ["…"] }]`) is run by **both**
  `cargo test` and Vitest (through `rehype-slug` on a synthetic document), so the two
  implementations can never drift silently. Cases: punctuation, emojis, accents, CJK, inline
  code, duplicate headings, leading/trailing spaces, numbers only.
- **Resolution** (`links.rs`): the same rules as `lib/paths.ts` `resolveRelative` (percent
  decoding, `\` → `/`, leading `/` = root, `..` above the root → `Outside`), plus: a target that
  is a folder resolves to `<folder>/README.md` (case-insensitive) when the index has one, else
  stays a folder link; markdown targets are checked against `Index`, other targets with one
  `metadata()` call under `RootGuard`; when a markdown target is missing but matches another
  indexed path case-insensitively, status is `CaseMismatch { actual }` (opens on Windows, breaks
  on Linux: worth flagging in a cross-platform project). Fragments are checked against the
  target's `anchors`; a fragment on a target whose `DocMeta` is not parsed yet is `NotChecked`
  and re-evaluated when it is.
- **Build**: `start_scan` calls `graph::start_build` right after `index://ready`. The builder
  reads every indexed file (`N = min(cpus, 8)` worker threads over an `mpsc` work queue, each
  file read whole, files above `MAX_MARKDOWN_BYTES` skipped and counted), parses, then resolves
  all links in one pass once every doc is parsed (so fragment checks see every target). It emits
  `graph://progress` (≤ 4/s) and `graph://ready`. Queries before readiness return partial data
  with `ready: false`, which the UI shows as "Indexing headings and links…".
- **Incremental update**: the watcher's `WatchContext::handle` already holds the computed
  `Changes`; after emitting `fs://changes` it calls `graph.apply(changes)`: re-parse `added`
  and `modified` docs, drop `removed` ones (renamed = removed + added), then re-resolve (a) the
  links of the changed docs and (b) the links of every doc in `by_target[path]` for each changed
  path (a target appeared or vanished). Non-markdown events are not in `Changes`, so the
  classifier passes the raw event paths too: for each path with an entry in `by_target`, that
  target's links are re-checked (one hash lookup per event path, no walk). Then
  `graph://changed { generation, docs, brokenCount }` is emitted so the frontend refreshes link
  status, backlinks and the broken links view for the listed docs only.
- **Memory**: ~300 bytes per heading and ~200 bytes per link. 10k docs × (20 headings + 15
  links) ≈ 90 MB worst case, typically far less; measured in §7.

### 3.3 Symbol search (`search/symbols.rs`, Ctrl+T)

- Candidates are built lazily from `Index` (one per file: `name`, `rel_path`) and `Graph` (one
  per heading: `text`, owning `rel_path`, `slug`, `line`, `level`), cached per generation and
  invalidated by `fs://changes` / `graph://changed` (rebuilding 10k + 100k candidates takes a
  few milliseconds, so the cache is simply dropped and rebuilt on the next query).
- Matching: **`nucleo-matcher`** (the matcher behind Helix's picker): Smith-Waterman fuzzy
  matching with Unicode case folding and normalization, returns a score and the matched
  indices for highlighting, scores 100k candidates in single-digit milliseconds. The query is
  matched against the file name first and the path second (`Pattern::parse` with
  `CaseMatching::Smart`); a `/` in the query switches to path matching; a leading `#` restricts
  to headings; `>` is not used (no commands). See §16 Q1 for the license note and the fallback.
- Ranking: score, then a bonus for files in the frontend-supplied `recent` list (passed with the
  request, max 50 paths, most recent first), then shorter paths first. Files and headings are
  returned in two groups; the frontend shows "Files" and "Headings" sections.
- Response: at most `limit` (default 50) `SymbolHit { kind, relPath, name, path, line?, slug?,
  level?, score, matchedIndices }`. Each request carries a `requestId` echoed in the response;
  the frontend ignores responses older than the latest request. A query shorter than 1 char
  returns the recent files.

### 3.4 Full-text search (`search/text.rs`, Ctrl+Shift+F)

**Decision: no inverted index.** The required options (regex, whole word, match case,
include/exclude globs) need a scan of the candidate text anyway; an index (for example
`tantivy`) would only pre-filter literal queries, at the cost of maintaining it on every change
and of a 2–3× larger memory footprint. The markdown of a 10k-file project is a few tens of MB
and ripgrep's crates scan that from a warm page cache in well under a second. The file set comes
from the live `Index`, so results are always current; if measurements show cold-disk reads
dominate, an in-memory content cache (fed by the graph builder, which already reads every file)
is the planned step up, not an index (ADR 0010).

- Request: `TextSearchRequest { query, matchCase, wholeWord, regex, include: string, exclude:
  string, maxResults?: number }`.
- Matcher: `grep-regex` `RegexMatcherBuilder` with `case_insensitive(!matchCase)`,
  `word(wholeWord)`, `fixed_strings(!regex)`, `crlf(true)`, `multi_line(false)`; the pattern is
  validated first and an invalid regex returns `InvalidPattern` with the engine's message
  (shown under the query box like VS Code). Rust regex syntax: no back-references or look-around
  (documented in the UI tooltip).
- Searcher: `grep-searcher` `SearcherBuilder` with `line_number(true)`,
  `binary_detection(BinaryDetection::none())` (markdown is text; a NUL would otherwise truncate
  a file silently), no context lines (VS Code shows the match line only), `memory_map` off
  (files are small; reading is simpler and safer on Windows while files are being rewritten).
  A `Sink` collects `Match { line, text, ranges }`: the line is trimmed to 500 characters around
  the first match, and match ranges are computed by `Matcher::find_iter` on the line so the
  frontend highlights every occurrence without re-running the regex.
- Globs (`globs.rs`): comma-separated VS Code-style patterns. Each pattern becomes a `globset`
  glob; a pattern without `/` also gets `**/<pattern>` and `**/<pattern>/**` so `*.md` and
  `docs` behave as users expect; `./docs/**` and `docs/` are normalized. Invalid patterns return
  `InvalidPattern`. Include empty = everything; exclude is applied after include.
- Execution: `search_text` returns a `searchId` immediately and spawns a thread that walks the
  index's file list (filtered by globs), fans out to `min(cpus, 8)` workers through an `mpsc`
  queue, and streams results back with `search://results { searchId, generation, files:
  [FileMatches], done, truncated, stats }`. Batches are flushed every 50 ms or 200 matches,
  whichever comes first, so the panel starts filling instantly without flooding the webview. The
  search stops at `maxResults` (default 20,000 matches, like VS Code) or 2,000 files and reports
  `truncated: true`.
- Cancellation: `cancel_search(searchId)` sets the search's flag; starting a new search cancels
  the previous one; closing or rescanning the workspace cancels all. Workers check the flag per
  file; a cancelled search emits one final `{ done: true, cancelled: true }`.
- Files larger than `MAX_MARKDOWN_BYTES` or unreadable are counted in `stats.skipped`.

### 3.5 Recent files (`commands/workspace.rs`)

`list_recent_files { limit, offset }` sorts the index's `FileEntry` list by `modified_ms`
descending (ties by path) and returns `RecentFilesListing { generation, total, files }`. Sorting
10k entries takes under a millisecond; no cache. The frontend asks again (debounced 300 ms) on
every `fs://changes`.

### 3.6 Text files (`commands/files.rs`)

- `read_text_file { relPath }` → `TextFileContent { relPath, content, size, modifiedMs,
  truncated }`. Rules: resolved through `RootGuard`; must be a regular file; refuses files above
  **5 MB** with `TooLarge`; reads the first 8 KiB and refuses with `NotText` if it contains a NUL
  byte or more than 10 % invalid UTF-8 (the heuristic `git` uses); otherwise decodes like
  `read_markdown` (BOM stripped, lossy) and, above **1 MB**, returns the first 1 MB with
  `truncated: true` (the viewer shows a notice; the rest is readable in the default editor).
  Markdown files are allowed too (used by "view source" later); the frontend decides which tab
  kind to open.
- `open_with_default_app { relPath }`: opens a file with the OS default application, for the
  code viewer's **Open in default editor** button. Safety (ADR 0002 spirit): the path must be a
  regular file under the root **and** pass `read_text_file`'s text check at call time (so the
  button can never launch a binary), **and** its extension must not be in a deny-list of
  executable and script-host extensions (`exe com bat cmd ps1 psm1 vbs vbe js jse wsf wsh msi
  msp scr pif lnk reg hta cpl inf url application gadget jar sh run appimage desktop` — `.js`
  and `.sh` are refused because Windows and some desktops run them rather than open them); on
  Unix, files with an execute bit are refused. Refusals return `Forbidden` and the UI offers
  **Reveal in file manager** instead. Executed only from a user click, never from a link.
- `reveal_in_file_manager { relPath }`: `tauri_plugin_opener::reveal_item_in_dir` on a guarded
  path (file or folder). Called from Rust, so no new capability is needed.
- Language for highlighting is decided by the frontend from the extension and well-known file
  names (`Dockerfile`, `Makefile`, `CMakeLists.txt`, …); Rust sends no language hint.

### 3.7 Errors

`ErrorCode` gains `NotText`, `Forbidden`, `InvalidPattern`, `GraphNotReady` (only for commands
that need the full graph, i.e. none of the listing commands, which return partial data instead)
and `Cancelled`. `BackendError` and the mock follow.

---

## 4. IPC contracts

Types follow the Phase 1 rules (`#[derive(Serialize, TS)]`, `camelCase`, `#[ts(export)]`,
generated by `cargo test`, root-relative `/` paths). Sketches are the contract, not final code.

### 4.1 Commands

| Command | Input | Output | Notes |
|---|---|---|---|
| `search_symbols` | `{ query, limit?, headingsOnly?, recent: string[], requestId }` | `SymbolSearchResult { requestId, generation, graphReady, files: SymbolHit[], headings: SymbolHit[] }` | §3.3. Never errors on an empty index: returns empty lists. |
| `search_text` | `{ request: TextSearchRequest }` | `number` (searchId) | §3.4. Cancels the previous search of this workspace. `InvalidPattern` on a bad regex or glob. |
| `cancel_search` | `{ searchId }` | `void` | Idempotent. |
| `list_recent_files` | `{ limit, offset }` | `RecentFilesListing { generation, total, files: FileEntry[] }` | §3.5. `IndexNotReady` before the first scan completes. |
| `read_text_file` | `{ relPath }` | `TextFileContent { relPath, content, size, modifiedMs, truncated }` | §3.6. `NotText`, `TooLarge`, `NotFound`. |
| `open_with_default_app` | `{ relPath }` | `void` | §3.6. `Forbidden` when refused. |
| `reveal_in_file_manager` | `{ relPath }` | `void` | File or folder under the root. |
| `get_doc_links` | `{ relPath }` | `DocLinks { relPath, graphReady, links: LinkInfo[] }` | `LinkInfo { href, text, line, target: LinkTarget, status: LinkStatus }` keyed by the raw `href` so the preview can look a link up. |
| `get_backlinks` | `{ relPath }` | `Backlinks { relPath, graphReady, items: Backlink[] }` | `Backlink { fromPath, line, text, fragment: string \| null }`, sorted by path then line. |
| `list_broken_links` | — | `BrokenLinksReport { generation, graphReady, parsedDocs, totalDocs, docs: BrokenDoc[] }` | `BrokenDoc { relPath, links: LinkInfo[] }` for every doc with at least one non-`Ok` link that is not `External`/`Unsupported`; `CaseMismatch` and `OutsideRoot` included with their own kind. |
| `get_graph_status` | — | `GraphStatus { generation, ready, parsedDocs, totalDocs, brokenCount }` | For the status bar on startup (events may have been missed). |

### 4.2 Events

| Event | Payload |
|---|---|
| `graph://progress` | `{ generation, parsedDocs, totalDocs }` (≤ 4/s) |
| `graph://ready` | `{ generation, docs, links, brokenCount, elapsedMs, skipped }` |
| `graph://changed` | `{ generation, docs: string[], removed: string[], brokenCount }` |
| `search://results` | `{ searchId, generation, files: FileMatches[], done, cancelled, truncated, stats: { filesSearched, filesMatched, matches, skipped, elapsedMs } }` where `FileMatches { relPath, matches: TextMatch[] }` and `TextMatch { line, text, ranges: [start, end][] }` (character offsets within `text`). A file may appear in several batches; the frontend merges by path. |

### 4.3 Shared type changes

- `Session` gains `sidebarView: 'explorer' | 'search' | 'recent' | 'broken'` (default
  `explorer`), `rightPanel: { visible: boolean; widthPx: number }` (default hidden, 260 px) and
  `SessionTab.kind: 'document' | 'code'` (default `document`). All new fields use
  `#[serde(default)]`, so `version` stays 1 and existing `sessions.json` files load unchanged.
- `Settings` gains `searchMaxResults` (default 20,000; advanced) only if time allows; otherwise
  the cap is a constant. No other settings in this phase.

### 4.4 Frontend IPC layer

`Backend` (`src/ipc/types.ts`) gets one method per command and the three new events in
`BackendEvents`; `ipc/tauri.ts` and `ipc/mock/` implement them. The mock implements: symbol
search with a simple subsequence scorer, text search with JavaScript `RegExp` (same option
semantics, same batching shape, cancellable with a `setTimeout` loop), the graph with a regex
heading/link extractor plus the shared slug fixture, recent files, text files (with a couple of
non-markdown fixture files: `src/main.ts`, a `Makefile`, a fake binary, a 6 MB "huge" file),
and `window.__igraspMock` gains `emitSearchResults`, `setGraphDelay` for tests. The fixture gets
cross-links, a broken link, a broken anchor, a case-mismatched link and a link into `src/main.ts`.

---

## 5. Frontend architecture

### 5.1 Component tree (additions in bold)

```
<WorkspaceLayout>
├─ **<ActivityBar/>**                     36 px, far left: Explorer, Search, Recent changes, Broken links
│                                          (badges: broken count, search running spinner); Git arrives later
├─ <Panel id="sidebar">                   **<SidebarHost/>** renders the active view:
│    ├─ <ExplorerPanel/>                  (unchanged)
│    ├─ **<SearchPanel/>**                SearchInput (toggles), IncludeExclude, SearchResults (virtualized tree)
│    ├─ **<RecentChangesPanel/>**         grouped virtualized list
│    └─ **<BrokenLinksPanel/>**           grouped virtualized tree
├─ <Panel id="main">  <TabBar/> <TabContent/>
│    ├─ <DocumentTab/>                    + link status, scroll-to-line, match highlight
│    └─ **<CodeTab/>**                    read-only highlighted viewer
├─ **<Separator/> <Panel id="right" collapsible>**
│    └─ **<RightPanel/>**                 collapsible sections: Outline, Backlinks
└─ (portals) **<QuickOpenDialog/>**       Ctrl+T, radix Dialog, virtualized results
```

The activity bar lives in the sidebar `Panel` (left of the view) so hiding the sidebar with
`Ctrl+B` hides both, like VS Code's default. Both side panels are `react-resizable-panels`
panels; the right one has `collapsible` so dragging it closed works.

### 5.2 Stores

| Store | State | Key actions |
|---|---|---|
| `workspace` (extended) | `sidebar: { visible, widthPx, view }`, `rightPanel: { visible, widthPx }` | `setSidebarView(view)` (also shows the sidebar), `toggleRightPanel`, `setRightPanelWidth` |
| `history` (new) | `entries: HistoryEntry[]` (`{ relPath, kind, anchorId?, line? }`), `position`, `navigating` flag | `record(entry)` (called by `tabs.openDocument` / `openCode` when not navigating; drops the forward stack; de-duplicates consecutive identical entries; cap 100), `back()`, `forward()` (re-open the tab as preview if it was closed; skip entries whose file no longer exists), `canGoBack/Forward` selectors. Session-less (transient). |
| `search` (new) | `query, matchCase, wholeWord, regex, include, exclude, includeExpanded`, `status: idle/running/done/cancelled/error`, `error`, `searchId`, `results: FileMatches[]` (immutable appends, merged by path), `collapsed: Set<path>`, `stats`, `truncated`, `selected: { path, line } \| null`, `queryHistory: string[]` (last 20, ↑/↓ in the box) | `setOption`, `run()` (debounced 200 ms after typing, immediate on Enter; cancels the previous id; ignores stale `search://results`), `cancel()`, `clear()`, `collapseAll/expandAll`, `openMatch(path, line, ranges)`, `next()/previous()` (F4) |
| `quickOpen` (new) | `open, query, requestId, files, headings, graphReady, selectedIndex` | `openDialog(prefill?)`, `setQuery` (debounced 40 ms, stale responses ignored), `move(delta)`, `confirm()` (opens file and scrolls to heading), `close()` |
| `recentFiles` (new) | `files, total, status, sessionStartMs, highlighted: Set<path>` | `load()`, `loadMore()`, `onChanges(e)` (debounced refresh; adds `added`/`modified` paths to `highlighted`) |
| `graph` (new) | `status: { ready, parsedDocs, totalDocs, brokenCount }`, `linksByDoc: Record<path, LinkInfo[]>` (only for open docs), `backlinks: Record<path, Backlink[]>` (active doc), `broken: BrokenLinksReport \| null` | `refreshDoc(path)`, `refreshBacklinks(path)`, `loadBroken()`, `onGraphChanged(e)` (re-fetch only affected open docs / the active doc's backlinks / the broken report if visible), `invalidate()` on rescan |
| `tabs` (extended) | `TabKind` adds `'code'`; `openCode(relPath, { pin, line? })` reuses the preview slot like documents; `pendingScroll: { anchorId?, line?, ranges? }` per tab, consumed by the tab once rendered | `tabLabel` handles code tabs (same clash rule) |
| `documents` (extended) | `byPath[path].kind: 'markdown' \| 'text'`, `truncated` | `loadText(path)` through `read_text_file`; `reload` picks the right command |
| `ui` (extended) | `hoveredLink: string \| null` (status bar), `outlineFilter` | |

`eventBridge.ts` routes `graph://*` to `graph`, `search://results` to `search`, and extends the
`fs://changes` handler with `recentFiles.onChanges` and `history` pruning (removed paths).
`session.ts` saves/restores `sidebar.view`, `rightPanel`, and tab kinds (a restored code tab
whose file vanished is dropped like a document tab; existence is checked with one
`read_text_file` lazily when the tab is first shown, to avoid stat storms on startup).

### 5.3 Data flows

- **Ctrl+T**: dialog opens with recent files → each keystroke → `search_symbols` (debounced
  40 ms, `requestId`) → list re-renders (virtualized, ≤ 50 rows) → Enter: `tabs.openDocument`
  (preview) and, for a heading hit, `pendingScroll.anchorId = slug` → `DocumentTab` scrolls once
  rendered; `Ctrl+Enter` pins. `history.record`.
- **Ctrl+Shift+F**: `workspace.setSidebarView('search')`, focus the box → typing → `search.run`
  (200 ms debounce) → `search_text` → `search://results` batches merged into `results` →
  virtualized tree → click or Enter on a match → `tabs.openDocument` with `pendingScroll.line`
  and `ranges` → `DocumentTab` scrolls to the nearest `data-line` block and highlights the
  ranges (§6.3). `Esc` returns focus to the results / the box.
- **Link click**: `PreviewLink` → `resolveLink` (§6.7) → document / anchor / code / folder /
  external → `history.record`.
- **Disk change**: `fs://changes` (Phase 1 flows) → `recentFiles.onChanges`, search results
  for `removed` paths are dropped and `modified` files get a "changed since the search" marker
  (no auto re-run; a refresh button re-runs) → Rust `graph.apply` → `graph://changed` →
  `graph.onGraphChanged` → link status of open docs, backlinks of the active doc and the broken
  view update.

---

## 6. Feature details

### 6.1 Activity bar and sidebar views

- Vertical bar, 36 px, icons from `lucide-react` (`Files`, `Search`, `History`, `Unlink`),
  `role="tablist"` with `aria-orientation="vertical"`; the active view has a left accent bar
  like VS Code. Badges: broken links count (hidden when 0 or graph not ready), search spinner
  while running. Clicking the active icon toggles the sidebar (VS Code behavior).
- Keys: `Ctrl+Shift+E` Explorer (exists), `Ctrl+Shift+F` Search, `Ctrl+Shift+R` Recent changes,
  `Ctrl+Shift+L` Broken links; all also in the View menu; the view is saved in the session.
- Each view has a header row (title + view actions) consistent with the Explorer header.

### 6.2 Search everything (Ctrl+T)

- Centered quick-pick (radix `Dialog`, 600 px wide, top-aligned at 15 %), input with
  placeholder "Search files and headings (# for headings only, / for paths)", results list
  (virtualized, row 28 px) with two groups. File rows: icon, name with matched characters in
  bold accent, dim folder path; heading rows: `H2` level chip, heading text with highlights,
  dim "file path". The first row is pre-selected; ↑/↓, PageUp/Down, Home/End move; Enter
  opens as preview, `Ctrl+Enter` pins, `Alt+Enter` opens and keeps the dialog open (quick
  scanning); `Esc` closes. Mouse: hover selects, click opens.
- Empty query: up to 20 recent files from `history` (most recent first, no duplicates).
- "Indexing headings… (3,240 / 10,000)" footer while the graph is building; headings appear as
  they are parsed.
- Opening a heading hit waits for the document to render and then scrolls with the existing
  `scrollToAnchor`; the heading flashes briefly (`:target`-like class for 1.2 s).
- Also in the toolbar (search icon) and the Edit menu ("Go to File or Heading…").

### 6.3 Search in files (Ctrl+Shift+F)

VS Code layout, from top to bottom:

1. **Query row**: text box (`aria-label="Search"`, history with ↑/↓, `Esc` clears or blurs)
   with three inline toggle buttons: **Aa** match case (`Alt+C`), **ab** whole word (`Alt+W`),
   **.\*** regex (`Alt+R`); pressed state styled like VS Code; an error line under the box for
   invalid patterns. A **…** button toggles the include/exclude rows.
2. **Files to include / Files to exclude**: two text boxes, comma-separated globs, placeholder
   "e.g. docs/**, *.md"; tooltip explains the syntax; a "use ignore files" toggle is not needed
   (the index already respects them).
3. **Header**: "12 results in 4 files" (or "No results", "Searching…", "Cancelled", "Stopped at
   20,000 results"), buttons: refresh, clear, collapse all / expand all, view as tree (off: the
   list is already grouped by file; no list/tree switch in this phase).
4. **Results tree** (`role="tree"`, virtualized, row 22 px): file rows (chevron, markdown
   icon, name, dim folder, count badge, hover action "dismiss"), match rows (line text with
   `<mark>` on each range, leading whitespace trimmed, ellipsis when trimmed; tooltip shows the
   line number). Keyboard follows the tree pattern; Enter opens the match (preview tab), `Space`
   previews without moving focus, `Delete` dismisses a row (local only). Files changed since
   the search show a dot with "changed since the search; refresh to update".
5. **F4 / Shift+F4** step through matches from anywhere in the app, opening each in the preview
   tab.

Opening a match: the preview must scroll to and highlight the matched source line in rendered
markdown. A small rehype plugin (`pipeline/lines.ts`, run **before** sanitize, with `dataLine`
allowed by the schema for block elements) copies `node.position.start.line` into `data-line` on
block elements (`p, h1–h6, li, pre, blockquote, table, tr, div[data-alert]`). `DocumentTab`
scrolls the first element with `data-line ≤ target` and the largest such value into view
(`block: 'center'`) and flashes it. Match text highlighting inside that block uses the **CSS
Custom Highlight API** (`CSS.highlights`, available in WebView2 and WebKitGTK ≥ 2.44) over the
block's text nodes when the search text is found in them; when it is not (the match was inside
syntax that does not render, e.g. link targets) or the API is missing, only the block flash
remains. The highlight clears on the next click or key in the document.

### 6.4 Recent changes

- Virtualized list grouped under sticky headers **Today**, **Yesterday**, **This week**,
  **Earlier**, each row: markdown icon, name, dim folder path, relative time ("4 min ago",
  refreshed every minute while visible; tooltip with the full timestamp). Click opens a preview
  tab, double click pins, Enter / Space as in the Explorer. Header actions: refresh, "Reveal in
  Explorer" on a row's context menu / hover action.
- Files modified or added since the folder was opened in this session (`modifiedMs >
  sessionStartMs`, plus anything reported by `fs://changes`) carry a blue dot and bold name, so
  the view doubles as "what did the agent just touch" until the Git phase adds last-read
  tracking. A "Clear markers" action resets them.
- Loads 200 entries, "Show more" appends 200 more; a count in the header ("200 of 1,234").
- Live: debounced reload on `fs://changes`; a removed file disappears, a modified one moves up
  without losing the scroll position when the list is not at the top (the list keeps the
  focused row in view).

### 6.5 Navigation history (Alt+← / Alt+→)

- Entries are recorded when the *user* moves to a document or code file: tree click, tab click,
  link click, quick open, search result, recent changes, backlinks, outline is **not** recorded
  (same document). Back/forward do not record. Consecutive duplicates collapse. Switching
  between existing tabs with `Ctrl+Tab` records too (VS Code does).
- Back re-activates the tab if open, else re-opens the file as a preview tab; entries for files
  removed on disk are skipped; closing the folder clears the history.
- Keys: `Alt+Left` / `Alt+Right` (both prevent the webview's own history navigation, which
  would otherwise fire in WebKitGTK and WebView2), mouse buttons 4 / 5 (`mouseup` listener on
  the window, `preventDefault`), toolbar back/forward buttons in the title bar (disabled when
  nothing to go to, tooltips show the target file name), and Go menu? No: items in the View
  menu ("Back", "Forward").

### 6.6 Outline (right panel)

- Built in the frontend from `rendered.hast`: walk `h1–h6`, take `id` (already prefixed) and
  text, nest by level (a skipped level nests under the nearest shallower heading). No IPC and
  always consistent with the ids the preview actually has. A document without headings shows
  "No headings".
- UI: collapsible tree (`role="tree"`, chevrons, indentation by level, level shown on hover),
  filter box (`Ctrl+Shift+O` focuses the outline and its filter; matches keep their ancestors),
  "Follow scroll" toggle (on by default): the heading whose section contains the top of the
  viewport is highlighted and kept in view, computed from the headings' `offsetTop` on scroll
  (throttled with `requestAnimationFrame`; no IntersectionObserver because long sections have
  no visible heading). Click or Enter scrolls (`scrollToAnchor`) and flashes the heading; the
  document keeps focus semantics like VS Code (focus stays in the outline until Enter).
- Collapsed state per heading id is kept per document while the tab is open (not saved).
- Also reachable from View › Outline and a right-panel toggle in the title bar toolbar
  (`Ctrl+Alt+B` toggles the right panel). The right panel header has two collapsible sections,
  Outline and Backlinks, with the usual chevron rows; the split between them is a nested
  vertical `Group`.

### 6.7 Internal links, anchors and external links

`features/preview/links.ts` becomes the single link resolver, fed by `get_doc_links` status:

| Link | Behavior |
|---|---|
| `#heading` | Scrolls in place (exists). Missing anchor → flagged. |
| `guide.md`, `../a.md`, `/docs/a.md`, `a.markdown` | Opens in a preview tab (Ctrl+click or middle click pins). Missing → flagged, click shows a toast "guide.md does not exist" with the resolved path. |
| `guide.md#section` | Opens, then scrolls to the heading once rendered (`pendingScroll.anchorId`). Missing anchor → opens anyway and flags. |
| `Docs/Guide.md` with actual `docs/guide.md` | Opens the actual file; flagged as "case mismatch (breaks on Linux)". |
| `docs/` or `docs` (a folder) | Expands and reveals the folder in the Explorer; opens `docs/README.md` when it exists. |
| `src/main.rs`, `Makefile`, `data.json` | Opens the code viewer (§6.8); `#L12` / `#L12-L20` selects lines. Missing → flagged. |
| `image.png`, `video.mp4` | Opens the media externally (existing `open_external`) — unchanged. |
| `https://…`, `http://…`, `mailto:…` | System browser / mail client (exists). Hovering shows the URL in the status bar; `title` keeps the author's tooltip. |
| `file:///…`, `javascript:` (already sanitized), unknown schemes | Marked unsupported, inert. |
| `../../outside.md` (above the root) | Flagged "outside the opened folder", inert. |

Visual flags: `data-status` on the anchor; broken links get a red wavy underline and a tooltip
("File not found: docs/old.md", "Heading not found: #setup in docs/a.md", "Wrong case: the file
is docs/guide.md"); case mismatches orange. Status comes from `graph.linksByDoc[relPath]`
(fetched when the tab shows, refreshed on `graph://changed` and on the document's own reload);
until the graph has parsed the document, links are unflagged (no false positives).

### 6.8 Code file viewer

- New tab kind `code` (icon by language), same preview/pinned semantics, title = file name.
- Content: Shiki `codeToHast` with the existing dual-theme setup, languages loaded on demand
  from `@shikijs/langs` by extension / file name map (`languages.ts`, ~60 entries incl. `rs ts
  tsx js py go java kt cs cpp c h json yaml toml xml html css scss sh ps1 sql md dockerfile
  makefile`), unknown → plain. Line numbers in a separate gutter column (CSS counters), a
  sticky header with the path, size, "read-only" badge, **Open in default editor**, **Reveal in
  file manager**, **Copy path**, **Wrap lines** toggle, and a "Go to line" (`Ctrl+G`) box.
- Limits: highlighting only up to **300 KB or 5,000 lines** (beyond: plain monospace text with
  a notice; still virtualized by line with `@tanstack/react-virtual` so a 1 MB file scrolls
  smoothly); `truncated` content shows "Showing the first 1 MB".
- `NotText` → a card "Binary file" with size, Reveal in file manager; `TooLarge` → "File too
  large (12.4 MB)" with the same actions; `Forbidden` on open → toast explaining that
  executables are never opened from IGrasp.
- `#L10` / `#L10-L20` from links or the Go to line box highlight the lines (sticky
  `data-selected`) and scroll them to the center. Clicking a line number selects it; shift-click
  extends; the selection is copied to the URL-like fragment in the tab tooltip (no address bar).
- Live reload: `fs://changes` does not report non-markdown files; the viewer re-stats on tab
  focus (`modifiedMs` comparison, one cheap call) and shows a "Changed on disk — Reload" banner
  when different (never auto-replaces, to avoid losing the reading position). Recorded as a
  known limitation in the feature doc.

### 6.9 Broken links view

- Sidebar view; header "14 broken links in 6 files" with a refresh button and a filter chip
  row: **Missing file**, **Missing heading**, **Wrong case**, **Outside folder** (toggle
  visibility; counts per kind). Progress row while the graph builds.
- Virtualized tree: document rows (name, dim path, count) → link rows (icon by kind, link text,
  `→ target` with the fragment, line number). Click opens the source document at the link's
  line (same scroll-to-line mechanism as search) with the link flashed; Enter / Space as in
  search; a row action "Copy target path".
- Status bar item "⚠ 14 broken links" (hidden when 0; click opens the view); counts update on
  `graph://changed`.

### 6.10 Backlinks

- Right-panel section "Backlinks (3)" for the active document: rows with the linking file
  name, dim folder, and the linking line's text (`text` of the link; the surrounding line is not
  stored to keep the graph small); grouped by file when a file links several times. Click opens
  the source at that line (preview tab), Enter same, `Ctrl+Enter` pins.
- Empty state "No other document links here". Updates live on `graph://changed` when the
  active document is in `docs` or any `removed` doc was a backlink source.
- Only markdown → markdown links count (links from code files are not parsed).

### 6.11 Right panel and layout

- `rightPanel` in the session (visible, width); default hidden on first open of a folder, with
  a one-time hint toast after the first document opens ("Outline and backlinks are in the right
  panel (Ctrl+Alt+B)") — shown once per installation (a settings flag `hintsShown`).
- The title bar toolbar gets: back, forward (left group), search everything, toggle right
  panel (right group), each with tooltips and disabled states.
- Minimum widths: sidebar 170 px (exists), right panel 200 px; main 300 px (exists).

### 6.12 Keyboard and accessibility

New bindings (all through `menuActions.ts` + `keymap.ts`, listed in the F1 reference and the
README):

| Keys | Action |
|---|---|
| `Ctrl+T` | Search everything (files and headings) |
| `Ctrl+Shift+F` | Search in files (focus the query; selected text pre-fills it) |
| `Ctrl+Shift+R` | Recent changes view |
| `Ctrl+Shift+L` | Broken links view |
| `Alt+←` / `Alt+→`, mouse 4 / 5 | Back / Forward |
| `Ctrl+Alt+B` | Toggle the right panel |
| `Ctrl+Shift+O` | Focus the outline (opens the right panel) |
| `F4` / `Shift+F4` | Next / previous search result |
| `Alt+C` / `Alt+W` / `Alt+R` | Match case / whole word / regex (when the search box is focused) |
| `Ctrl+G` | Go to line (code viewer) |
| `Ctrl+Click`, middle click | Open a link or result pinned |

`useGlobalShortcuts` learns to **skip bindings without modifiers while an input is focused**
(F4 and F1 are fine, letters are not), and `Alt+C/W/R` are scoped to the search panel. All
new trees use the existing ARIA tree helpers; the quick-open dialog follows the combobox +
listbox pattern (`aria-activedescendant`, `aria-expanded`); search status changes are announced
through a polite live region ("12 results in 4 files"); match highlights have at least 3:1
contrast against their background in every theme (new tokens `--search-match-bg/fg`,
`--link-broken`, `--link-warning`, checked in all three themes); `prefers-reduced-motion`
disables the flash animations.

---

## 7. Performance targets (10k+ files) and how they are measured

Reference project: 10,000 markdown files (median 4 KB, 20 headings, 15 links each, 2 % at
200 KB) in 1,200 folders inside a tree of 60,000 other files, generated by a shared script
(`scripts/gen-large-project.mjs`, writes to a temp folder; the Rust side has the same generator
in `src-tauri/benches/support.rs` for `#[ignore]`d perf tests). Numbers are for a release
build on a laptop SSD with a warm page cache unless noted; CI runs the perf tests in debug with
3× budgets and only on `workflow_dispatch`.

| Area | Target | Measured by |
|---|---|---|
| Folder scan (unchanged) | < 3 s debug for 12k files | existing test |
| Graph build | < 2 s for 10k docs (≈ 40 MB); UI responsive throughout; progress ≤ 4/s | `graph::tests::builds_ten_thousand_docs` (`#[ignore]`), `graph://ready.elapsedMs` logged |
| Graph memory | < 100 MB for the reference project | logged RSS delta in the perf test; `DocMeta` sizes asserted |
| Incremental update | 50 modified files re-parsed and re-linked in < 100 ms; `graph://changed` within one debounce window | perf test + manual script writing 50 files |
| Ctrl+T | `search_symbols` round trip p95 < 50 ms for 10k files + 200k headings (query of 3 chars); dialog renders ≤ 50 rows; keystroke-to-paint < 80 ms | Rust bench on the candidate set; Playwright with a 10k mock set measuring `performance.now()` deltas |
| Full-text, literal | first batch < 100 ms, complete < 1 s over 40 MB (warm); < 5 s cold HDD acceptable | perf test with the grep pipeline; `stats.elapsedMs` |
| Full-text, regex (`\bTODO\b.*agent`) | complete < 3 s | same |
| Streaming | the webview stays at 60 fps while 20,000 matches arrive (batches ≥ 50 ms apart, immutable appends, virtualized tree) | Chromium performance trace in a manual check; Vitest asserts batching logic |
| Recent changes | `list_recent_files` < 20 ms for 10k entries; list renders 200 rows at 60 fps; refresh after `fs://changes` debounced 300 ms | Rust unit test; manual |
| Outline | 2,000 headings → tree built < 30 ms, follow-scroll under 1 ms per frame (binary search over cached offsets) | Vitest timing test (generous), manual |
| Link status | `get_doc_links` < 5 ms for a doc with 500 links; preview re-render on status arrival does not re-run the markdown pipeline (status is in context, not in the hast) | Vitest render count test |
| Broken links | `list_broken_links` < 50 ms for 10k docs; tree virtualized | Rust unit test |
| Code viewer | 300 KB highlighted in < 400 ms (after language load); 1 MB plain file scrolls at 60 fps (virtualized lines) | manual + Vitest smoke |
| Session restore | unchanged (< 1 s with 20 tabs) — code tabs are stat'ed lazily | existing checks |

Design rules that make these hold: everything heavy runs on Rust worker threads with
cancellation; queries carry ids and stale responses are dropped; lists are virtualized; the
markdown pipeline never re-runs for status changes; events are debounced on both sides; no
`O(files)` work on the main thread per keystroke (candidate scoring is in Rust).

---

## 8. Security

| Control | Decision |
|---|---|
| Disk access | All new commands resolve paths through `RootGuard`; `read_text_file` refuses anything that is not a regular file. No new Tauri capability is required (`reveal_item_in_dir` and `open_path` are called from Rust). |
| Opening files externally | `open_with_default_app` is user-click only, text-only (checked at call time), deny-listed extensions and executable bits refused, logged. Links never trigger it. |
| Regex and globs | Rust `regex` is linear-time (no catastrophic backtracking); `size_limit` 10 MB and `dfa_size_limit` 2 MB on the matcher; globs compiled with `globset` and capped at 50 patterns. Errors are returned as data, never panics. |
| Untrusted content | Code files render through Shiki's hast → React (text nodes only, no `innerHTML`); search result lines and heading texts are rendered as text; link targets shown in tooltips are escaped by React. The `data-line` attribute is added before sanitization and whitelisted explicitly; `rehype-sanitize` still strips everything else. |
| Navigation | `PreviewLink` keeps intercepting every click; `Alt+←/→` and mouse buttons are prevented so the webview never navigates; `file:` links are inert. |
| Resource limits | Search caps (20k matches, 2k files, 500-char lines), text file caps (5 MB read, 1 MB returned), graph skips files over 20 MB, at most one running text search per workspace. |

---

## 9. Libraries

Exact versions are fixed at `cargo add` / install time (latest patch of the listed minor) and
recorded in the lockfiles; all licenses are MIT-compatible unless noted.

### 9.1 Backend (crates)

| Crate | Use | License |
|---|---|---|
| `pulldown-cmark` 0.13 | Headings and links extraction with byte offsets | MIT |
| `grep-regex` 0.1, `grep-searcher` 0.1, `grep-matcher` 0.1 | Full-text search (ripgrep's engine) | MIT / Unlicense |
| `globset` 0.4 | Include/exclude globs (already a transitive dependency of `ignore`) | MIT / Unlicense |
| `regex` 1 | Slugger character classes, HTML anchor scan (already transitive) | MIT / Apache-2.0 |
| `nucleo-matcher` 0.3 | Fuzzy matching for Ctrl+T | **MPL-2.0** (see §16 Q1) |
| `memchr` 2 | NUL detection for the text check (already transitive) | MIT / Unlicense |

No `rayon`: the existing `std::thread::scope` + `mpsc` worker pattern from the scanner is
enough for both the graph builder and the text search.

### 9.2 Frontend

No new runtime dependency: radix `Dialog` (quick open), `@tanstack/react-virtual` (all lists),
Shiki + `@shikijs/langs` (code viewer), `lucide-react` icons are already present. Dev: none.

---

## 10. Testing strategy

| Layer | What |
|---|---|
| Rust unit | `slug.rs` against the shared fixture; `parse.rs` on fixture documents (ATX/setext headings, front matter, code fences with `#` lines ignored, reference links, autolinks, HTML anchors, CRLF line numbers); `links.rs` resolution table (relative, root, `..`, folder → README, case mismatch, fragments, outside root); `graph` build and incremental apply on a temp folder (add / modify / remove / rename, target appears later, non-markdown target removed); `symbols.rs` ranking (name over path, recent boost, `#` and `/` prefixes); `text.rs` options matrix (case, word, regex, fixed strings, CRLF, globs include/exclude, caps, cancellation, invalid pattern); `globs.rs` VS Code semantics; `read_text_file` (BOM, binary, huge, truncation); `open_with_default_app` deny-list; `list_recent_files` ordering and paging; ts-rs export. Perf tests `#[ignore]` with budgets (§7). |
| Frontend unit (Vitest) | `history` store (record/back/forward/dedupe/cap/pruning); `search` store (debounce, stale results ignored, merge by path, F4 stepping, cancel); `quickOpen` store (stale request ids); `recentFiles` grouping by day and markers; `graph` store refresh logic; `outline.ts` tree building and nesting of skipped levels; `lines.ts` plugin and scroll-to-line selection; `resolveLink` table; `languages.ts` map; components: SearchPanel (toggles, error line, results tree keyboard), QuickOpenDialog (combobox a11y), OutlinePanel (filter, follow), CodeTab (gutter, selection, notices), BrokenLinksPanel filters, ActivityBar; slug fixture through `rehype-slug`. |
| E2E (Playwright, mock) | Ctrl+T finds a heading and scrolls to it; Ctrl+Shift+F finds text with regex + match case, opens the match at the line, F4 steps; include/exclude globs filter results; recent changes lists a file written through the mock at the top with a marker; Alt+←/→ returns to the previous document; link to `src/main.ts` opens the code viewer with highlighted lines and the "Open in default editor" button calls the backend; broken link is underlined and listed in the Broken links view; backlinks panel lists the linking document; outline follows scroll and jumps; right panel toggles and is restored by the session; keyboard-only path through the activity bar and the search panel. |
| Manual (checklist in CONTRIBUTING) | Reference 10k project on Windows 11 and Ubuntu 22.04: scan, graph, search timings; Alt+← does not navigate the webview; mouse buttons 4/5; open in default editor for `.rs`, refusal for `.exe` and `.sh`; reveal in Explorer / Nautilus; HC theme contrast of highlights and wavy underlines. |

---

## 11. Architecture Decision Records to write

1. `0009-document-graph-in-rust.md` — headings and links parsed in Rust with `pulldown-cmark`,
   GitHub-compatible slugs verified by a shared fixture, incremental updates from the watcher;
   why not in the frontend (needs every file, not only open ones) and why the outline still
   comes from the rendered tree.
2. `0010-full-text-search-with-grep-crates.md` — on-demand parallel scan with ripgrep's crates
   streamed in batches instead of an inverted index (`tantivy`); caps and cancellation; the
   content-cache escalation path.
3. `0011-fuzzy-matching-with-nucleo.md` — `nucleo-matcher` for Ctrl+T, license note (MPL-2.0
   is a file-level weak copyleft and compatible with distributing an MIT application; the crate
   is unmodified), the in-house scorer alternative.
4. `0012-activity-bar-sidebar-views-and-right-panel.md` — VS Code-style activity bar for sidebar
   views and a secondary right panel for Outline/Backlinks (future Git status panel), session
   fields.
5. `0013-opening-files-with-the-default-app.md` — text-only, deny-listed, user-initiated; why
   there is no "configure editor" setting yet.

---

## 12. Documentation to update

- `docs/features/`: new pages `search.md` (Ctrl+T and Ctrl+Shift+F, syntax, limits),
  `navigation.md` (activity bar, history, recent changes, right panel), `links-and-graph.md`
  (link rules, anchors, broken links, backlinks, outline), `code-viewer.md`; updates to
  `markdown-preview.md` (links table), `keyboard.md` (new shortcuts, reserved list),
  `tabs-and-session.md` (code tabs, session fields), `live-reload-and-toasts.md` (graph
  updates), `README.md` index.
- `docs/architecture.md`: modules table (graph, search), new events and commands, two new
  diagrams (graph build and update; a search from keystroke to highlighted line).
- `CHANGELOG.md` `[Unreleased]` → `[0.2.0]`; `README.md` features, shortcuts, roadmap with
  Phase 2 checked and the **later phases re-ordered as currently planned** (Claude, Quiz,
  Editing, Git, Mermaid editor); `CLAUDE.md` structure section (new folders, new mock duties,
  the slug fixture rule); `CONTRIBUTING.md` manual checklist.

---

## 13. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Slug drift** between the Rust slugger and `rehype-slug`/`github-slugger` makes anchors look broken. | Shared JSON fixture run by both test suites; `NotChecked` status until the target is parsed; the preview only flags when the graph says so; a "Report a wrong flag" note links to the issue template. |
| 2 | **Headings pulldown-cmark sees differently than remark** (GFM edge cases, HTML blocks, math). | Fixture documents from `src/test/fixtures/markdown/`; math is text to both; unknown constructs degrade to "no anchor" rather than wrong anchors; differences recorded as known cases in the feature doc. |
| 3 | **`nucleo-matcher` license** (MPL-2.0) questioned by the owner. | §16 Q1; the fallback is an in-house fzf-v1-style scorer (~250 lines, tests); the matcher is isolated behind a `Matcher` trait so it can be swapped in one commit. |
| 4 | **Search storms while typing** (each keystroke starts a scan). | 200 ms debounce, cancellation of the previous search per file, the workspace runs one text search at a time; result batches ≥ 50 ms. |
| 5 | **Scroll-to-line accuracy** in rendered markdown (lists, tables, nested blocks). | `data-line` on many block types; nearest-block rule; the flash shows where the app landed; search result rows show the line number for orientation. |
| 6 | **CSS Custom Highlight API** missing or buggy on an older WebKitGTK. | Feature-detected; block flash is the baseline; documented minimum WebKitGTK 2.44 already stands. |
| 7 | **`Alt+←` / mouse buttons** navigate the webview history or are swallowed by the OS (GNOME uses some Alt combos). | `preventDefault` at window level in capture phase; toolbar buttons and menu items as alternatives; manual test on GNOME/KDE. |
| 8 | **Graph build competes with the scan or user actions** on slow disks. | Starts only after `index://ready`; worker count capped; cancellation on close/rescan; UI usable with partial data. |
| 9 | **Memory growth** with very large or heading-heavy docs. | Caps: 20 MB files skipped, headings and links per doc capped at 5,000 (counted as truncated); measured in the perf test. |
| 10 | **Opening files with the default app** launches something unexpected. | Text check at call time, deny-list, exec bit check, user click only; Reveal in file manager as the universal fallback; ADR 0013. |
| 11 | **Non-markdown targets changing** without index events (a linked `main.rs` deleted). | The watcher forwards raw event paths to the graph for a `by_target` lookup (cheap); the code viewer re-stats on focus; a full re-check button in the Broken links header. |
| 12 | **Session file compatibility** with new fields and the `code` tab kind. | `#[serde(default)]` on every new field; restore drops tabs of unknown kinds; a unit test loads a Phase 1 `sessions.json`. |
| 13 | **Keyboard conflicts**: `Alt+C/W/R` vs menu mnemonics, `Ctrl+Shift+L/R/O` vs webview defaults. | Mnemonics are `F/E/V/H` only; search toggles are scoped to the panel; the global handler calls `preventDefault` for every bound combination; the F1 reference lists them. |
| 14 | **Mock drift**: four new subsystems to mirror in TypeScript. | Each Rust command lands with its mock in the same commit (CLAUDE.md rule); shared fixtures (slugs, search option matrix as JSON) run against both. |
| 15 | **Windows file locks / partial writes** while searching or parsing files an agent is rewriting. | Reads are retried once after 50 ms on `PermissionDenied`; failures are counted as `skipped`, never fatal; the next `fs://changes` re-parses the file. |

---

## 14. Order of work (small, committable steps)

Each step is one commit (Conventional Commits, `Co-Authored-By` trailer) on
`phase-2-navigation`, builds, and passes `npm run check`. Rust commands land **with** their
mock implementation and `Backend` method. "Verify" is what to run or try before committing.

**M0 — Plan and shell**
1. `docs: add phase 2 implementation plan` (this file, with review answers in §16).
2. `feat: activity bar with sidebar views and session field` — `ActivityBar`, `SidebarHost`
   with Explorer plus placeholder Search / Recent changes / Broken links views, `sidebar.view`
   in `workspace` and `Session` (`#[serde(default)]`), View menu entries, `Ctrl+Shift+R/L`
   bindings, `RESERVED_SHORTCUTS` trimmed. Verify: switching views, `Ctrl+B` hides both,
   restored after reopening the folder.
3. `feat: right panel shell with Outline and Backlinks sections` — `rightPanel` in workspace +
   session, `RightPanel` with empty sections, `Ctrl+Alt+B`, toolbar toggle, View menu. Verify:
   resize, collapse by drag, session restore.
4. `feat: navigation history with Alt+Left/Right and mouse buttons` — `history` store, recording
   hooks in `tabs`, toolbar back/forward, menu items, webview navigation prevented; tests.
   Verify: open three files, go back twice, forward once; close a tab then go back.

**M1 — Recent changes and text files**
5. `feat(backend): list_recent_files command` — Rust + mock + `Backend`; tests for order and
   paging.
6. `feat: recent changes view` — `recentFiles` store, grouped virtualized list, session markers,
   live refresh; tests. Verify with a script touching 50 files.
7. `feat(backend): read_text_file, open_with_default_app and reveal_in_file_manager` — text
   check, caps, deny-list, error codes `NotText`/`Forbidden`; mock fixtures (text, binary, huge);
   tests. ADR 0013.
8. `feat: read-only code viewer tab` — `code` tab kind, `CodeTab` with Shiki, gutter, wrap,
   go-to-line, `#L` ranges, header actions, notices for binary/huge/truncated, re-stat on focus;
   `languages.ts`; session tab kinds; tests. Verify: `.rs`, `.json`, `Makefile`, a 2 MB log, a
   binary; "Open in default editor" on Windows and Linux; refusal for `.sh`.

**M2 — Document graph (backend)**
9. `feat(backend): GitHub-compatible slugger with a shared fixture` — `graph/slug.rs`,
   `src/test/fixtures/slugs.json`, Rust test + Vitest test through `rehype-slug`.
10. `feat(backend): markdown headings and links parser` — `graph/parse.rs` with
    `pulldown-cmark`, offsets → lines, HTML anchors; fixture-based tests.
11. `feat(backend): link resolution and status` — `graph/links.rs` (relative, root, folder →
    README, case mismatch, fragments, outside); tests.
12. `feat(backend): document graph built after the scan and updated by the watcher` —
    `graph/mod.rs`, `start_build` from `start_scan`, `graph.apply` from the watcher with raw
    event paths, `graph://progress|ready|changed`, `get_graph_status`; `Workspace` field;
    temp-folder tests incl. incremental cases. ADR 0009.
13. `feat(backend): get_doc_links, get_backlinks and list_broken_links` — commands + mock graph
    (regex extractor + shared slugger fixture) + `Backend` methods + fixture cross-links; tests.

**M3 — Links, outline, backlinks, broken links (frontend)**
14. `feat: source line markers in the preview and scroll-to-line` — `pipeline/lines.ts`,
    sanitize schema `dataLine`, `pendingScroll` in tabs, `DocumentTab` scroll + flash, CSS
    highlight helper with feature detection; tests.
15. `feat: full internal link resolution with status flags` — `resolveLink`, `PreviewLink`
    statuses and tooltips, anchors across files, folder links, code links, case mismatch,
    status bar URL on hover, pin with Ctrl/middle click; `graph` store `refreshDoc`; tests.
16. `feat: outline panel` — `outline.ts`, `OutlinePanel` (tree, filter, follow scroll, flash),
    `Ctrl+Shift+O`; tests.
17. `feat: backlinks section` — `graph.refreshBacklinks`, `BacklinksSection`, live updates;
    tests.
18. `feat: broken links view and status bar item` — `BrokenLinksPanel` with kind filters,
    `graph.loadBroken`, status bar count, activity badge; tests.

**M4 — Search**
19. `feat(backend): fuzzy symbol search over file names and headings` — `search/symbols.rs`
    with `nucleo-matcher` behind a `Matcher` trait, candidate cache, ranking, request ids; mock
    scorer; bench test. ADR 0011.
20. `feat: search everything dialog (Ctrl+T)` — `quickOpen` store, `QuickOpenDialog` (combobox
    a11y, virtualized, groups, highlights, progress footer), toolbar + Edit menu entries, scroll
    to heading on open; tests.
21. `feat(backend): full-text search with streaming results` — `search/text.rs`, `globs.rs`,
    `SearchRegistry`, `search_text`/`cancel_search`, `search://results`, caps, `InvalidPattern`;
    mock search with the same batching; option-matrix tests from a shared JSON fixture. ADR 0010.
22. `feat: search panel (Ctrl+Shift+F)` — `search` store, `SearchPanel` (query row with toggles
    and error line, include/exclude, header, virtualized results tree, dismiss, changed-since
    markers), open match at line with highlights, `F4`/`Shift+F4`, `Alt+C/W/R`, selection
    pre-fill, query history; live region; tests.

**M5 — Performance, tests, docs, release**
23. `perf: large-project generator and performance tests` — `scripts/gen-large-project.mjs`,
    Rust `#[ignore]` perf tests with budgets, mock "large" mode for virtualization checks, and
    whatever fixes the measurements demand (recorded in the commit body against §7).
24. `test: Playwright smoke tests for navigation and search` — the §10 e2e list, fixture
    extensions, CI wiring unchanged.
25. `feat: accessibility and theme pass for the new views` — focus order through activity bar
    → view → main → right panel, HC tokens for highlights/underlines, reduced motion, tooltips,
    live regions audit.
26. `docs: feature pages, architecture, ADRs and README for 0.2.0` — §12 in full, including the
    re-ordered roadmap; `CHANGELOG.md` `[0.2.0]`; screenshots of search, quick open, outline,
    broken links.
27. `chore: release 0.2.0` — version bump in `package.json`, `Cargo.toml` (and lockfiles).
    Merge to `main` and tag `v0.2.0` happen in the close-phase step, after review, when the
    maintainer asks.

Optional if time allows (after 22): `searchMaxResults` setting; "view source" of a markdown
file in the code viewer; outline in the Ctrl+T dialog for the current file only (`@` prefix);
Markdown→code links to a symbol name (`main.rs#fn%20run`) are **not** planned.

---

## 15. Definition of done checklist

- [ ] Every row of §1.1 demonstrable on Windows 11 and Ubuntu 22.04 builds.
- [ ] `npm run check` green on both OSes in CI; e2e suite extended per §10.
- [ ] §7 targets measured on the reference project and the numbers recorded in
      `docs/features/search.md` and `navigation.md`.
- [ ] ADRs 0009–0013 written; feature docs, architecture, CLAUDE.md, README, CHANGELOG updated.
- [ ] No write inside the opened folder; no new Tauri capability; `open_with_default_app`
      refusals verified manually for `.exe`, `.bat`, `.sh`, `.js`.
- [ ] Phase summary given to the maintainer before Phase 3 starts.

---

## 16. Questions for the plan review

**Answers.** Implementation started with every recommendation below adopted as the default
answer; each one is reversible and called out in the phase summary so the maintainer can
overrule it before `v0.2.0` is tagged. Q10 is already settled: the roadmap order was changed on
`main` before this phase started.

| # | Question | Recommendation |
|---|---|---|
| 1 | **Fuzzy matcher license**: `nucleo-matcher` is MPL-2.0 (file-level weak copyleft; the crate ships unmodified, so the obligation is only to keep its source available, which crates.io does). Acceptable under "all dependencies MIT-compatible", or write our own scorer? | Use `nucleo-matcher` behind a trait and record it in ADR 0011; fall back to an in-house fzf-style scorer only if the owner prefers a pure MIT tree. |
| 2 | **No inverted index for full-text search** (on-demand ripgrep-style scan, §3.4), versus `tantivy` (MIT) with a maintained index. | On-demand scan: simpler, always current, fast enough for the 10k target; ADR 0010 records the escalation path (in-memory content cache). |
| 3 | **Activity bar** (VS Code style, far left) versus a row of view buttons in the Explorer header. | Activity bar: scales to the Git button later, matches the VS Code look, and gives badges a home. |
| 4 | **Right panel default**: hidden until toggled (with a one-time hint) or visible by default when a document is open? | Hidden by default with the hint; power users turn it on once and the session remembers it. |
| 5 | **Recent changes "session markers"** (bold + dot on files changed since the folder was opened) as a stop-gap for "what changed since I last looked", or keep the view strictly chronological until the Git phase? | Keep the markers: cheap, no persistence, directly serves "grasp what the agent just did", and the Git phase replaces them with last-read tracking. |
| 6 | **Code viewer scope**: text files only, any extension (with binary detection), or a whitelist of source extensions? | Any text file; the viewer never executes anything and highlighting falls back to plain text. |
| 7 | **"Open in default editor" refusals**: the deny-list refuses `.js` and `.sh` because some systems execute them. Accept, or offer a per-extension override later? | Accept for 0.2.0; "Reveal in file manager" always works; revisit with a configurable editor command in the Editing phase. |
| 8 | **History persistence**: keep back/forward history in memory only, or save it in the session? | Memory only: a restored history across launches is rarely expected and keeps `sessions.json` small. |
| 9 | **Search match highlighting inside rendered markdown** uses the CSS Custom Highlight API with a block-flash fallback. OK to ship without a guaranteed in-text highlight on older WebKitGTK? | Yes; WebKitGTK 2.44 (already the documented minimum) supports it. |
| 10 | **Later phases order** in the public README roadmap: the plan updates it to Claude → Quiz → Editing → Git → Mermaid editor in step 26. Confirm. | Confirm before step 26. |
