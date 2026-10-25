---
igrasp: tutorial-chapter
tutorial: how-igrasp-demo-starts-20261025-5726
chapter: c1
---

# 1. The entry point: main() in src/main.ts

> **Hoot:** Hoot starts where igrasp-demo starts: main() in src/main.ts.

## 1. Where igrasp-demo starts

The README points at `src/main.ts` lines 9-12: `main()` takes `Options` and returns the greeting from `greet(name)`.

Sources: [`src/main.ts:9-12`](../../../src/main.ts#L9-L12)

## 2. From the import to the call

```igrasp-code-tour
stops:
- path: src/main.ts
  lines: 1-2
  annotation: 'src/main.ts imports `greet` from `./greet`: the greeting is not built here.'
- path: src/main.ts
  lines: 4-7
  annotation: '`Options` has a `name` and an optional `loud` flag.'
- path: src/main.ts
  lines: 9-12
  annotation: '`main()` defaults `loud` to false and upper-cases the message only when asked.'
```

## 3. Find the shout

```igrasp-spot-it
prompt: Click the line of main() that decides whether igrasp-demo shouts.
path: src/main.ts
lines: 9-12
answerLine: 11
explanation: Line 11 of src/main.ts returns `message.toUpperCase()` when `loud` is true, the message otherwise.
```

## 4. What does main() in src/main.ts return when loud is false?

```igrasp-quiz
kind: multipleChoice
choices:
- The message as greet made it
- The message upper-cased
- An empty string
answer: 0
hint: Read the ternary at the end of main() in src/main.ts.
explanation: 'main() returns `loud ? message.toUpperCase() : message`, so with loud false it is the message from greet(name).'
sources:
- path: src/main.ts
  lines: 9-12
```

## 5. Recap

- main() in src/main.ts gets its message from greet(name).
- Options.loud defaults to false in main().
- Line 11 of src/main.ts upper-cases the message only when loud.
