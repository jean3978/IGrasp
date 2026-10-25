# 0023 — Hoot: an original SVG owl with CSS states and local lines

- Status: Accepted
- Date: 2026-10-25

## Context

The learning features need a voice that makes being quizzed on a codebase feel friendly rather
than like an exam, without turning the app into a toy for an audience of developers. A mascot
drawn with a third-party asset would bring a licence; an animated library would bring a
dependency; lines written by the AI on every event would spend tokens without a user action.

## Decision

- **Hoot** is an original SVG owl (`src/features/hoot/Hoot.tsx`): round body, big glasses with
  a glint, eyebrow tufts, wings that can raise, feet on a branch. Every colour comes from the
  `--hoot-*` tokens of the three themes; High Contrast draws white outlines and flat fills.
- Five **states** (`idle`, `thinking`, `cheering`, `explaining`, `encouraging`) are CSS classes
  with keyframes and transitions on the SVG parts (`hoot.css`); `prefers-reduced-motion` or the
  Effects setting off shows a still pose per state. A gallery (`?hoot=1`) shows them side by
  side for review.
- Hoot's **speech lines are local** (`hootLines.ts`): short, varied, never the same line twice
  in a row, chosen per moment (home, thinking, reading a file, right, wrong, streak, level up,
  results). They cost nothing and run without a provider.
- The AI's voice is limited to what it writes on request: questions, hints and explanations.
  Their tone (`learning/hoot.rs`, `HOOT_TONE`) is shared by every learning prompt: warm, brief,
  precise, for developers, never condescending, never generic.
- Celebrations (confetti, sparks, a ring on a level up) are drawn by a small in-house particle
  system on a canvas over the Quiz tab, capped at 400 particles and idle when nothing moves.

## Consequences

- No new dependency and no licence to track; the owl themes like the rest of the app.
- Lines never vary with the project; what is project-specific comes from the generated content.
- Phase 5's tutorials reuse Hoot, its states, its lines module and the tone.
