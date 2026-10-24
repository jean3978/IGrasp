# 0008 — Pin TypeScript 5.9 and Vite 8

- Status: Accepted
- Date: 2026-10-23

## Context

TypeScript 7 (the native Go port) is the current `latest` release, but `typescript-eslint`, which
provides the type-aware lint rules, only supports TypeScript below 6.1. `@vitejs/plugin-react` 6
requires Vite 8.

## Decision

- Pin **TypeScript 5.9.3**.
- Use **Vite 8** and Vitest 5.
- Pin every npm dependency to an exact version (`save-exact=true` in `.npmrc`) and commit the
  lockfiles; Dependabot proposes grouped updates weekly.

## Consequences

- No TypeScript 7 build speed-up for now. Revisit when `typescript-eslint` supports it.
- Recent majors (Vite 8 with Rolldown, Vitest 5) may have rough edges; CI on both platforms catches
  regressions from updates.
