import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../../ipc/types';
import {
  applyStreamMessage,
  finishStreaming,
  resultMetaOf,
  sessionIdOf,
  summarizeTool,
} from './stream';
import type { ChatItem } from './stream';

// Shapes recorded from `claude 2.1.310 -p --output-format stream-json --input-format stream-json
// --verbose --include-partial-messages --permission-prompt-tool stdio`.
const INIT: JsonValue = {
  type: 'system',
  subtype: 'init',
  cwd: 'C:\\p',
  session_id: '3c2e6d49-bc84-4a2c-a93e-67d7cd8d7828',
  tools: ['Read', 'Edit'],
  model: 'claude-haiku-5-5',
};
const TOOL_USE: JsonValue = {
  type: 'assistant',
  message: {
    model: 'claude-haiku-5-5',
    id: 'msg_1',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Edit',
        input: {
          replace_all: false,
          file_path: 'C:\\p\\notes.md',
          old_string: 'Hello world.',
          new_string: 'Hello IGrasp.',
        },
      },
    ],
  },
  session_id: '3c2e6d49',
};
const TOOL_RESULT: JsonValue = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        content: 'The user rejected this edit in IGrasp.',
        is_error: true,
        tool_use_id: 'toolu_1',
      },
    ],
  },
  parent_tool_use_id: null,
  session_id: '3c2e6d49',
};
const THINKING: JsonValue = {
  type: 'assistant',
  message: { id: 'msg_2', role: 'assistant', content: [{ type: 'thinking', thinking: '' }] },
};
const TEXT: JsonValue = {
  type: 'assistant',
  message: {
    id: 'msg_2',
    role: 'assistant',
    content: [{ type: 'text', text: 'The edit was rejected, so the file is unchanged.' }],
  },
};
const RESULT_OK: JsonValue = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 5000,
  duration_api_ms: 4217,
  result: 'The edit was rejected, so the file is unchanged.',
  session_id: '3c2e6d49',
  total_cost_usd: 0.00312621,
};
const RESULT_NOT_LOGGED_IN: JsonValue = {
  type: 'result',
  subtype: 'success',
  is_error: true,
  duration_ms: 0,
  result: 'Not logged in · Please run /login',
  total_cost_usd: 0,
  terminal_reason: 'api_error',
};

const delta = (text: string): JsonValue => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
});

function reduce(messages: JsonValue[], start: ChatItem[] = []): ChatItem[] {
  return messages.reduce(applyStreamMessage, start);
}

describe('applyStreamMessage', () => {
  it('lists a tool call, attaches its result and shows the final text', () => {
    const items = reduce([INIT, TOOL_USE, TOOL_RESULT, THINKING, TEXT, RESULT_OK]);
    expect(items.map((i) => i.kind)).toEqual(['tool', 'assistant']);
    const tool = items[0];
    expect(tool?.kind === 'tool' && tool.summary).toBe('Edit notes.md');
    expect(tool?.kind === 'tool' && tool.result).toBe('The user rejected this edit in IGrasp.');
    expect(tool?.kind === 'tool' && tool.isError).toBe(true);
    const text = items[1];
    expect(text?.kind === 'assistant' && text.text).toContain('rejected');
    expect(text?.kind === 'assistant' && text.streaming).toBe(false);
  });

  it('streams text deltas into one item that the complete message then replaces', () => {
    let items = reduce([
      {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      },
      delta('The edit '),
      delta('was rejected'),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind === 'assistant' && items[0].text).toBe('The edit was rejected');
    expect(items[0]?.kind === 'assistant' && items[0].streaming).toBe(true);
    items = reduce([TEXT], items);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind === 'assistant' && items[0].text).toBe(
      'The edit was rejected, so the file is unchanged.',
    );
    expect(items[0]?.kind === 'assistant' && items[0].streaming).toBe(false);
  });

  it('starts a streaming item on a delta without a block start', () => {
    const items = reduce([delta('Hi')]);
    expect(items[0]?.kind === 'assistant' && items[0].streaming).toBe(true);
    expect(
      finishStreaming(items)[0]?.kind === 'assistant' && finishStreaming(items)[0],
    ).toMatchObject({ streaming: false, text: 'Hi' });
  });

  it('shows an error result (e.g. not logged in) and ignores noise', () => {
    const items = reduce([
      INIT,
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } },
      { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50 },
      RESULT_NOT_LOGGED_IN,
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'result',
        isError: true,
        text: 'Not logged in · Please run /login',
      }),
    ]);
  });

  it('returns the same array when nothing changes and survives odd shapes', () => {
    const items: ChatItem[] = [];
    expect(applyStreamMessage(items, INIT)).toBe(items);
    expect(applyStreamMessage(items, null)).toBe(items);
    expect(applyStreamMessage(items, 'text')).toBe(items);
    expect(applyStreamMessage(items, { type: 'assistant', message: 'oops' })).toBe(items);
    expect(
      applyStreamMessage(items, { type: 'user', message: { content: [{ type: 'tool_result' }] } }),
    ).toBe(items);
  });
});

describe('helpers', () => {
  it('extracts the session id and the result meta', () => {
    expect(sessionIdOf(INIT)).toBe('3c2e6d49-bc84-4a2c-a93e-67d7cd8d7828');
    expect(sessionIdOf(TEXT)).toBeNull();
    expect(resultMetaOf(RESULT_OK)).toEqual({ costUsd: 0.00312621, durationMs: 5000 });
    expect(resultMetaOf(INIT)).toBeNull();
  });

  it('summarizes tool calls in one line', () => {
    expect(summarizeTool('Edit', { file_path: '/a/b/doc.md' })).toBe('Edit doc.md');
    expect(summarizeTool('Read', { file_path: 'C:\\a\\b.md' })).toBe('Read b.md');
    expect(summarizeTool('Bash', { command: 'git status\ngit log' })).toBe('Bash: git status');
    expect(summarizeTool('Grep', { pattern: 'TODO' })).toBe('Grep TODO');
    expect(summarizeTool('WebSearch', { query: 'x' })).toBe('WebSearch');
    expect(summarizeTool('Edit', null)).toBe('Edit');
  });
});
