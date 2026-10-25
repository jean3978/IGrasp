---
igrasp: tutorial-chapter
tutorial: how-igrasp-demo-starts-20261025-5726
chapter: c2
---

# 2. Build and test with the Makefile

> **Hoot:** Hoot runs the Makefile of igrasp-demo, the way its CI does.

## 1. Two targets in the Makefile

The igrasp-demo Makefile has `build` (`npm run build`) and `test` (`npm test`); package.json maps them to `tsc` and `vitest run`.

Sources: [`Makefile:1-5`](../../../Makefile#L1-L5)

## 2. From a push to the tests

```igrasp-put-in-order
prompt: Put what happens after a push to igrasp-demo in order.
items:
- ci.yml starts the test job on push
- the job runs make test
- the Makefile runs npm test
- package.json runs vitest run
explanation: ci.yml triggers on push and runs `make test`; the Makefile calls `npm test`, which package.json maps to `vitest run`.
sources:
- path: .github/workflows/ci.yml
  lines: 1-7
- path: Makefile
  lines: 4-5
```

## 3. Which file does what

```igrasp-match
prompt: Match each file of igrasp-demo to its job.
pairs:
- left: Makefile
  right: names the build and test targets
- left: package.json
  right: maps the npm scripts to tsc and vitest
- left: ci.yml
  right: runs make test on every push
explanation: The Makefile is the entry, package.json holds the scripts, and .github/workflows/ci.yml runs `make test` on push.
sources:
- path: Makefile
  lines: 1-5
- path: package.json
  lines: '5'
```

## 4. Run the tests of igrasp-demo

```igrasp-try-it
instruction: In a terminal at the root of igrasp-demo, run the Makefile's `test` target and watch vitest run.
command: make test
where: terminal
expected: npm test runs vitest run, as package.json says.
sources:
- path: Makefile
  lines: 4-5
```

## 5. Recap

- The Makefile has build and test targets.
- package.json maps them to tsc and vitest run.
- ci.yml runs make test on every push.

## Questions from readers

```igrasp-question
step: 4
quote: make test
question: Can I run it without make?
answer: 'Yes: `npm test` runs the same `vitest run` (package.json).'
```
