# 0011 — Fuzzy matching with nucleo-matcher

- Status: Accepted
- Date: 2026-10-24

## Context

"Search everything" (Ctrl+T) matches what the user types against every file name and every
markdown heading of the folder: 10,000 files and around 200,000 headings in the reference project,
re-scored on each keystroke. It needs good fuzzy ranking (consecutive characters, word starts,
smart case, accents), the matched positions for highlighting, and a few milliseconds per query.
Doing it in the webview would mean shipping every heading to JavaScript and scoring them on the UI
thread.

## Decision

- Matching runs in Rust (`src-tauri/src/search/symbols.rs`) with **`nucleo-matcher`** 0.3, the
  matcher behind the Helix editor's picker (fzf-style Smith-Waterman scoring, Unicode case folding
  and normalization, matched indices).
- It sits behind a small `Scorer` trait, so it can be replaced by another scorer in one commit.
- Candidates (file names, paths and heading texts, pre-converted for the matcher) are cached and
  rebuilt only when the index or the document graph changes (the graph's version counter).
- Ranking: score, then a bonus for files the user opened recently (sent by the frontend), then
  shorter paths. File names rank above matches found only in the folder path; `/` in the query
  matches whole paths; a leading `#` searches headings only. Each request carries an id echoed in
  the response so the UI drops stale answers.
- Measured on 10,000 files and 200,000 headings (release build): about 10 ms for a file query and
  20 ms for a heading query, 70 ms to rebuild the candidates after a change.

## License

`nucleo-matcher` is licensed under the **MPL-2.0**. The MPL is a file-level copyleft: it only
requires that the crate's own source files stay available under the MPL, which crates.io already
does, and that modifications to those files be shared. IGrasp uses the crate unmodified, so
distributing it inside an MIT application is compatible with "all dependencies MIT-compatible".
The fallback, if a pure MIT/Apache tree is ever required, is an in-house fzf-v1-style scorer
behind the same trait (the mock backend already has a simple one for tests).

## Consequences

- Ctrl+T stays instant on large projects and the UI thread only renders at most 50 rows per group.
- One MPL-2.0 dependency is recorded in the license inventory of the README.
