# 0009 — Document graph in Rust

- Status: Accepted
- Date: 2026-10-24

## Context

Phase 2 needs facts about documents the user has not opened: the headings of every file (Ctrl+T),
whether each link's target and anchor exist (broken links), and which documents link to a given
one (backlinks). The preview already knows the headings and links of the open document, but only
after rendering it, and rendering 10,000 files in the webview is out of the question.

## Decision

- A **document graph** lives in Rust (`src-tauri/src/graph/`), next to the index. For every
  indexed markdown file it keeps the headings (level, text, slug, line), the anchors (heading slugs
  plus HTML `id`/`name`) and the links with their resolved target and status, plus a reverse map
  from every target path (lower-cased) to the documents linking to it.
- Documents are parsed with **`pulldown-cmark`** (CommonMark + GFM, math, front matter skipped).
  Heading text follows what `rehype-slug` slugs in the preview (text, inline code and math; no
  image alt text; footnote references as their number).
- Slugs are a port of **`github-slugger`**, the slugger `rehype-slug` uses. Two shared fixtures keep
  Rust and the preview from drifting: `src/test/fixtures/slugs.json` (expected values produced by
  the real github-slugger) and `src/test/fixtures/markdown/headings.json` (the ids the real preview
  gives a set of edge-case documents). Both are asserted by `cargo test` and by Vitest.
- The graph is **built in the background** after `index://ready` (up to 8 reader threads, documents
  added in batches so headings are searchable early, links resolved once everything is parsed) and
  **updated incrementally** by the watcher: changed documents are re-parsed, and only the links
  that point at a changed path are re-checked. The watcher also passes the raw event paths, so
  links to source files that appear or vanish are re-checked without walking anything. It emits
  `graph://progress`, `graph://ready` and `graph://changed`.
- A link status is never guessed: while the target document is not parsed, a fragment is
  `NotChecked` and the preview shows no flag.
- The **outline of the open document still comes from the rendered tree** in the frontend: it is
  exactly what the user sees, with the ids the preview actually has, and needs no IPC.

## Consequences

- Broken links and backlinks are known for the whole folder, live, without opening anything.
- Memory grows with the documentation (about 300 bytes per heading and 200 per link); headings and
  links are capped at 5,000 per document.
- Two markdown parsers now exist (remark in the frontend, pulldown-cmark in Rust). Their
  differences on headings are pinned by the fixtures; known gaps (HTML `<h2>` blocks, GFM bare-URL
  autolinks, which are external anyway) are documented in `docs/features/links-and-graph.md`.
- The mock backend mirrors the graph with a line-based extractor (`src/ipc/mock/mockGraph.ts`) that
  uses github-slugger itself and the same link rules.
