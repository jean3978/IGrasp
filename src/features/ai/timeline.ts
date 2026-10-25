// Turns the provider-neutral event stream of an operation into the items the chat shows.
// Pure: the same array comes back when an event changes nothing visible.

import type { AiEvent, AiPermissionKind, JsonValue } from '../../ipc/types';

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id: string;
      tool: string;
      summary: string;
      input: JsonValue;
      result?: string;
      isError?: boolean;
    }
  | {
      /** A permission answered without asking (settings, read-only policy). */
      kind: 'decision';
      id: string;
      tool: string;
      permissionKind: AiPermissionKind;
      description: string | null;
      allowed: boolean;
      reason: string;
    }
  | { kind: 'error'; id: string; text: string }
  | {
      /** A conversation the provider could not continue; offers to start again from `prompt`. */
      kind: 'resumeFailed';
      id: string;
      prompt: string;
    }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string }
  | {
      /** The part of a document the message is about (a text selection or a region). */
      kind: 'capture';
      id: string;
      sourcePath: string;
      firstLine: number;
      lastLine: number;
      text: string;
      /** The highlighted text, for a text selection. */
      selection?: string;
    }
  | {
      /** What the provider reported for an operation, shown under its answer. */
      kind: 'usage';
      id: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number | null;
      durationMs: number;
    };

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${String(++counter)}`;

export function userItem(text: string): ChatItem {
  return { kind: 'user', id: nextId('user'), text };
}

export function resumeFailedItem(prompt: string): ChatItem {
  return { kind: 'resumeFailed', id: nextId('resume'), prompt };
}

/** An answer given without asking the user (settings, read-only policy, a conversation rule). */
export function decisionItem(decision: {
  tool: string;
  permissionKind: AiPermissionKind;
  description: string | null;
  allowed: boolean;
  reason: string;
}): ChatItem {
  return { kind: 'decision', id: nextId('decision'), ...decision };
}

export function noticeItem(level: 'info' | 'error', text: string): ChatItem {
  return { kind: 'notice', id: nextId('notice'), level, text };
}

/** The selection the message is about, shown after the user's message. */
export function captureItem(capture: {
  sourcePath: string;
  firstLine: number;
  lastLine: number;
  text: string;
  selection?: string | undefined;
}): ChatItem {
  const { selection, ...rest } = capture;
  return { kind: 'capture', id: nextId('capture'), ...rest, ...(selection ? { selection } : {}) };
}

/** "docs/a.md lines 40–58" (or "line 40"). */
export function captureLabel(c: { sourcePath: string; firstLine: number; lastLine: number }) {
  const lines =
    c.firstLine === c.lastLine
      ? `line ${String(c.firstLine)}`
      : `lines ${String(c.firstLine)}–${String(c.lastLine)}`;
  return `${c.sourcePath} ${lines}`;
}

/** The usage line under an operation's answer. */
export function usageItem(usage: {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  durationMs: number;
}): ChatItem {
  return { kind: 'usage', id: nextId('usage'), ...usage };
}

/** The transcript line of an automatic decision: `Allowed by your settings: Edit notes.md`. */
export function decisionText(item: {
  tool: string;
  description: string | null;
  reason: string;
}): string {
  const reason = item.reason.charAt(0).toUpperCase() + item.reason.slice(1);
  const what = item.description ? `${item.tool} ${item.description}` : item.tool;
  return `${reason}: ${what}`;
}

function lastStreaming(items: ChatItem[]): number {
  const last = items[items.length - 1];
  return last?.kind === 'assistant' && last.streaming ? items.length - 1 : -1;
}

/** Marks every streaming item as finished (when an operation ends without its final text). */
export function finishStreaming(items: ChatItem[]): ChatItem[] {
  if (lastStreaming(items) < 0) return items;
  return items.map((item) =>
    item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
  );
}

export function applyEvent(items: ChatItem[], event: AiEvent): ChatItem[] {
  switch (event.type) {
    case 'textDelta': {
      if (!event.text) return items;
      const at = lastStreaming(items);
      if (at < 0) {
        return [
          ...items,
          { kind: 'assistant', id: nextId('assistant'), text: event.text, streaming: true },
        ];
      }
      const current = items[at];
      if (current?.kind !== 'assistant') return items;
      const next = items.slice();
      next[at] = { ...current, text: current.text + event.text };
      return next;
    }
    case 'text': {
      const at = lastStreaming(items);
      if (at >= 0) {
        const current = items[at];
        if (current?.kind !== 'assistant') return items;
        const next = items.slice();
        next[at] = { ...current, text: event.text, streaming: false };
        return next;
      }
      if (!event.text) return items;
      return [
        ...items,
        { kind: 'assistant', id: nextId('assistant'), text: event.text, streaming: false },
      ];
    }
    case 'toolUse':
      return [
        ...items,
        {
          kind: 'tool',
          id: event.toolId || nextId('tool'),
          tool: event.tool,
          summary: event.summary,
          input: event.input,
        },
      ];
    case 'toolResult': {
      const at = items.findIndex((item) => item.kind === 'tool' && item.id === event.toolId);
      const current = items[at];
      if (current?.kind !== 'tool') return items;
      const next = items.slice();
      next[at] = { ...current, result: event.content, isError: event.isError };
      return next;
    }
    case 'error':
      return [...items, { kind: 'error', id: nextId('error'), text: event.message }];
    case 'permissionDecided':
      return [
        ...items,
        {
          kind: 'decision',
          id: nextId('decision'),
          tool: event.tool,
          permissionKind: event.kind,
          description: event.description,
          allowed: event.allowed,
          reason: event.reason,
        },
      ];
    // structuredOutput, attempt and stage belong to generations; the chat never asks for them.
    case 'session':
    case 'permissionRequest':
    case 'usage':
    case 'done':
    case 'structuredOutput':
    case 'stage':
    case 'attempt':
      return items;
  }
}

/** Characters of a tool result kept in the history (the full result was shown live). */
export const STORED_RESULT_CHARS = 2048;

/**
 * The items as the history keeps them: finished, tool calls as summaries (no input, the result
 * cut to its first 2 KB), offers that only made sense live turned into notices.
 */
export function toStoredItems(items: ChatItem[]): JsonValue[] {
  return items.map((item): JsonValue => {
    switch (item.kind) {
      case 'assistant':
        return { ...item, streaming: false };
      case 'tool': {
        const { result, isError, ...rest } = item;
        const stored: { [key: string]: JsonValue } = { ...rest, input: null };
        if (result !== undefined) {
          stored.result =
            result.length > STORED_RESULT_CHARS
              ? `${result.slice(0, STORED_RESULT_CHARS)}…`
              : result;
        }
        if (isError !== undefined) stored.isError = isError;
        return stored;
      }
      case 'resumeFailed':
        return {
          kind: 'notice',
          id: item.id,
          level: 'error',
          text: 'This conversation could not be continued.',
        };
      default:
        return item;
    }
  });
}

type JsonRecord = { [key: string]: JsonValue };
const isRecord = (v: JsonValue): v is JsonRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: JsonValue | undefined): v is string => typeof v === 'string';
const num = (v: JsonValue | undefined): v is number => typeof v === 'number';
const PERMISSION_KINDS: readonly string[] = [
  'markdownEdit',
  'fileEdit',
  'command',
  'web',
  'other',
] satisfies AiPermissionKind[];

/** One saved item, with a fresh id; null when unreadable. */
function fromStored(v: JsonRecord): ChatItem | null {
  const { kind } = v;
  switch (kind) {
    case 'user':
    case 'error':
      return str(v.text) ? { kind, id: nextId(kind), text: v.text } : null;
    case 'assistant':
      return str(v.text) ? { kind, id: nextId(kind), text: v.text, streaming: false } : null;
    case 'notice':
      return str(v.text)
        ? { kind, id: nextId(kind), level: v.level === 'error' ? 'error' : 'info', text: v.text }
        : null;
    case 'tool': {
      if (!str(v.tool) || !str(v.summary)) return null;
      const item: ChatItem = {
        kind,
        id: nextId(kind),
        tool: v.tool,
        summary: v.summary,
        input: v.input ?? null,
      };
      if (str(v.result)) item.result = v.result;
      if (typeof v.isError === 'boolean') item.isError = v.isError;
      return item;
    }
    case 'decision': {
      const permissionKind = v.permissionKind;
      if (!str(v.tool) || !str(v.reason) || !str(permissionKind)) return null;
      if (!PERMISSION_KINDS.includes(permissionKind)) return null;
      return {
        kind,
        id: nextId(kind),
        tool: v.tool,
        permissionKind: permissionKind as AiPermissionKind,
        description: str(v.description) ? v.description : null,
        allowed: v.allowed === true,
        reason: v.reason,
      };
    }
    case 'capture':
      return str(v.sourcePath) && num(v.firstLine) && num(v.lastLine) && str(v.text)
        ? {
            kind,
            id: nextId(kind),
            sourcePath: v.sourcePath,
            firstLine: v.firstLine,
            lastLine: v.lastLine,
            text: v.text,
            ...(str(v.selection) ? { selection: v.selection } : {}),
          }
        : null;
    case 'usage':
      return num(v.inputTokens) && num(v.outputTokens)
        ? {
            kind,
            id: nextId(kind),
            inputTokens: v.inputTokens,
            outputTokens: v.outputTokens,
            costUsd: num(v.costUsd) ? v.costUsd : null,
            durationMs: num(v.durationMs) ? v.durationMs : 0,
          }
        : null;
    default:
      return null;
  }
}

/** The items of a saved conversation, with fresh ids; anything unreadable is left out. */
export function fromStoredItems(values: JsonValue[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const v of values) {
    const item = isRecord(v) ? fromStored(v) : null;
    if (item) out.push(item);
  }
  return out;
}
