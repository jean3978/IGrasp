// The AI conversations per folder, like `appdata/conversations.rs`: newest first, trimmed to the
// history limit and to 400 items each, ids checked.

import { BackendError } from '../types';
import type { Conversation, ConversationSummary } from '../types';

export const MAX_ITEMS = 400;
export const MAX_TITLE_CHARS = 80;

const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const summaryOf = (c: Conversation): ConversationSummary => ({
  id: c.id,
  title: c.title,
  updatedMs: c.updatedMs,
  model: c.model,
  usage: { ...c.usage },
});

/** `list` with `conversation` added or replaced, trimmed like Rust. */
export function upsert(
  list: Conversation[],
  conversation: Conversation,
  limit: number,
): Conversation[] {
  if (!VALID_ID.test(conversation.id)) {
    throw new BackendError(
      'AppData',
      `App data error: invalid conversation id: ${JSON.stringify(conversation.id)}`,
    );
  }
  const saved = structuredClone(conversation);
  // Code points, like Rust's `chars()`.
  const title = Array.from(saved.title);
  if (title.length > MAX_TITLE_CHARS) saved.title = title.slice(0, MAX_TITLE_CHARS).join('');
  if (saved.items.length > MAX_ITEMS) saved.items = saved.items.slice(-MAX_ITEMS);
  return [...list.filter((c) => c.id !== saved.id), saved]
    .sort((a, b) => b.updatedMs - a.updatedMs)
    .slice(0, Math.max(1, limit));
}
