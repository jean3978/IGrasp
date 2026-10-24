// Rule 2 of the AI integration principles: the frontend never contains provider-specific names
// or wire formats. Only the Rust provider knows how its CLI talks.

import { describe, expect, it } from 'vitest';

// Every frontend source, read at build time by Vite (the generated IPC types are excluded).
const SOURCES = import.meta.glob<string>(
  ['/src/**/*.ts', '/src/**/*.tsx', '!/src/ipc/generated/**'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const SELF = '/src/features/ai/neutrality.test.ts';

/** Tokens of the Claude CLI's `stream-json` protocol and flags. */
const WIRE_FORMAT = [
  /stream[-_]json/,
  /control_request/,
  /control_response/,
  /permission-prompt-tool/,
  /tool_use_id/,
  /content_block_delta/,
];

/** Files that must not even name a provider: UI labels come from the provider's status. */
const PROVIDER_NEUTRAL_FILES = [
  '/src/features/ai/',
  '/src/stores/ai.ts',
  '/src/ipc/types.ts',
  '/src/ipc/tauri.ts',
  '/src/ipc/mock/mockAi.ts',
  '/src/stores/eventBridge.ts',
];

describe('provider neutrality of the frontend', () => {
  it('reads the sources', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(SOURCES['/src/stores/ai.ts']).toContain('useAi');
  });

  it('contains no provider wire format anywhere', () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(SOURCES)) {
      if (file === SELF) continue;
      for (const pattern of WIRE_FORMAT) {
        if (pattern.test(text)) offenders.push(`${file}: ${pattern.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the AI feature, store, IPC and mock free of provider names', () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(SOURCES)) {
      if (file === SELF || !PROVIDER_NEUTRAL_FILES.some((p) => file.startsWith(p))) continue;
      if (/claude|anthropic|codex|gemini|openai/i.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
