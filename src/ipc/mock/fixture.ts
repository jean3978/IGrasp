// A small fake project served by the mock backend. It exercises the tree rules (ignored folders,
// dotfiles, folders without markdown, both extensions) and the preview features.

export const FIXTURE_ROOT = '/home/demo/igrasp-demo';
export const FIXTURE_NAME = 'igrasp-demo';

const README = `# IGrasp demo project

Welcome to the **demo project** served by the mock backend. It has ~~no~~ some _markdown_.

> [!NOTE]
> This folder only exists in memory.

## Features

- [x] Tables
- [x] Task lists
- [ ] World domination

| Feature | Status |
|:--|:-:|
| Tree | ✅ |
| Preview | ✅ |

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

Inline math $e^{i\\pi} + 1 = 0$ and a footnote[^1].

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

See the [architecture](docs/architecture.md) and [getting started](docs/guide/getting-started.md#install).

The app starts in [the entry point](src/main.ts#L9-L12), built with the [Makefile](Makefile).

[^1]: Footnotes work too.
`;

const ARCHITECTURE = `# Architecture

\`\`\`mermaid
flowchart LR
  UI[React UI] -->|invoke| Rust[Rust backend]
  Rust -->|events| UI
  Rust --> FS[(Folder)]
\`\`\`

## Components

The backend owns the file system; the frontend renders.

Start with [getting started](guide/getting-started.md), browse the [decisions](decisions/), or read
the [old design](old-design.md).
`;

const GETTING_STARTED = `---
title: Getting started
tags: [guide, setup]
owner: docs-team
---

# Getting started

## Install

Run \`npm install\`.

![Diagram](../images/diagram.svg)

> [!WARNING]
> Remote images must use https.

Back to the [features](../../README.md#features). See also the [deep dive](advanced/deep-dive.markdown#internals)
and the [Architecture](../Architecture.md).
`;

const MAIN_TS = `// Entry point of the demo app.
import { greet } from './greet';

interface Options {
  name: string;
  loud?: boolean;
}

export function main({ name, loud = false }: Options): string {
  const message = greet(name);
  return loud ? message.toUpperCase() : message;
}

console.log(main({ name: 'IGrasp' }));
`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago each fixture file was "modified", so Recent changes has something to show. */
const AGES: Record<string, number> = {
  'README.md': 2 * HOUR,
  'CHANGELOG.md': DAY + 3 * HOUR,
  'docs/architecture.md': 3 * DAY,
  'docs/decisions/0001-use-git-cli.md': 12 * DAY,
  'docs/guide/getting-started.md': 25 * MINUTE,
  'docs/guide/advanced/deep-dive.markdown': 40 * DAY,
  'notes/TODO.MD': 5 * DAY,
};

/** Modification times of the fixture files relative to `now` (others default to 0). */
export function fixtureMtimes(now: number): Map<string, number> {
  return new Map(Object.entries(AGES).map(([rel, age]) => [rel, now - age]));
}

export const FIXTURE_FILES: Record<string, string> = {
  'README.md': README,
  'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n- Everything.\n',
  // Instruction files of the mock provider (its `contextFileNames`), sent with every message.
  'AGENTS.md': '# Agent rules\n\nKeep answers short and cite the files you read.\n',
  'docs/AGENTS.md': '# Docs rules\n\nWrite for developers; one feature page per area.\n',
  'docs/architecture.md': ARCHITECTURE,
  'docs/decisions/0001-use-git-cli.md':
    '# 0001 — Use the git CLI\n\nWe run `git` as a subprocess.\n',
  'docs/guide/getting-started.md': GETTING_STARTED,
  'docs/guide/advanced/deep-dive.markdown': '# Deep dive\n\nThe `.markdown` extension works too.\n',
  'docs/images/diagram.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#6d4de0"/></svg>',
  'notes/TODO.MD':
    '# TODO\n\nUpper-case extensions count as markdown.\n\n- Revisit the [CLI decision](../docs/decisions/0001-use-git-cli.md).\n',
  '.github/CONTRIBUTING.md': '# Contributing\n\nA dotfolder, hidden unless dotfiles are shown.\n',
  'build/output.md': '# Build output\n\nIgnored by .gitignore.\n',
  'node_modules/some-pkg/README.md': '# some-pkg\n\nAlways skipped.\n',
  'src/main.ts': MAIN_TS,
  Makefile: 'build:\n\tnpm run build\n\ntest:\n\tnpm test\n',
  'scripts/deploy.sh': '#!/bin/sh\necho "deploying"\n',
  'assets/logo.bin': 'BIN\u0000\u0001\u0002\u0003',
  'logs/huge.log': 'see FIXTURE_SIZES\n',
  '.gitignore': 'build/\n',
};

/** Files whose size on the fake disk differs from their content (too big to keep in memory). */
export const FIXTURE_SIZES: Record<string, number> = {
  'logs/huge.log': 6 * 1024 * 1024,
};
