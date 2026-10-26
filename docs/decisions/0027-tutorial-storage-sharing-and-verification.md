# 0027 — Tutorial storage, sharing and verification

- Status: Accepted (amended in 0.5.x: questions saved on a step, your own shared copy in the library)
- Date: 2026-10-25

## Context

A tutorial (ADR 0025) is private when it is written: it is the reader's own course. Some are
worth sharing with the team, in the project, as markdown a teammate reads on GitHub and takes in
IGrasp. The reader's progress must survive updates of the tutorial, for private and shared
tutorials alike. The cited code changes over time: a tutorial must say when its sources moved or
changed, follow lines that only moved, and let a person state that it is still correct.

Two rules frame all of it: nothing the app does on its own writes inside the opened folder, and
the AI never changes a tutorial or vouches for it on its own.

## Decision

### Storage

- **Private tutorials are one JSON file each** in app data:
  `learning/tutorials/<folder>/<id>.json` (`appdata/tutorials.rs`): the `Tutorial`, its creation
  and update times, and `sharedAs` (the README of its shared copy, once shared). Written
  atomically, listed by reading the folder, recovered when corrupt like the other app-data files
  (ADR 0005). At most 200 per folder.
- **The reader's progress** lives in the folder's learning file (`appdata/learning.rs`), keyed
  by the **tutorial id**, so it survives updates and covers shared tutorials, which have no copy
  in app data. It holds the position, the completed steps, the answers, the XP, the streak, the
  chapters done and the graduation. The same file keeps the AI's subject suggestions and the
  usage of the last 20 tutorial operations (for the confirmation card's cost line).
- **Step hashes.** A completed step is stored with the hash of the step at that moment: the
  first 16 hex digits of the SHA-256 of its **canonical JSON** (sorted keys; nulls, empty lists
  and self-checks dropped; line numbers left out, so a relocation alone changes nothing). A step
  whose hash differs now is marked **updated since you read it**. The frontend computes it
  (`stepHash` in `src/lib/tutorial.ts`) and Rust counts the updated steps for the library
  (`progress::step_hash`); both are asserted on `src/test/fixtures/tutorial/step-hashes.json`.
  Hashing the step rather than the markdown keeps a teammate's reformatting from marking steps.
- **A save never hides a change.** A save normalizes the texts and hashes the new citations; a
  citation already recorded keeps its hash. A new tutorial gets its id, date, provider and
  generation commit when it is first saved.

### Sharing

- **Share with the project** writes a private tutorial as a folder in the opened folder:
  `<tutorials folder>/<slug of the title>/` (Settings → Learning, default `docs/tutorials`, validated
  like the quiz folders), a `README.md` and one file per written chapter. A tutorial shared
  before is written where it was. A folder that holds another tutorial is refused
  (`TutorialFolderTaken`). The private copy stays, tagged "shared as …".
- **Every write is planned, then confirmed** (`learning/tutorial/share.rs`). The target is a
  `WriteTarget`: `Share { id }`, `Shared { relPath }` (an update of a shared tutorial in place:
  accepted proposals, relocations, the verification) or `Export { id }` (Save as…).
  `plan_tutorial_write` renders the files and compares them with the disk without writing: each
  `PlannedFile` is **new**, **changed** or **unchanged**, and `removed` lists the chapter files
  of the shared tutorial that the new version no longer has. The confirmation dialog shows the
  folder and every file; only its button calls `write_tutorial`, which renders again and writes
  each file **atomically** (a temporary file renamed over the target, so the watcher reports
  *modified*), creating the folder only then. An update of a shared tutorial must keep the
  tutorial id the README on disk holds.
- **Save as…** writes a copy of a private tutorial into `<chosen folder>/<slug>/`, the folder
  picked in a dialog that `write_tutorial` opens itself (`SaveDialog::pick_folder`;
  `SaveCancelled` when dismissed). The frontend never passes a path, only the `relPath` of an
  existing shared README.
- **Shared tutorials are found by the graph** (the README's `igrasp: tutorial` front matter) and
  listed beside the private ones; a shared tutorial is read from its files through the root guard.

### Freshness and relocation

- **The local check runs when a tutorial opens and when the library lists it** (no token): each
  cited range is hashed again and compared (ADR 0025). Moved ranges are relocated.
- **Relocations of a private tutorial are saved silently**: a relocation is the app's own
  bookkeeping of line numbers, not a change of content. **For a shared tutorial** the relocated
  version is offered (**Update the moved citations**) as a write the user confirms, because the
  files are the team's.

### Verification

- **Mark as verified is the user's statement**, after a confirmation: "You confirm this tutorial
  is correct for the project as it is now. IGrasp records the date, the commit and your name."
  `mark_tutorial_verified` records the date, the **HEAD commit** and the **git user name**, read
  from the `.git` files as text (`learning/tutorial/repo.rs`: a `.git` folder or the `.git` file
  of a worktree, a detached HEAD, a loose or packed ref, `[user] name` of the repository's own
  config; no git process), and **hashes the cited ranges again**, so the freshness check starts
  from now. A private tutorial is saved; a shared one goes through the write confirmation (only
  its README changes).
- **The AI review never sets it.** "Check with the AI" proposes replacements that the user
  accepts or rejects; it has no path to the verification stamp.

### Plan review

- **Question 5** (relocations silent for a private copy, offered for a shared one): answered as
  recommended.
- **Question 6** (one JSON file per private tutorial, versus inside the learning file): answered
  as recommended, one file each; a deep tutorial is about 100 KB and the progress is saved after
  every step.
- **Question 7** (the review inlines the tutorial as the markdown a teammate reads, with the
  freshness report, and proposes changes only where the text is wrong now): answered as
  recommended; the prompt refuses rewrites for style.
- **Question 8** (the commit from `.git/HEAD` read as a file and the name from the local
  `.git/config`, no git CLI until Phase 9): answered as recommended.
- **Question 9** (XP rules fixed in a shared fixture rather than tuned by the model): answered
  as recommended, fixed (`src/test/fixtures/tutorial/xp.json`); the model never sees XP.

## Amendment: questions readers save on a step (0.5.x)

- A reader asks about a step in the chat, pointing at it with the text or region tool; the
  message carries `tutorialStep` (tutorial, chapter, step, the text pointed at), and `ai_start`
  adds the step and its cited files to the prompt. It is an ordinary chat message: its Send is
  the user action, and saving the answer never calls the AI.
- Saved questions live on the chapter (`Chapter::questions`: step index, the text pointed at,
  question, answer), not on the step: the step's hash, which marks "updated since you read it",
  does not change when someone asks, and a review that rewrites a step keeps them. A rewritten
  chapter keeps the questions whose step still exists.
- **Anonymous by construction**: the record has no author and no date, so sharing cannot leak
  who asked. A private tutorial saves at once (`save_step_question`); a shared one is returned
  and written only through `write_tutorial` after the confirmation, like every other change to a
  shared tutorial.
- Caps: 1,000 characters for a question and for the text pointed at, 20,000 for an answer, 50
  questions per chapter.

## Amendment: your own shared copy in the library (0.5.x)

- A tutorial you shared was listed twice: the private copy and the shared README the graph
  found. The library (`commands/tutorials.rs::library`, mirrored by the mock) now lists **one
  row, the private one**, when a shared README is the private tutorial's `sharedAs`, holds the
  same id (from the graph, not read again) and its files are **exactly what sharing the private
  copy writes** (`share::in_sync`: the write plan has nothing to change; bytes compared, nothing
  parsed).
- Matching on the id alone was rejected: a shared copy changed since (a teammate's accepted
  review, pulled) would be hidden behind an older private row, with no way to reach it or the
  actions only a shared reference has (the relocation fix, verifying and reviewing the shared
  files), and Share would replace it silently. Such a copy keeps its own row, and the private
  one is marked `sharedDiffers`; its badge and Share tooltip say so, and the write confirmation
  lists the files that would change.
- The preview's **Take it in the Academy** on a hidden copy opens the private row
  (`openSharedFile` in `stores/academy.ts`), so an open tutorial always has its row.
- **Delete** of a private tutorial keeps the progress when its shared copy still holds the
  tutorial: the progress is keyed by id, so it is the shared copy's too.

## Consequences

- The Academy's only writes in the opened folder are `write_tutorial` calls after the
  confirmation lists the files: Share, Save as… (when the chosen folder is inside it), and the
  updates of a shared tutorial (accepted proposals, relocations, verification).
- Progress survives an update of the tutorial and a teammate's pull; only steps whose content
  changed are marked.
- A shared tutorial written on Windows reads on Linux (paths with `/`, LF).
- Verification is a cheap, honest signal: a person said it was right at a commit. Phase 9's git
  layer will replace the `.git` file reading.
- The freshness check is not cached per disk revision, as the plan intended: it runs on open and
  on each library listing, which reads every shared README again. It is fast (3.3 ms for 20
  ranges on the 10k-document reference project, debug build).
