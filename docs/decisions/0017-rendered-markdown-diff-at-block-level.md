# 0017 — Rendered markdown diff at block level

- Status: Accepted
- Date: 2026-10-24

## Context

Phase 3 lets the user review an agent's markdown edit inside the preview, as a rendered diff with
Accept / Reject per change, instead of reading a line diff of source. The same view is wanted
later for tutorials (freshness review) and Git (Phase 7). It must take only two markdown strings.

Options considered:

- **Line diff of the source** (what the chat cards use): exact, but not what the user reads, and
  it hides that a table row or a list item changed.
- **Word- or character-level rendered diff**: precise, but needs a diff of rendered trees or
  markup injection, and is noisy on rewrites.
- **Block level** (plan §15 Q3): compare the top-level markdown blocks, show the old and the new
  version of a changed group one after the other.

## Decision

Block level, in the shared module `src/features/diff/`:

- `blocks.ts` splits a document into top-level mdast blocks (same parser options as the
  pipeline) with their source lines and offsets. Front matter and reference definitions are
  blocks of their own.
- `blockDiff.ts` runs `diffArrays` (package `diff`) on the blocks' whitespace-normalized text. A
  run of removed and added blocks between two common blocks is one **change group** (`added`,
  `removed` or `changed`).
- `RenderedDiff.tsx` renders both versions **through the existing preview pipeline** (sanitized,
  same components), cuts the rendered trees at the top-level elements whose `data-line` is a
  block start (lists now carry `data-line` too), and composes: common blocks once (from the new
  document), then the removed and the added blocks of each changed group, each in a wrapper.
  The diff adds wrappers only, never raw HTML, so sanitization before trusted generators
  (ADR 0003) is unchanged. Ids of the removed side are dropped so anchors stay unique. A
  caller draws its own controls per group (`renderToolbar`).
- `changes.ts` maps proposed edits to groups and composes the accepted result. For `Edit` and
  `MultiEdit`, each hunk's old text is located in the old content (first occurrence, as the
  provider does); hunks touching the same group merge into one unit ("2 edits in this
  paragraph"). For a `Write`, each group is a unit and `composeWrite` builds the content with
  only the accepted groups (nothing accepted gives the old text and everything the new text,
  byte for byte).
- Colours come from four tokens, `--diff-added-bg/-fg` and `--diff-removed-bg/-fg`, in the three
  themes; high contrast adds a dashed (removed) or solid (added) border so colour is not the only
  cue. The flash after a decision is disabled by `prefers-reduced-motion`.
- The chat's line-diff card (`src/features/ai/diff.ts`) now runs on `diffLines` of the same
  package.

## Limits

- **Adjacent changed blocks merge into one group**: a changed paragraph right before a changed
  list is a single unit, accepted or rejected together. Only an unchanged block separates groups.
- **Hunks are located in the original content, first occurrence.** A `MultiEdit` hunk that only
  matches after an earlier hunk is applied is not located (`hasUnlocated`), and overlapping hunks
  are dropped the same way. The caller must then fall back to the line-diff card for the whole
  edit.
- **Blocks that render nothing** on their own (link definitions, footnote definitions) are shown
  as their raw source in a `pre`, so a change in them is still visible.
- **Size**: documents above `MAX_RENDERED_CHARS` (the preview's limit) are not rendered
  (`canRenderDiff`); the component says so and the caller uses the line diff. Edits outside the
  opened folder and non-markdown files also use the line diff.
- Changes inside a block are not highlighted: a changed paragraph shows both versions in full.

## Consequences

- One component serves AI review now and tutorials and Git later; callers need two strings.
- The review shows exactly what the preview will show, including tables, lists, front matter
  and alerts, at the price of coarse granularity inside a block.
- Both versions are rendered, so the cost is about twice a normal render (the pipeline is lazily
  loaded and already bounded by `MAX_RENDERED_CHARS`).
