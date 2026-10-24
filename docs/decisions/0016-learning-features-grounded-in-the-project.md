# 0016 — Learning features grounded in the whole project

- Status: Accepted
- Date: 2026-10-24

## Context

The roadmap had a quiz (Phase 4) generated from the project's markdown documentation only. Two
needs changed that scope:

- Documentation alone does not show how a project really works: the code, configuration, build
  scripts and tests do. A newcomer needs both.
- A new feature is wanted: **tutorials**, an onboarding generator that writes interactive,
  guided lessons about the opened project, saved privately, optionally shared with the team in
  the repository, and checked for freshness when the code changes.

IGrasp opens any kind of project: games on any engine (Unity, Unreal, Godot, ...), web, mobile,
desktop, libraries, services, data, infrastructure. Its users are developers: new to a project,
or lacking one of its domains (web security, Unreal materials, ...), not people who have never
programmed. Generic lessons about a technology are everywhere online; what is missing is how
**this** project uses it.

## Decision

- **Tutorials become Phase 5** ("Hoot's Academy"), right after the quiz. Editing, Git and the
  Mermaid visual editor move to Phases 6, 7 and 8.
- The quiz and tutorials read the **whole project** (code, configuration, docs, tests), with the
  scan's ignore rules. Files written for AI agents (`CLAUDE.md`, `AGENTS.md`, `.claude/`, ...)
  may be read for context but are never cited as a source.
- **Grounding rule**: every question and tutorial step must be about this project and cite at
  least one of its files (with a line range for text files). Content that would make sense
  unchanged in another project is rejected. A general concept appears only as a one- or
  two-sentence bridge applied to the cited code, with a link to the official documentation.
  When the project lacks material for a subject, the generator says so instead of writing
  generic content.
- **Audience**: developers. Programming basics are never explained; levels describe familiarity
  with the project, and an optional "I'm new to …" domain is taught through the project's own
  use of it.
- A **project profile** (kinds, engines, frameworks, languages, modules, build and test setup) is
  detected **locally, without AI**, from markers in the scan, shown to the user, correctable, and
  sent with every generation. Subject proposals are built from it, also without AI.
- Every AI call of these features goes through the AI provider abstraction and its gateway
  (ADR 0015, from the Phase 3 proof of concept): only on a user action, read-only. Tutorials
  are never changed or marked as verified by the AI: freshness is checked locally for free, an
  AI review runs only when asked, and its proposed changes are accepted or rejected by the user.
- Private tutorials and all progress live in app data. Sharing a tutorial with the project is an
  explicit action that writes markdown files into the opened folder after a confirmation; it is
  the first feature that writes in the project, and only on that action. The exact format is
  decided by an ADR in Phase 5.

## Consequences

- Questions and lessons are useful to experienced developers and specific to the project, at the
  cost of a stricter generation pipeline (citation checks, rejection and capped retries).
- The project profile detector must know many ecosystems and needs fixtures for each kind of
  project; binary assets (e.g. `.uasset`) can only be used by name and location.
- Reading the whole project makes generations larger than docs-only ones; the confirmation card
  shows the expected size before anything runs.
- The rule "IGrasp never writes inside the folder you open" becomes "never on its own": shared
  tutorials, like future editing, are written only on an explicit user action.
