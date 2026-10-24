# 0010 — Full-text search with ripgrep's crates, without an index

- Status: Accepted
- Date: 2026-10-24

## Context

Search in files (Ctrl+Shift+F) must support regular expressions, match case, whole word and
include/exclude globs over every markdown file of the folder (10,000+ files), show results while
the search runs, be cancellable, and always reflect what is on disk, including files an agent
rewrote a second ago.

## Decision

- **No inverted index.** Regex, whole-word and case-sensitive searches need to scan the candidate
  text anyway; an index such as `tantivy` would only pre-filter literal queries, at the cost of
  being maintained on every change and a larger memory footprint. The markdown of a 10,000-file
  project is a few tens of megabytes, which ripgrep's engine scans from a warm page cache in well
  under a second.
- The search uses **`grep-regex`** and **`grep-searcher`** (ripgrep's engine): linear-time Rust
  regexes (no catastrophic backtracking; size limits on compiled patterns), CRLF-aware line
  matching, no binary detection (a NUL byte must not silently stop a markdown search), match ranges
  computed per line so the frontend highlights without running the regex again. Long lines are cut
  to 500 characters around the first match.
- The file set is the **live index**, filtered by **`globset`** patterns with VS Code's semantics
  (comma-separated; a pattern without a slash matches at any depth; a folder matches its content).
- `search_text` returns an id at once; up to 8 worker threads search, and results are streamed as
  `search://results` batches every 50 ms or 200 matches. A new search cancels the previous one;
  `cancel_search` and closing the folder stop it; it ends with a `done` batch. Caps: 20,000 matches
  or 2,000 files (`truncated`), files above 20 MB skipped.
- Invalid regexes or globs are rejected with `InvalidPattern` and the engine's message, which the
  panel shows under the query box. Rust regex syntax has no look-around or back-references; the
  tooltip says so.

## Consequences

- Results are always current by construction and nothing has to be kept in sync.
- Cold disks make the first search slower (a few seconds for a large tree on an HDD). If
  measurements show cold reads dominate, the planned step up is an in-memory content cache fed by
  the document graph builder (which already reads every file), not an index.
- The mock backend implements the same options with JavaScript regexes (`src/ipc/mock/mockText.ts`);
  the syntaxes differ slightly (JavaScript supports look-around), which only matters in tests.
