# Proof of concept: tutorials (before Phase 5)

Date: 2026-10-25. Branch `poc-tutorials`. Provider: the `claude` CLI 2.1.310, model `sonnet`,
read-only, through the app's gateway and validated runs. Nothing here is wired to IPC or to the
UI; the code lives in `src-tauri/src/learning/tutorial/` and the outputs in
`docs/plan/poc-tutorials/<tutorial>/`.

The format decision is [ADR 0025](../decisions/0025-tutorial-format-json-schema-and-shared-markdown.md).

> **After Phase 5 (0.5.0):** the Academy kept the schema, the prompts, the validator, the shared
> format (still owned by Rust, against recommendation 1 below) and the freshness check with
> relocation; it changed how chapters run (one staged run of fresh prompts with the recaps,
> [ADR 0026](../decisions/0026-staged-runs.md)), and added sharing through a confirmed write
> plan and verification by the user ([ADR 0027](../decisions/0027-tutorial-storage-sharing-and-verification.md)),
> the AI review, and the subject families ([ADR 0028](../decisions/0028-subject-families-built-locally.md)).
> See [the Academy](../features/academy.md).

## What was built

| Piece | Where | What it shows |
|---|---|---|
| Tutorial schema | `tutorial/schema.rs` | The outline (chapters with goals, minutes, key sources, self-check) and the chapter (Hoot's intro, 3 to 12 steps of ten types, each citing a file and a line range), as typed structs with `deny_unknown_fields` and as JSON schemas sent to the provider; what the app keeps (`Tutorial`, positional ids, hashed sources). |
| Prompts | `tutorial/prompt.rs` | The outline prompt (Hoot, the audience, the familiarity level, the domain gap, the length, the project profile, the grounding rules, the self-check, the corpus map and anchor files, agent files as context only), the chapter prompt as a continuation or as a fresh prompt, the repair prompts. A test asserts no provider name. |
| Validator | `tutorial/validate.rs` | Citations checked like the quiz (citable path, never an agent or secret file, lines inside the file, at most 120, 40 for tour stops and spot-it snippets), the self-check, the generic-content check (the text must name something of the project or a word of the cited lines), the rules of each step type, quick checks delegated to the quiz validator, coded rejections with a message for the model. |
| Shared markdown | `tutorial/markdown.rs` | `write` (a `README.md` with the front matter, one file per written chapter, prose steps as markdown, interactive steps as `igrasp-*` YAML blocks) and the tolerant `read`; `normalize`; the round trip is asserted on a tutorial with every step type and on every real tutorial. |
| Freshness | `tutorial/freshness.rs` | SHA-256 of the cited lines, the check (up to date, moved, changed, missing, unchecked), the local relocation of moved citations, the badge and the affected steps. |
| Composition and runs | `tutorial/compose.rs` | The two read-only requests with their `OutputValidator`s (accept, repair with the kept items, give up), and the ignored tests `real_tutorial` (outline then one chapter, written with the tokens and the event log) and `real_freshness` (a modified copy of the project). |

23 unit tests cover the module; `npm run check` passes.

How to reproduce one run (it spends tokens):

```sh
IGRASP_TUTORIAL_ROOT=<folder> IGRASP_TUTORIAL_SUBJECT="…" IGRASP_TUTORIAL_FAMILIARITY=new \
IGRASP_TUTORIAL_GAP="I'm new to …" IGRASP_TUTORIAL_LENGTH=standard IGRASP_TUTORIAL_OUT=<out> \
cargo test --manifest-path src-tauri/Cargo.toml real_tutorial -- --ignored --nocapture
IGRASP_TUTORIAL_ROOT=<folder> IGRASP_TUTORIAL_DIR=<out> \
cargo test --manifest-path src-tauri/Cargo.toml real_freshness -- --ignored --nocapture
```

## The real tutorials

Six tutorials on five projects: this repository, a Godot game, an Unreal game, a web app and a
mobile app (cloned shallow into a temporary folder; the Unreal and Flutter ones as sparse
checkouts, so the Unreal `Content/` folder with its binary assets was absent). Each run wrote the
outline, then chapter 1, through the gateway with the validator and its retries. Every folder
under `docs/plan/poc-tutorials/` holds the `README.md` and the chapter as the shared format,
`tutorial.json` (what the app would keep), `run.json` (the tokens), `events.log` (every tool use,
attempt and usage event), `freshness.json` and `README.relocated.md` (the freshness run).

| Tutorial | Project (as the local profile saw it) | Options | Outline | Chapter 1 |
|---|---|---|---|---|
| [godot-platformer-new-to-godot](poc-tutorials/godot-platformer-new-to-godot/README.md) | Platformer 2D: a Godot 4.7 game in GDScript | quick, new here, **"I know Unity but not Godot"** | 3 chapters | 6 steps |
| [igrasp-file-change](poc-tutorials/igrasp-file-change/README.md) | igrasp: a Tauri desktop app in TypeScript and Rust (React) | standard, already contributing | 4 chapters | 8 steps |
| [unreal-action-system](poc-tutorials/unreal-action-system/README.md) | ActionRoguelike: an Unreal Engine 5.8 game in C++ | standard, new here | 5 chapters | 8 steps |
| [web-fastapi-auth](poc-tutorials/web-fastapi-auth/README.md) | fastapi-full-stack-template: a web front end in TypeScript and Python (FastAPI, React), also a back end | standard, new here | 5 chapters | 8 steps |
| [flutter-compass-big-picture](poc-tutorials/flutter-compass-big-picture/README.md) | compass_app: a Flutter mobile app in Dart | standard, new here, chapter with a **fresh prompt** | 4 chapters | 7 steps |
| [igrasp-first-contribution-deep](poc-tutorials/igrasp-first-contribution-deep/README.md) | igrasp (same) | deep, maintainer | 8 chapters | 10 steps |

Every round trip (JSON → markdown → JSON) was lossless, and every tutorial was **Up to date**
against its project right after being written.

### Judging every step: is it specific to that project?

I read all 47 steps and checked 20 of their claims by hand against the files (the lines named
below). Verdict per step; **S** = specific to the project (would be false or meaningless in
another project), **B** = a concept bridge (generic concept applied to cited code, as the rules
allow), **W** = specific but weak.

**Godot, "Game scenes: Level, Player and the interface layer"** (6 steps)

| # | Type | Verdict | Note |
|---|---|---|---|
| 1 | explain | S | `project.godot:22` is `run/main_scene="res://game_singleplayer.tscn"`; the folder list is exact. |
| 2 | conceptBridge | B | Scene instancing explained against `game_singleplayer.tscn:12-17` (checked: `instance=`, `z_index`, `position`, `scale`); the Unity prefab comparison is what the gap asked for. |
| 3 | diagram | S | The flowchart is the real node tree (Game → Level → Player, InterfaceLayer layer 100 → PauseMenu). |
| 4 | codeTour | S | Three stops of `game.gd`; the annotations match the code (`class_name Game`, `_unhandled_input`, `tree.paused`). |
| 5 | spotIt | S | `process_mode = 3` is line 9, as claimed; the explanation of why pause works is right. |
| 6 | recap | S | The `Music` autoload is at `project.godot:26-28`, as cited. |

**IGrasp, "The watcher: debounce, classify, plan"** (8 steps, the reader already contributes)

| # | Type | Verdict | Note |
|---|---|---|---|
| 1 | explain | S | `handle` bumps `disk_revision` first (line 331) and drops events before the first scan (line 352); `DEBOUNCE` is 200 ms (line 33). |
| 2 | codeTour | S | Four stops through `classify` and its ignore-rules test; accurate. |
| 3 | spotIt | S | Line 145 is `Some(false) if !markdown => {}`, exactly the arm described. |
| 4 | quickCheck | S | `is_ignore_file` names `.git/info/exclude` (line 93) and runs before `is_skipped`; the wrong choices are plausible. |
| 5 | match | S | `Plan` fields to `apply_plan` work, with the mtime/size subtlety. |
| 6 | explain | S | The poll fallback, `POLL_INTERVAL`, `WatchMode`. |
| 7 | tryIt | S | The real `cargo test … index::watcher` command and the ignored real-notification test. |
| 8 | recap | S | |

**Unreal, "RogueActionComponent.cpp: the hub that owns Actions and the AttributeSet"** (8 steps)

| # | Type | Verdict | Note |
|---|---|---|---|
| 1 | explain | S | The component's three responsibilities, `GetActionComponent` delegating to the function library. |
| 2 | codeTour | S | `ActiveGameplayTags`, `AttributeSet` (Instanced, replicated), `DefaultActions` / `Actions` / `CachedActions`. |
| 3 | quickCheck | S | `OnRep_Actions` rebuilds `CachedActions` (lines 505-517, checked). |
| 4 | explain | S | `InitializeComponent` creates a bare attribute set and registers the subobject. |
| 5 | spotIt | S | Line 53 is `if (GetOwner()->HasAuthority())` inside `BeginPlay`, as claimed. |
| 6 | putInOrder | S | `StartActionByName` on the server. |
| 7 | tryIt | S | Find All References on `CachedActions`, with the expected hits. |
| 8 | recap | S | |

**FastAPI, "Credentials in: the login endpoint and password hashing"** (8 steps)

| # | Type | Verdict | Note |
|---|---|---|---|
| 1 | explain | S | Four files of the login path, named. |
| 2 | codeTour | S | `OAuth2PasswordRequestForm`, `authenticate`, `PasswordHash((Argon2Hasher(), BcryptHasher()))`, `SECRET_KEY` with no default (config.py:23, checked). |
| 3 | spotIt | S | Line 50 is `verify_password(password, DUMMY_HASH)` with the timing-attack comment above it. |
| 4 | conceptBridge | B | JWT in two sentences, then the two claims this project signs; no domain gap was given, the bridge is still applied. |
| 5 | explain | S | Argon2 now, Bcrypt tolerated, rehash on login, the `changethis` guard. |
| 6 | quickCheck | S | `test_login_with_bcrypt_password_upgrades_to_argon2` exists at test_login.py:129. |
| 7 | putInOrder | S | The six server-side steps, with the `is_active` check placed in the route. |
| 8 | recap | S | |

The `.env` at the root of this project was never read nor cited (the corpus hides it and the
rules forbid it; checked in `events.log`).

**Flutter, "The layer map: ui, domain, data"** (7 steps, chapter written with a fresh prompt)

| # | Type | Verdict | Note |
|---|---|---|---|
| 1 | explain | S | The folder roles, with `config/`, `routing/`, `utils/` and the `main*.dart` entry points. |
| 2 | match | W | Files to their layer folder: specific, but the path gives the answer; an easy warm-up. |
| 3 | codeTour | S | A ui, a domain, a data and a service file; `BookingRepository` returns `Result<…>` (lines 9-21, checked). |
| 4 | explain | S | `BookingCreateUseCase` spanning three repositories. |
| 5 | spotIt | S | Line 129 is `return Result.error(error);` in the `catch`. |
| 6 | quickCheck | S | `BookingApiModel` lives in `data/services/api/model`. |
| 7 | recap | S | |

**IGrasp, "The map: one command, five places"** (10 steps, deep, maintainer)

| # | Type | Verdict | Note |
|---|---|---|---|
| 1 | explain | S | The five hand-synced places and the snake_case string as the only link. |
| 2 | codeTour | S | Six stops; `lib.rs:84-92` is the `generate_handler!` list, `types.ts:20` and `:68` import and re-export `GraphStatus` (checked). |
| 3 | diagram | S | Stores → client → tauri or mock → lib.rs → commands → state and graph. |
| 4 | explain | S | `client.ts` as the single switch, with its cost (tauri.ts imported in the browser). |
| 5 | spotIt | S | Line 9 is `'__TAURI_INTERNALS__' in window`; `select()` uses it on line 13 (checked). |
| 6 | quickCheck | S | A missing `generate_handler!` entry fails only at runtime; the explanation says what `tsc` does catch. |
| 7 | match | S | |
| 8 | explain | S | ADR 0007's consequence, quoted faithfully. |
| 9 | tryIt | S | `rg "list_broken_links\|listBrokenLinks"`; tauri.ts:90 is the line where both spellings meet (checked). |
| 10 | recap | S | |

No step was generic. The two bridges are applied to cited code. Every claim I checked by hand was
true, including the line numbers. The `docsNote` of four tutorials pointed at real gaps (the Godot
README naming files that do not exist; no auth page in the FastAPI template; no architecture page
in compass_app; no "adding a command" page in IGrasp).

### What the validator caught

| Run | Attempts | What was rejected and repaired |
|---|---|---|
| Godot outline and chapter | 1 + 1 | nothing |
| IGrasp file-change chapter | 2 | a quick check whose hint gave the answer away |
| Unreal outline | 3 | 5 then 4 chapter goals flagged **generic** by the lexical check because they named identifiers (`URogueActionComponent`) without a file name. Fixed in the PoC: the identifiers of a chapter's key sources now count as project words. The retries cost about $0.16. |
| Flutter chapter (fresh prompt) | 2 | a quick check rejected by the quiz rules |
| IGrasp deep chapter | 2 | a citation whose lines did not check out, and a citation of a file that does not exist |
| Web outline and chapter | 1 + 1 | nothing |

The repair prompt kept the accepted items and the model replaced the rejected ones every time; no
run reached the cap, no run failed.

## Tokens and cost per size

As the provider reports them. *Input* is the CLI's usage for the operation, with cache creation
and cache reads included (so it counts every tool round trip against the same prompt, not the
context size). The CLI's `total_cost_usd` is cumulative over a session, so a chapter that
continues the outline's conversation is charged by difference (this is what the `costUsd` field of
`run.json` holds since the fix; the first three `run.json` files predate it and their raw values
are corrected below from `events.log`).

| Tutorial | Length | Outline: tools / input / output / cost / time | Chapter 1: attempts / tools / input / output / cost / time | Total |
|---|---|---|---|---|---|
| Godot | quick | 11 / 80 k / 3.4 k / $0.16 / 25 s | 1 / 1 / 78 k / 3.0 k / $0.19 / 27 s | **$0.36**, 54 s |
| Web | standard | 20 / 153 k / 4.1 k / $0.22 / 31 s | 1 / 0 / 49 k / 3.8 k / $0.20 / 28 s | **$0.41**, 61 s |
| Flutter | standard | 19 / 271 k / 3.6 k / $0.28 / 38 s | 2 / 7 / 230 k / 6.0 k / $0.24 / 44 s (fresh prompt) | **$0.52**, 87 s |
| IGrasp file change | standard | 17 / 467 k / 6.0 k / $0.41 / 45 s | 2 / 0 / 178 k / 8.6 k / $0.42 / 54 s | **$0.84**, 103 s |
| Unreal | standard | 11 (3 attempts) / 576 k / 14.8 k / $0.46 / 88 s | 1 / 0 / 153 k / 7.5 k / $0.40 / 46 s | **$0.86**, 139 s |
| IGrasp deep | deep | 30 / 529 k / 6.5 k / $0.46 / 54 s | 2 / 0 / 213 k / 10.8 k / $0.51 / 66 s | **$0.98**, 124 s |

What drives the cost is the size of the project the model reads (the IGrasp outline read 17 to
30 files; the Godot one 11 small files), not the length option: the outline prompt itself is 27
to 87 KB (the corpus map, the anchor files and the agent files inlined), and each tool round trip
re-reads it from the cache.

Extrapolated to whole tutorials with `sonnet`, one chapter per operation, from these numbers:

| Length | Chapters | Outline | Per chapter | Whole tutorial | Wall time |
|---|---|---|---|---|---|
| quick (~5 min) | 2–3 | $0.15–0.25 | $0.15–0.25 | **$0.5–1** | 1.5–2.5 min |
| standard (~15 min) | 3–5 | $0.2–0.45 | $0.2–0.45 | **$1–2.5** | 3–5 min |
| deep (~30 min) | 5–8 | $0.45–0.6 | $0.4–0.55 | **$3–5** | 6–10 min |

Continuing the outline's conversation (`--resume`) versus a fresh prompt per chapter: the resumed
chapter made 0 or 1 tool call (the model reused what it read for the outline) but carried the
whole outline conversation; the fresh Flutter chapter made 7 tool calls and cost $0.24 for two
attempts, in the same range as the resumed ones ($0.19–0.51). Later chapters of a resumed
conversation would grow its context chapter after chapter; a fresh prompt per chapter bounds the
cost and lets the user generate chapters in any order or regenerate one later. Phase 5 should use
a fresh prompt per chapter with the accepted outline and the recaps of the chapters already
written (to avoid repetition), and keep `--resume` for the repair attempts only.

## Freshness: changed, moved and missing lines

`real_freshness` copies the cited files of a tutorial's project to a temporary folder, inserts
five lines at the top of the first cited file (every citation of it *moved*), appends text to the
first cited line of the second (*changed*), deletes the third (*missing*), then runs the check,
the relocation and the check again.

| Tutorial | Sources | Result |
|---|---|---|
| Godot | 9 | `game.gd` ×3 moved and relocated (1-6 → 6-11, …), `game_singleplayer.tscn:1-24` changed while its three other ranges stayed up to date, `project.godot` ×2 missing; affected steps 1 and 6 |
| IGrasp file change | 16 (one file) | 15 of 16 ranges moved and relocated, the one holding the changed line reported changed; affected step 1 |
| Unreal | 12 (two files) | 8 ranges of the `.cpp` relocated; the `.h` range with the changed line reported changed |
| Web | 10 | 4 relocated, `config.py` changed, `security.py` ×3 missing; affected steps 1, 2, 4, 5 |
| Flutter | 10 | `README.md` relocated, `booking_repository.dart` changed, `booking_repository_remote.dart` missing; affected steps 3 and 6 |
| IGrasp deep | 20 | 2 relocated, ADR 0007 changed, `commands/graph.rs` missing; affected steps 2, 3 and 8 |

After relocation, a second check reports no moved range. The spot-it answer line follows its
snippet. The relocated README is written next to the original (`README.relocated.md`) so the
before and after can be diffed.

## Limitations

- **One chapter per tutorial.** Only chapter 1 of each outline was generated; the cost of later
  chapters in a resumed conversation, and repetition between chapters, were not measured.
- **The validator checks grounding, not truth.** It proves that every citation is a real range of
  a citable file and that every step names the project; it cannot tell a wrong sentence from a
  right one. The 20 claims I checked by hand were all true, which is a small sample. The AI
  review of Phase 5 ("Check with Claude") and the reader's own eyes remain the truth check.
- **The generic-content check is lexical.** It rejected five correct Unreal chapter goals before
  the key-source identifiers were added to its vocabulary, and it would accept a generic sentence
  that happens to mention a project word. The self-check field and the prompt do most of the
  work; the lexical check is a backstop.
- **Binary assets were barely exercised.** The Unreal sparse checkout had no `Content/`; the
  Godot project lists `.webp`, `.ogg` and `.ttf` assets by name and the model never cited them.
  The "name only, never alone" rule is implemented and unit-tested, not observed on a real run.
- **Relocation is exact.** A range that moved *and* changed is reported as changed, a renamed
  file as missing. This is by design (the AI review handles the rest), but a tutorial on a file
  that is being reformatted will show *Maybe outdated* quickly.
- **Cost reporting** depends on the provider: the CLI reports a cumulative session cost and a
  per-operation usage that includes cache reads. A provider without cost reporting shows tokens
  only.
- **`docsNote` is a judgement**, not a fact: the four notes were useful here, but the model may
  also report a gap that a page it did not open already fills.
- **Not wired.** No IPC command, no store, no UI, no frontend reader of the format, no scan
  recognition of tutorial folders; YAML is read and written in Rust with `serde_yaml` (an
  unmaintained but stable crate) because the generation and the checks run there. Phase 5
  mirrors `markdown.rs` in TypeScript as the quiz does (ADR 0024), on shared fixtures.
- **Small things to fix in Phase 5:** the tutorial id embeds the whole subject slug (too long);
  the IGrasp tutorials were generated with the earlier PoC outputs present in the corpus (nothing
  cited them); `run.json` and `events.log` hold absolute paths of the machine that ran them.

## Recommendations for Phase 5

1. Keep the schema and the shared format as they are (ADR 0025); add the frontend reader and
   writer with the same fixtures, and the scan's recognition of `igrasp: tutorial` folders.
2. One gateway operation per chapter with a fresh prompt (the accepted outline, the recaps of the
   written chapters, the chapter's goal and key sources), `--resume` only for repairs.
3. Keep the validator's rules; add the key-source identifiers to the outline check (done here),
   and consider a soft rule that a chapter has at least one interactive step.
4. The confirmation card can show the outline prompt's size (27 to 87 KB here) and the expected
   cost range per length from the table above, until real usage numbers exist per folder.
5. Hoot's intro lines, the docs notes and the material notes read well as written: keep them in
   the format and show them in the Academy.
