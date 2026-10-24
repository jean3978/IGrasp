// Turns the provider-neutral event stream of an operation into the items the chat shows.
// Pure: the same array comes back when an event changes nothing visible.

import type { AiEvent, JsonValue } from '../../ipc/types';

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
  | { kind: 'error'; id: string; text: string }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string };

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
    case 'session':
    case 'permissionRequest':
    case 'permissionDecided':
    case 'usage':
    case 'done':
      return items;
  }
}
