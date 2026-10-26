# 0024 — Shareable learning files as markdown with fenced `igrasp-*` blocks

- Status: Accepted
- Date: 2026-10-25

## Context

A quiz written by the AI about a project is worth more than one play: a teammate or the same
developer later should be able to replay it without spending tokens, and read it outside IGrasp.
Phase 5's tutorials have the same need (sharing a lesson with the team). The format must read
well on GitHub, survive hand edits, stay safe in the preview (untrusted markdown, ADR 0003),
and say when the code it cites has changed. Nothing the app does on its own may write in the
opened folder.

## Decision

- A shareable learning file is **markdown**: a front matter that declares its kind
  (`igrasp: quiz`, later `igrasp: tutorial`) with an id, title, project, subject, the wizard's
  choices (`category`: global, feature or code; `role`: who it was written for), scope,
  starting level, the date it was generated, the provider and model it was written with, and
  `sources`: every cited range with the **SHA-256 of its lines** (`\n`-joined, `\r` removed).
- The body has one heading per item (`## 1. <question>`) followed by a fenced **`igrasp-quiz`**
  YAML block: id, kind, difficulty, choices, answer, hint, explanation, sources. Answers are in
  clear: the file is a learning aid shared on purpose.
- The frontend owns the format (`features/quiz/quizFile.ts`: write, tolerant read, freshness
  check); Rust only recognises it (`learning/quiz/file.rs`): the graph parser records quiz files
  and their summary so `list_quiz_files` reads nothing again, `save_quiz_markdown(kind: quiz)`
  refuses markdown without the front matter, and `read_quiz_file` refuses other files.
- **Written only on an explicit save**: "Save quiz…" opens the system save dialog on the
  `quizzes/` folder (configurable); the frontend never passes a path, and the folder is created
  only for a path the user confirmed.
- **Replay without AI**: a quiz file plays through the same engine and cards from Saved quizzes
  on the quiz home, Learn → Open Quiz File… (a file anywhere; its citations resolve against the
  open folder), or the preview's **Play this quiz** banner. A block that does not parse is
  skipped and counted; nothing in the file is executed.
- **Freshness checked locally**: when a quiz loads, each cited range is read and hashed; a
  changed range or lines past the end show "the source changed since this quiz was written" on
  the reveal, a missing file shows its path as text. The question stays playable.
- **Preview**: a quiz file shows the banner instead of the front matter card, and its blocks,
  tagged after sanitization like Mermaid blocks, render as cards with the answer folded. Block
  text is parsed as YAML and rendered as text, never as markup.

## Consequences

- A quiz file is readable on GitHub, diffable, and replayable by anyone with IGrasp, logged in
  or not. A file written on Windows replays on Linux (paths with `/`, LF endings).
- Freshness is a cheap local signal, not a verification: a changed line may still make the
  question true. Phase 5 builds its "review with the AI" on top of the same hashes.
- The git author of a shared quiz is shown from Phase 9 (Git); until then, the `generated` date.
- Phase 5 adds `igrasp: tutorial` and its blocks with the same rules.
