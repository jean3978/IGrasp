---
igrasp: tutorial-chapter
tutorial: how-igrasp-demo-starts-20261025-5726
chapter: c4
---

# 4. Decisions and changes of igrasp-demo

> **Hoot:** Hoot opens the one decision igrasp-demo recorded.

## 1. Decision 0001

docs/decisions/0001-use-git-cli.md records that igrasp-demo runs `git` as a subprocess.

Sources: [`docs/decisions/0001-use-git-cli.md:1-3`](../../../docs/decisions/0001-use-git-cli.md#L1-L3)

## 2. The changelog

CHANGELOG.md of igrasp-demo keeps an Unreleased section that lists "Everything".

Sources: [`CHANGELOG.md:1-5`](../../../CHANGELOG.md#L1-L5)

## 3. How does decision 0001-use-git-cli.md say igrasp-demo talks to git?

```igrasp-quiz
kind: multipleChoice
choices:
- As a subprocess
- Through a library
- Over a web service
answer: 0
hint: Read line 3 of the decision record.
explanation: 'docs/decisions/0001-use-git-cli.md: "We run `git` as a subprocess."'
sources:
- path: docs/decisions/0001-use-git-cli.md
  lines: '3'
```

## 4. The decisions folder

docs/architecture.md points readers at the decisions folder of igrasp-demo (line 14).

Sources: [`docs/architecture.md:14`](../../../docs/architecture.md#L14)

## 5. Recap

- Decision 0001 makes igrasp-demo run git as a subprocess.
- CHANGELOG.md collects changes under Unreleased.
- The decisions live in docs/decisions.
