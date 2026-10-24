# Search

Two searches, both computed in Rust so they stay fast on folders with 10,000+ documents.

## Search everything (`Ctrl+T`)

A quick pick over **file names and markdown headings**, with fuzzy matching (type `gtst` to find
"Getting started"). Also in the toolbar (magnifier) and Edit › Go to File or Heading.

- With nothing typed, it lists the files you opened recently, most recent first.
- Results come in two groups, **Files** and **Headings** (with their level and file), at most 50
  each. Matched characters are shown in bold.
- File names rank above matches found only in the folder path; recently opened files rank
  higher; shorter paths win ties.
- `#` at the start searches headings only (`#install`); a `/` matches whole paths
  (`guide/start`).
- Smart case: lower-case letters match both cases, an upper-case letter makes the match exact.
  Accents are folded (`e` finds `é`).
- Enter opens the file in the preview tab (a heading is scrolled to and flashes), `Ctrl+Enter`
  keeps the tab open, `Alt+Enter` opens and keeps the dialog up, Esc closes.
- While the folder is still being indexed, a footer shows the progress and headings appear as
  they are parsed.

How it works: candidates come from the index (files) and the document graph (headings, see
[links-and-graph.md](links-and-graph.md)) and are cached until either changes. Matching uses
`nucleo-matcher`, the matcher of the Helix editor ([ADR 0011](../decisions/0011-fuzzy-matching-with-nucleo.md)).

## Search in files (`Ctrl+Shift+F`)

The Search view of the sidebar, with VS Code's layout. **Search only: there is no replace.**

| Part | What it does |
|---|---|
| Query box | Searches as you type (after 200 ms) or on Enter. ↑ / ↓ recall the last 20 searches; Esc clears the box. Selected text in a document becomes the query when you press `Ctrl+Shift+F`. |
| `Aa` Match Case (`Alt+C`) | Exact case. |
| `ab` Whole Word (`Alt+W`) | Matches only at word boundaries. |
| `.*` Regular Expression (`Alt+R`) | Rust regex syntax (no look-around or back-references). An invalid pattern shows the engine's message under the box. |
| `…` | Shows **files to include** and **files to exclude**. |
| Status | "12 results in 4 files", "Searching…", "Cancelled", or "stopped at the result limit". |
| Results | Grouped by file with the match count; every match highlighted; long lines start shortly before the first match. Refresh, clear and collapse/expand all in the header. |

Patterns for files to include / exclude are comma-separated globs:

| Pattern | Matches |
|---|---|
| `*.md` | Any `.md` file at any depth. |
| `docs` or `docs/` | Everything inside any folder named `docs`. |
| `docs/guide` or `./docs/guide` | Everything inside `docs/guide` at the root. |
| `docs/*/a.md` | `a.md` one level below `docs`. |

Exclusions apply after inclusions. Ignored files are never searched (the search uses the
Explorer's index).

Using the results:

- Click or Enter opens the document in the preview tab, scrolled to the line, with the matched
  text highlighted (the highlight goes away with the next click or key in the document). Double
  click or `Ctrl+Enter` keeps the tab open.
- **F4 / Shift+F4** jump to the next / previous match from anywhere in the app.
- The × of a row (or Delete) dismisses it from the list.
- A file modified on disk after the search gets a dot ("changed since the search; refresh to
  update"); a deleted file leaves the list.
- The Search icon of the activity bar spins while a search runs.

How it works: there is no index ([ADR 0010](../decisions/0010-full-text-search-with-grep-crates.md)).
Rust scans the live file list with ripgrep's crates on up to 8 threads and streams the results
in batches (every 50 ms or 200 matches); a new search cancels the previous one. Limits: 20,000
matches or 2,000 files, files above 20 MB skipped, lines cut to 500 characters.

## Performance

Measured on a generated project of 10,000 documents (20 headings and 15 links each, 2 % around
200 KB; `scripts/gen-large-project.mjs`, release build, laptop SSD, warm cache):

| Operation | Time | Target |
|---|---|---|
| Ctrl+T, file names | ~10 ms | < 50 ms |
| Ctrl+T, 200,000 headings | ~18 ms | < 50 ms |
| Ctrl+T candidates rebuilt after a change | ~67 ms | — |
| Full-text, literal | ~20 ms | < 1 s |
| Full-text, regex `\bagent\b.*summary` | ~32 ms | < 3 s |

The same project in a debug build of the app, through the real IPC: a capped full-text search is
on screen in 0.8 s. Cold disks are slower; the planned step up is an in-memory content cache.
