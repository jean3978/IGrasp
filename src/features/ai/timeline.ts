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
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string }
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

export function noticeItem(level: 'info' | 'error', text: string): ChatItem {
  return { kind: 'notice', id: nextId('notice'), level, text };
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
    case 'session':
    case 'permissionRequest':
    case 'usage':
    case 'done':
      return items;
  }
}
