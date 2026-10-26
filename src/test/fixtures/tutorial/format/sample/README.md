---
igrasp: tutorial
id: orbit-the-watcher-20261025
title: Orbit's watcher
intro: You will follow a file change from the disk to the toast.
project: orbit
subject: How the watcher works
familiarity: newHere
domainGap: I'm new to file watchers
length: standard
generated: 2026-10-25T10:00:00Z
provider: mock
model: m
generationCommit: abc1234
docsNote: Nothing documents the poll fallback.
chapters:
- id: c1
  title: The watcher
  goal: Explain how src/index/watcher.rs debounces.
  minutes: 5
  file: 01-the-watcher.md
- id: c2
  title: The graph
  goal: Explain how the graph applies a batch.
  minutes: 6
sources:
- path: src/index/watcher.rs
  lines: 2-6
  sha256: '0000000000000000000000000000000000000000000000000000000000000000'
---

# Orbit's watcher

You will follow a file change from the disk to the toast.

**Project:** orbit · **Subject:** How the watcher works · **For:** developers new to the project · **New to:** I'm new to file watchers · **Length:** standard (~15 min) · **Written:** 2026-10-25 by Hoot with m

## Chapters

1. [The watcher](01-the-watcher.md) — Explain how src/index/watcher.rs debounces. (5 min)
2. The graph — Explain how the graph applies a batch. (not written yet)

## Hoot's notes

- Documentation: Nothing documents the poll fallback.

<sub>Written by IGrasp's Academy. Open this folder in IGrasp to take the tutorial; the 1 cited ranges are checked against the files when it opens.</sub>
