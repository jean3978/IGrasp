# 0025 — Tutorial format: a typed JSON schema and a shared markdown folder

- Status: Accepted (proof of concept before Phase 5; see [the PoC report](../plan/poc-tutorials.md))
- Date: 2026-10-25

## Context

A tutorial (ADR 0016) is generated in two steps with consent (an outline, then one chapter at a
time), rendered as interactive cards whose look the UI fully controls, kept privately in app data,
and optionally shared with the project as plain markdown that teammates read on GitHub and take in
IGrasp. Its citations must be checked locally when it is written (the file exists, the lines
exist) and again when it opens (have the lines changed, moved, or gone), without a token. The
quiz already settled the shareable-file conventions (ADR 0024: a front matter with hashed
sources, `igrasp-*` fenced blocks with YAML) and the grounded pipeline (ADR 0022: the app owns
the prompt and the schema, typed validation, capped and visible retries).

Before building Phase 5, a proof of concept had to show that the model writes grounded chapters
of every step type on varied projects, that the markdown round trip loses nothing, and that
moved citations can be relocated locally.

## Decision

- **Two schemas, both owned by the app** (`learning/tutorial/schema.rs`). The outline schema
  returns a title, an intro, `insufficientMaterial`, `suggestedSubjects` and chapters (id,
  title, goal, minutes, `keySources`: the files the chapter is built on, and a self-check). The
  chapter schema returns Hoot's intro, an optional `docsNote` and 3 to 12 steps, each one of ten
  types tagged by `type`: `explain`, `conceptBridge`, `codeTour`, `diagram`, `putInOrder`,
  `match`, `spotIt`, `quickCheck`, `tryIt`, `recap`. Every step except the recap carries at least
  one citation (`path`, `firstLine`, `lastLine`, optional `why`); a tour's stops and a spot-it's
  snippet are citations of at most 40 lines; every step carries a self-check. The typed structs
  with `deny_unknown_fields` are the schema check; tests keep the JSON schemas in step with them.
  A quick check has exactly the quiz question's fields and is validated by the quiz's validator.
- **What the app keeps** is a `Tutorial`: the metadata (project, subject, familiarity, domain
  gap, length, role, generation date, provider, model, generation commit, optional
  verification), the notes, the chapters (an unwritten chapter has its outline entry and no
  steps), and `sources`: every distinct cited range with the SHA-256 of its lines. Ids are
  positional (`c1`, `c2`; steps by index), so the markdown does not have to store them.
- **The shared format is a folder**: `README.md` plus one file per written chapter
  (`01-<slug>.md`). The README's front matter (`igrasp: tutorial`) holds the whole tutorial
  metadata, the outline (each chapter with its `file` when written) and the hashed `sources`;
  its body is a human rendering (title, intro, facts, the chapter list with links, Hoot's notes)
  that the reader ignores. A chapter file has a small front matter (`igrasp: tutorial-chapter`,
  the tutorial id, the chapter id), an `# n. Title` heading, Hoot's intro as a `> **Hoot:**`
  blockquote, and one `## n. Title` section per step.
- **Prose steps are markdown, interactive steps are YAML blocks.** An explain card is its body
  followed by a `Sources:` line (links relative to the tutorial's folder, the root-relative path
  and lines as the link text, an optional "why"); a concept bridge opens with a `> [!NOTE]` alert
  (`**Concept:**`, `Official docs:`), then the applied text; a diagram is a `mermaid` fence and
  a caption; a recap is a bullet list under `## n. Recap`. A code tour, put in order, match, spot
  it, quick check and try it are `igrasp-code-tour`, `igrasp-put-in-order`, `igrasp-match`,
  `igrasp-spot-it`, `igrasp-quiz` (the quiz file's block) and `igrasp-try-it` fenced YAML blocks,
  with a fence longer than any backtick run inside. The reader infers the step type from this
  structure; only numbered `## n. ` headings start a step, so headings the model wrote inside a
  body stay in the body.
- **Lossless on a normalized tutorial**: `markdown::normalize` trims texts, flattens titles,
  reasons and takeaways to one line, and keeps `·` and `—` out of a citation's "why" (the
  separators of the `Sources:` line); then `read(write(t)) == t`, asserted by a unit test on a
  tutorial with every step type and by the proof of concept on every real tutorial.
- **Freshness** (`learning/tutorial/freshness.rs`): the hash is the quiz's (`\n`-joined lines,
  `\r` removed). On open, a range that hashes the same is up to date; otherwise the file is
  scanned for an identical window of the same length (the nearest one wins) and the citation is
  **moved**: `relocate` rewrites every citation of that range in every step (a spot-it's answer
  line follows) and the sources table; a range with no identical window is **changed**, a file
  that is gone is **missing**. The badge is *Up to date*, *Maybe outdated (n of m changed)* or
  *Sources missing*; `affected_steps` marks the course map.

## Consequences

- One generation call per outline and per chapter; the validator rejects steps one by one with a
  coded reason, the repair prompt lists them, and the accepted steps are kept across attempts.
- A shared tutorial reads on GitHub as a short course: prose, alerts, Mermaid diagrams, and YAML
  blocks for the exercises (with the answers in clear, as the quiz files).
- A tutorial file written on Windows reads on Linux (paths with `/`, LF).
- The reader is tolerant: a block that does not parse is skipped and counted, a missing chapter
  file leaves the chapter unwritten, CRLF is accepted. A hand-edited prose step that adds a line
  starting with `Sources:` or a numbered `## n. ` heading changes the parse; the preview shows
  it either way.
- Relocation finds exact moves only; a range that moved *and* changed is reported as changed,
  which is what the AI review (Phase 5) is for.
- Phase 5 owns the format in the frontend as the quiz does (ADR 0024) and makes Rust recognise
  tutorial folders in the scan; this proof of concept keeps everything in Rust
  (`serde_yaml` for the blocks, `sha2` for the hashes) because the generation and the checks
  run there.
