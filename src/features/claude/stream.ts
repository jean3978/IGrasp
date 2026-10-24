// The subset of the Claude CLI `stream-json` protocol the chat understands, and a pure reducer
// turning the stream of messages into chat items. The CLI's messages are forwarded by Rust
// untouched, so everything here is defensive: unknown shapes are ignored, never thrown on.

import type { JsonValue } from '../../ipc/generated/serde_json/JsonValue';

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id: string;
      name: string;
      input: JsonValue;
      /** One line describing the call, e.g. `Edit docs/plan.md`. */
      summary: string;
      result?: string;
      isError?: boolean;
    }
  | { kind: 'result'; id: string; isError: boolean; text: string }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string };

type Rec = Record<string, JsonValue | undefined>;

function rec(value: JsonValue | undefined): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

function str(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

/** The session id announced by the first `system/init` message, if `message` is one. */
export function sessionIdOf(message: JsonValue): string | null {
  const m = rec(message);
  if (!m || m.type !== 'system' || m.subtype !== 'init') return null;
  return str(m.session_id);
}

/** Cost and duration of a finished turn, if `message` is its `result`. */
export function resultMetaOf(message: JsonValue): { costUsd: number; durationMs: number } | null {
  const m = rec(message);
  if (!m || m.type !== 'result') return null;
  return {
    costUsd: typeof m.total_cost_usd === 'number' ? m.total_cost_usd : 0,
    durationMs: typeof m.duration_ms === 'number' ? m.duration_ms : 0,
  };
}

/** The last path segment of a file path with `/` or `\` separators. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** One line describing a tool call. */
export function summarizeTool(name: string, input: JsonValue): string {
  const i = rec(input);
  const file = str(i?.file_path) ?? str(i?.path) ?? str(i?.notebook_path);
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return file ? `${name} ${baseName(file)}` : name;
    case 'Bash':
    case 'PowerShell': {
      const command = str(i?.command);
      return command ? `${name}: ${command.split('\n')[0] ?? ''}` : name;
    }
    case 'Glob':
    case 'Grep': {
      const pattern = str(i?.pattern);
      return pattern ? `${name} ${pattern}` : name;
    }
    default:
      return name;
  }
}

/** Text of a tool result (`content` is a string or a list of text blocks). */
function resultText(content: JsonValue | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => str(rec(block)?.text) ?? '')
    .filter(Boolean)
    .join('\n');
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${String(++counter)}`;

export function userItem(text: string): ChatItem {
  return { kind: 'user', id: nextId('user'), text };
}

export function noticeItem(level: 'info' | 'error', text: string): ChatItem {
  return { kind: 'notice', id: nextId('notice'), level, text };
}

function lastStreaming(items: ChatItem[]): number {
  const last = items[items.length - 1];
  return last?.kind === 'assistant' && last.streaming ? items.length - 1 : -1;
}

/** Marks every streaming item as finished (when a turn ends without its final message). */
export function finishStreaming(items: ChatItem[]): ChatItem[] {
  return items.map((item) =>
    item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
  );
}

/**
 * Applies one `stream-json` message to the chat items and returns the new list (the same array
 * when nothing changed).
 */
export function applyStreamMessage(items: ChatItem[], message: JsonValue): ChatItem[] {
  const m = rec(message);
  if (!m) return items;
  switch (m.type) {
    case 'stream_event':
      return applyStreamEvent(items, rec(m.event));
    case 'assistant':
      return applyAssistant(items, rec(m.message));
    case 'user':
      return applyToolResults(items, rec(m.message));
    case 'result': {
      if (m.is_error !== true) return items;
      const text = str(m.result) ?? 'Claude stopped with an error.';
      return [...items, { kind: 'result', id: nextId('result'), isError: true, text }];
    }
    default:
      return items;
  }
}

/** Partial messages (`--include-partial-messages`): only text deltas are shown live. */
function applyStreamEvent(items: ChatItem[], event: Rec | null): ChatItem[] {
  if (!event) return items;
  if (event.type === 'content_block_start' && rec(event.content_block)?.type === 'text') {
    const text = str(rec(event.content_block)?.text) ?? '';
    return [...items, { kind: 'assistant', id: nextId('assistant'), text, streaming: true }];
  }
  if (event.type === 'content_block_delta') {
    const delta = rec(event.delta);
    if (delta?.type !== 'text_delta') return items;
    const text = str(delta.text) ?? '';
    if (!text) return items;
    const at = lastStreaming(items);
    if (at < 0) {
      return [...items, { kind: 'assistant', id: nextId('assistant'), text, streaming: true }];
    }
    const current = items[at];
    if (current?.kind !== 'assistant') return items;
    const next = items.slice();
    next[at] = { ...current, text: current.text + text };
    return next;
  }
  return items;
}

/** A complete assistant message: its text replaces the streamed text; tool calls are listed. */
function applyAssistant(items: ChatItem[], message: Rec | null): ChatItem[] {
  const content = message?.content;
  if (!Array.isArray(content)) return items;
  let next = items;
  for (const block of content) {
    const b = rec(block);
    if (!b) continue;
    if (b.type === 'text') {
      const text = str(b.text) ?? '';
      const at = lastStreaming(next);
      if (at >= 0) {
        const current = next[at];
        if (current?.kind === 'assistant') {
          next = next.slice();
          next[at] = { ...current, text, streaming: false };
        }
      } else if (text) {
        next = [...next, { kind: 'assistant', id: nextId('assistant'), text, streaming: false }];
      }
    } else if (b.type === 'tool_use') {
      const name = str(b.name) ?? 'tool';
      const input = b.input ?? null;
      next = [
        ...next,
        {
          kind: 'tool',
          id: str(b.id) ?? nextId('tool'),
          name,
          input,
          summary: summarizeTool(name, input),
        },
      ];
    }
  }
  return next;
}

/** `user` messages carry the tool results the CLI fed back to the model. */
function applyToolResults(items: ChatItem[], message: Rec | null): ChatItem[] {
  const content = message?.content;
  if (!Array.isArray(content)) return items;
  let next = items;
  for (const block of content) {
    const b = rec(block);
    if (b?.type !== 'tool_result') continue;
    const toolUseId = str(b.tool_use_id);
    const at = next.findIndex((item) => item.kind === 'tool' && item.id === toolUseId);
    const current = next[at];
    if (current?.kind !== 'tool') continue;
    next = next.slice();
    next[at] = { ...current, result: resultText(b.content), isError: b.is_error === true };
  }
  return next;
}
