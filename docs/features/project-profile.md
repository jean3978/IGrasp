# Project profile

What kind of project the open folder is, detected **locally, without AI**
([ADR 0021](../decisions/0021-project-profile-from-a-marker-table.md)). Every learning
generation (the quiz today, tutorials in Phase 5) receives it, the subject proposals and the
roles the quiz wizard proposes (a game: programmers, designers, artists, producers…) are derived
from it, and you see and correct it.

## What is detected

- **Kinds**: game, web front end, web back end, mobile app, desktop app, library, command-line
  tool, service, data / ML, infrastructure, embedded, monorepo, documentation.
- **Engines** with their version when the project says it: Unreal (`*.uproject`, `*.Build.cs`),
  Unity (`ProjectSettings/ProjectVersion.txt`, `Packages/manifest.json`, `*.unity`), Godot
  (`project.godot`, `*.tscn`, `*.gd`, or its Rust bindings), and from dependencies Bevy,
  Macroquad, ggez, Pygame, Phaser, MonoGame. An engine implies the game kind.
- **Frameworks**: from manifest dependencies (`package.json`, `Cargo.toml`, `pyproject.toml`,
  `go.mod`, `*.csproj`, Gradle, ...): React, Tauri, Django, Express, ...
- **Languages** by share of bytes of the files the walk sees (markdown included).
- **Modules**: the top-level folders with a role (source, tests, docs, assets, scripts, build,
  CI) and their main language.
- **Build, tests and CI**: build systems and scripts, test frameworks, CI providers.
- **Main documents**: README, architecture, decisions.
- A **one-line summary** ("igrasp-demo: a command-line tool in TypeScript, tested with Vitest.").

Each value carries a confidence and the files that justify it (shown in the tooltip).

## How it works

- `src-tauri/src/profile/walk.rs`: one walk of the folder with the scan's rules (gitignore,
  dotfolders, your extra ignore patterns), bounded at 200,000 entries or 10 seconds; beyond, the
  profile says it is partial.
- `profile/markers.rs`: the **marker table**: file names, extensions and manifest keys mapped to
  what they prove. `profile/manifests.rs` parses manifests (TOML, JSON); nothing is executed.
- `profile/languages.rs`, `modules.rs`, `summary.rs`: the shares, the modules and the summary.
- The profile is cached per folder until the watcher reports a change on disk; **Detect again**
  rebuilds it.

## Corrections

**Edit** on the profile card (quiz home, Settings → Learning, or **Learn → Project Profile…**)
removes or restores detected kinds, engines and frameworks, adds missing ones, and takes free
**notes for the generators** ("this is also a dedicated server"). Corrections are stored per
folder in app data, applied on top of every detection, and marked `(you)` as evidence. **Reset to
detected** clears them.

## Adding an ecosystem

1. Add rows to the marker table in `profile/markers.rs` (a file name, an extension or a
   manifest key, what it proves, the confidence).
2. Add a fixture project in `profile/tests.rs` (a few files written to a temp folder) and assert
   the kinds, engines, frameworks and languages it should give.
3. Run `cargo test --manifest-path src-tauri/Cargo.toml profile`.

The repository itself is a fixture (the dogfooding test): its profile must stay right.

## Performance

`profile_perf_on_the_large_project` (ignored; run with the performance tests) builds the profile
of the generated large project (12,000 files) and must stay under 2 seconds. Recorded for 0.4.0
on Windows 11 (release build): 131 ms for the walk, the markers and the summary.

```sh
cargo test --release --manifest-path src-tauri/Cargo.toml profile_perf -- --ignored --nocapture
```

## The mock

The mock backend (`src/ipc/mock/mockProfile.ts`) returns the fixture project's profile
(TypeScript, Vitest, GitHub Actions, a command-line tool) and keeps corrections like Rust, so the
browser dev mode and the tests show and edit a real-looking profile.
