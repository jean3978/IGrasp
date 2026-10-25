---
igrasp: tutorial
id: igrasp-your-first-contribution-adding-a-new-ipc-command-from-rust-to-the-mock-backend-and-the-ui-2026-10-25
title: 'IGrasp: your first IPC command, from Rust to the mock to the UI'
intro: You will add one command to IGrasp end to end. You will write the Rust handler and its ts-rs types, register it in lib.rs, declare it on the Backend interface, implement it twice (tauri.ts and the in-memory mock), and call it from a store and a view. You will also know which checks catch a missed step, and which ones don't.
project: igrasp
subject: 'Your first contribution: adding a new IPC command from Rust to the mock backend and the UI'
familiarity: maintainer
length: deep
generated: 2026-10-25T16:02:13Z
provider: claude-cli
model: sonnet
generationCommit: d353601
docsNote: No page lists the places a new command must touch. The checklist lives in the agent-oriented notes and is only implied by ADR 0007 and the command table in docs/architecture.md; a short "Adding an IPC command" section in CONTRIBUTING.md would help.
chapters:
- id: c1
  title: 'The map: one command, five places'
  goal: Name every file a new command touches (commands/*.rs, lib.rs, ipc/types.ts, ipc/tauri.ts, ipc/mock/index.ts, a store) by following get_graph_status through them, and explain why src/ipc/client.ts is the single switch between the real backend and the mock.
  minutes: 8
  file: 01-the-map-one-command-five-places.md
- id: c2
  title: 'The Rust side: a command in commands/ with AppState and AppError'
  goal: 'Write a #[tauri::command] in src-tauri/src/commands/graph.rs style: take State<AppState>, go through with_workspace so a closed folder yields NoRootOpen, return AppResult<T>, and register it in generate_handler! in lib.rs.'
  minutes: 9
- id: c3
  title: 'Types across the wire: ts-rs, camelCase and the generated folder'
  goal: 'Define a response struct with Serialize, TS, rename_all camelCase and #[ts(export)], explain how .cargo/config.toml (TS_RS_EXPORT_DIR, TS_RS_LARGE_INT) turns cargo test into the type generator, and why CI''s git diff --exit-code on src/ipc/generated fails an unregenerated type.'
  minutes: 8
- id: c4
  title: 'The frontend contract: Backend interface and the Tauri implementation'
  goal: Add the method to the Backend interface in src/ipc/types.ts (import and re-export of the generated type), then implement it in tauri.ts through the wrapping invoke, with the camelCase argument names matching the Rust parameters, and explain how errors become BackendError.
  minutes: 8
- id: c5
  title: 'The mock backend: behaving like Rust in src/ipc/mock'
  goal: 'Implement the command in createMockBackend (src/ipc/mock/index.ts) so it matches Rust: NoRootOpen rejection, the generation, state.graph/state.index readiness, structuredClone of results, and helper logic placed in a mock*.ts module; explain why the mock exists (ADR 0007).'
  minutes: 10
- id: c6
  title: 'Store and view: calling the command from the UI'
  goal: Call the new command from a zustand store action (as useGraph.loadBroken does, ignoring responses of an older generation) and render it in a view such as BrokenLinksPanel, and, when it is a user action, register it in menuActions.ts so menus, buttons and shortcuts dispatch through it.
  minutes: 9
- id: c7
  title: 'Proving it: Rust tests, mock tests, Playwright and npm run check'
  goal: 'Test the command at each layer: a Rust unit test on a tempdir graph like commands/graph.rs, a Vitest test on createMockBackend after openRoot, a Playwright spec using openFixture and window.__igraspMock, then run npm run check and read what it covers.'
  minutes: 9
- id: c8
  title: 'Ship it: docs, changelog and the traps that remain'
  goal: 'Finish a command contribution the way IGrasp expects it: a row in docs/architecture.md''s command table, the docs/features page, CHANGELOG [Unreleased], Conventional Commits; and list the drift risks (mock vs Rust, an unlisted handler, a filtered cargo test skipping export_bindings).'
  minutes: 8
sources:
- path: docs/architecture.md
  lines: 75-85
  sha256: 616f0f135c0d37d8278fad862242b158451dcc5dc3b32d59c1805cf073b46054
- path: src/ipc/tauri.ts
  lines: 84-91
  sha256: 28c6e3535ce01e0532af0aa610ff15779125fdda7420ca85d0e4351e48779bd7
- path: src-tauri/src/commands/graph.rs
  lines: 64-76
  sha256: 389e99eb9c0e2054c330e1299a63efae4bdbcc288319db30f91f263385eedf2b
- path: src-tauri/src/lib.rs
  lines: 84-92
  sha256: 90d776941905995ae82e7119e9e663ffbb32de5c1b19ba1167d1842d5ffc1e90
- path: src/ipc/types.ts
  lines: 266-276
  sha256: f1d240f3a4fbc587f84a882a47b4d05406b03b205b793dd029f7160a1382c14d
- path: src/ipc/mock/index.ts
  lines: 502-512
  sha256: d5280c7b1f5249006ae4a21778c676152a77647757e3a3033a137e4889fb4a6e
- path: src/stores/graph.ts
  lines: 87-103
  sha256: dee5f5b6dabaf1eee1b5b8cb264485cacb427ac590eccb94de47c9552fb35a64
- path: src/ipc/client.ts
  lines: 1-19
  sha256: 0b40c21df43cd5fa3e40b6f309ddcde8c51bfa81f4caf667b3a74c4122eb79f6
- path: src/ipc/types.ts
  lines: 240-242
  sha256: 3e5f396f0c968084ce7932abb1ef6144fac5ca7ec72fd5c16b11a52f1762fcfb
- path: src/ipc/client.ts
  lines: 8-19
  sha256: e94025a10a1cd623624b26eabefab9ce2bba1aaac8c1c65450237b58d636f2e5
- path: src/ipc/tauri.ts
  lines: 31-32
  sha256: 224782f64fdd92785621fc8f325c0976fbb83a9e7452df180a7085fe697f9daa
- path: src-tauri/src/lib.rs
  lines: 67-90
  sha256: 00e21d30973d53206ab2af96d4fdc121178b1512df7036f8fcda50047d12bb57
- path: src/ipc/tauri.ts
  lines: 67-68
  sha256: cadb82ea503e1bdd306126db5f6d6e542e16d18522966486443eedeca6382a2c
- path: src/ipc/mock/index.ts
  lines: '150'
  sha256: 3444c9f41b9054bb6cbffa0d7a110a2c80839d6b7ea127c05bd15ae1e948f328
- path: docs/architecture.md
  lines: 106-108
  sha256: fe49bf18462bfb2dedda7147ea9412d568a2d5eeadd07a8b5fdccb35a1ba1eae
- path: src-tauri/src/lib.rs
  lines: 67-70
  sha256: 77be5465cbad0b1f660b276aa0c0d728cbbf6d9a151771f5931d901cbc63d4af
- path: docs/decisions/0007-e2e-with-playwright-and-mock-ipc.md
  lines: 12-36
  sha256: fc564d6a90aaa529f736c1b5a7f07bcd52fb886fc1f05349dca0c3251586aacd
- path: src/ipc/mock/index.ts
  lines: 1-2
  sha256: c20d31222d57fbf747781923e36877e7067e50beae09af79ff99d7a39c268e79
- path: src/ipc/tauri.ts
  lines: '90'
  sha256: 5604b7131b205191f810fa07610857ea246d25ba4fa1d02926816f96399f4d6f
- path: src/ipc/types.ts
  lines: 275-276
  sha256: 27ab838cdb275f4ff50d0723eedd6ec1fb8d36a90864db4a9895c4b4079c1ba8
---

# IGrasp: your first IPC command, from Rust to the mock to the UI

You will add one command to IGrasp end to end. You will write the Rust handler and its ts-rs types, register it in lib.rs, declare it on the Backend interface, implement it twice (tauri.ts and the in-memory mock), and call it from a store and a view. You will also know which checks catch a missed step, and which ones don't.

**Project:** igrasp · **Subject:** Your first contribution: adding a new IPC command from Rust to the mock backend and the UI · **For:** maintainers (deep dive) · **Length:** deep (~30 min) · **Written:** 2026-10-25 by Hoot with sonnet

## Chapters

1. [The map: one command, five places](01-the-map-one-command-five-places.md) — Name every file a new command touches (commands/*.rs, lib.rs, ipc/types.ts, ipc/tauri.ts, ipc/mock/index.ts, a store) by following get_graph_status through them, and explain why src/ipc/client.ts is the single switch between the real backend and the mock. (8 min)
2. The Rust side: a command in commands/ with AppState and AppError — Write a #[tauri::command] in src-tauri/src/commands/graph.rs style: take State<AppState>, go through with_workspace so a closed folder yields NoRootOpen, return AppResult<T>, and register it in generate_handler! in lib.rs. (not written yet)
3. Types across the wire: ts-rs, camelCase and the generated folder — Define a response struct with Serialize, TS, rename_all camelCase and #[ts(export)], explain how .cargo/config.toml (TS_RS_EXPORT_DIR, TS_RS_LARGE_INT) turns cargo test into the type generator, and why CI's git diff --exit-code on src/ipc/generated fails an unregenerated type. (not written yet)
4. The frontend contract: Backend interface and the Tauri implementation — Add the method to the Backend interface in src/ipc/types.ts (import and re-export of the generated type), then implement it in tauri.ts through the wrapping invoke, with the camelCase argument names matching the Rust parameters, and explain how errors become BackendError. (not written yet)
5. The mock backend: behaving like Rust in src/ipc/mock — Implement the command in createMockBackend (src/ipc/mock/index.ts) so it matches Rust: NoRootOpen rejection, the generation, state.graph/state.index readiness, structuredClone of results, and helper logic placed in a mock*.ts module; explain why the mock exists (ADR 0007). (not written yet)
6. Store and view: calling the command from the UI — Call the new command from a zustand store action (as useGraph.loadBroken does, ignoring responses of an older generation) and render it in a view such as BrokenLinksPanel, and, when it is a user action, register it in menuActions.ts so menus, buttons and shortcuts dispatch through it. (not written yet)
7. Proving it: Rust tests, mock tests, Playwright and npm run check — Test the command at each layer: a Rust unit test on a tempdir graph like commands/graph.rs, a Vitest test on createMockBackend after openRoot, a Playwright spec using openFixture and window.__igraspMock, then run npm run check and read what it covers. (not written yet)
8. Ship it: docs, changelog and the traps that remain — Finish a command contribution the way IGrasp expects it: a row in docs/architecture.md's command table, the docs/features page, CHANGELOG [Unreleased], Conventional Commits; and list the drift risks (mock vs Rust, an unlisted handler, a filtered cargo test skipping export_bindings). (not written yet)

## Hoot's notes

- Documentation: No page lists the places a new command must touch. The checklist lives in the agent-oriented notes and is only implied by ADR 0007 and the command table in docs/architecture.md; a short "Adding an IPC command" section in CONTRIBUTING.md would help.

<sub>Written by IGrasp's Academy. Open this folder in IGrasp to take the tutorial; the 20 cited ranges are checked against the files when it opens.</sub>
