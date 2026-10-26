# 0028 — Subject families built locally from the profile

- Status: Accepted (amended in 0.5.x: subjects for the reader's role)
- Date: 2026-10-25

## Context

The Academy's home asks "What do you want to learn?". A blank box is hard to answer about a
project one does not know yet, so the home also offers subject cards. They must be about **this**
project (ADR 0016: nothing generic), must not spend tokens (opening the Academy is free), must
work on any kind of project (a game on any engine, a web app, a service, a library, a CLI, a
docs-only folder), and must not offer a subject the project has nothing to say about.

Phase 4 already detects, locally, the project profile (ADR 0021) and the quiz's subjects
(`learning/subjects.rs`: concepts and features with their anchor files and an amount of
material).

## Decision

- **The cards are built in Rust, locally** (`learning/tutorial/families.rs`), from the corrected
  profile, the corpus and the quiz's subject detection. `list_tutorial_subjects` returns them; no
  provider is involved. The mock hand-writes the cards of its fixture project
  (`src/ipc/mock/mockFamilies.ts`); there is no detection logic in TypeScript.
- **Twelve universal families**, offered to any project that has the material: The Big Picture;
  Tech Stack, as used here; Architecture Tour; Feature Deep Dive; Trace It; Dependencies; Build,
  Run, Test, Ship; Conventions and Patterns; Decisions; Your First Contribution; Project Story;
  Glossary. Feature Deep Dive and Trace It need a **pick** (a feature to dive into, an action to
  follow such as "a file changes on disk"), at most six each. Each family has a **focus**
  paragraph that the outline prompt receives (what The Big Picture covers, what Trace It follows).
- **Domain families** come from the profile's kinds and engines: Games (an engine or the game
  kind), Web, Mobile, Services and back ends, Libraries, CLIs and desktop apps, and Data, ML,
  infrastructure and embedded. Each has a **topic table** (for games: the engine's gameplay
  framework, the game loop, input, rendering and shaders, levels, networking, save and load, …;
  for the web: routing, state, authentication, data access, …). A topic is a card only when the
  corpus has files whose path words (or extensions, such as shaders and scenes) match it.
- **Material thresholds.** A card needs the quiz subjects' minimum material (at least 2 text
  files and 2 KB; "rich" from 40 KB). A folder below that for the whole project is `tooThin` and
  gets no card. Project Story needs a repository and a changelog, release notes or at least three
  decisions. At most 24 cards: universal first, then domain cards by material.
- **Phrased about the project.** A card's title and blurb use the project's name and its own
  files ("…, from `watcher.rs` and `tree.ts`"), never a bare family name. Its anchors (at most
  six) are inlined in the outline request.
- **"I'm new to…"**: the domains a reader may lack, offered as chips: the engines and frameworks
  of the profile, then the domain topics with material ("Godot materials and shaders", "web
  security"), at most 16. A domain card pre-fills it. The prompt teaches the domain through the
  project's own use of it, a concept at a time.
- **AI suggestions are kept as cards.** "Suggest more subjects" (one read-only validated run,
  behind its confirmation card) lists the cards already offered and asks for others; each
  suggestion must name the project and start from text files the model opened (never an agent
  or secret file). The accepted ones become cards of the **Suggested** family, kept with the
  folder in app data (`save_suggested_subjects`) and listed after the local cards.
- **Plan review, question 11** (subject cards in Rust only, the mock hand-writing the fixture's):
  answered as recommended. **Question 12** (Project Story without the git log, from the
  changelog, release notes and dated docs, when a repository is detected): answered as
  recommended; the family's focus says the commit history is not available. **Question 13**
  (the Academy as its own tab beside the Quiz tab): answered as recommended; the two link to
  each other through Quiz me on this tutorial.

## Amendment: subjects for the reader's role (0.5.x)

- The New tutorial wizard asks for the **role first**. The local cards stay built without the
  role (the families above); the frontend ranks them for it (`tutorialRoles.ts`: the families a
  role's craft reaches first, the others behind **More subjects**).
- **Suggest more subjects** takes the role (`TutorialRequest::Suggest { role }`). For a role of
  the developer family the task keeps the developer wording; for any other family it asks for
  subjects deeply tied to that role's own work in the project (its craft from `learning/role.rs`)
  and leaves out the code internals the role never meets. Each accepted card is stamped with
  `forRole`, and the wizard shows the suggestions kept for the chosen role. Suggestions made
  before roles have none and count as a developer's.

## Consequences

- Opening the Academy and seeing the cards costs nothing. Cards follow the profile's
  corrections: removing an engine removes its domain.
- A project with little material gets few cards, a docs-only folder The Big Picture and no
  domain card, an empty or binary-only folder none. Tests cover these cases, a Godot game
  (games cards, no web), a web back end, the cap, and this repository (dogfooding).
- The cards are rebuilt from the cached profile on each listing: 253 ms on the 10k-document
  reference project (debug build; the budget is 1 s, `perf_tutorials`).
- A new domain or topic is a table entry and a test, not new code.
- Project Story gains the commit log when Phase 7 brings the git layer.
