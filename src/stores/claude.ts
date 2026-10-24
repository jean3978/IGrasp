// Claude chat (proof of concept): the CLI status, the conversation, the running turn and the
// permission requests waiting for the user's answer. One turn runs at a time; the CLI session id
// announced by the first message is reused with `--resume` for the next turns.

import { create } from 'zustand';
import {
  applyStreamMessage,
  finishStreaming,
  noticeItem,
  resultMetaOf,
  sessionIdOf,
  userItem,
} from '../features/claude/stream';
import type { ChatItem } from '../features/claude/stream';
import { backend } from '../ipc/client';
import { BackendError } from '../ipc/types';
import type {
  ClaudeMessageEvent,
  ClaudePermissionDecision,
  ClaudePermissionEvent,
  ClaudeStatus,
  ClaudeTurnEndEvent,
  JsonValue,
} from '../ipc/types';

export const MODEL_PRESETS = ['sonnet', 'opus', 'haiku'] as const;
export const DEFAULT_MODEL = 'sonnet';
/** What the model is told when the user rejects a tool call. */
export const REJECTION_MESSAGE = 'The user rejected this in IGrasp.';

export interface PendingPermission {
  turnId: number;
  requestId: string;
  toolName: string;
  input: JsonValue;
  description: string | null;
}

type TurnEvent =
  | { type: 'message'; event: ClaudeMessageEvent }
  | { type: 'permission'; event: ClaudePermissionEvent }
  | { type: 'end'; event: ClaudeTurnEndEvent };

interface ClaudeState {
  open: boolean;
  status: ClaudeStatus | null;
  checking: boolean;
  /** CLI alias or model id; empty for the CLI's default. Not persisted yet. */
  model: string;
  sessionId: string | null;
  /** The running turn, or null. */
  turnId: number | null;
  /** A turn is being started: its events may arrive before its id is known. */
  starting: boolean;
  buffered: TurnEvent[];
  items: ChatItem[];
  permissions: PendingPermission[];
  /** Total cost reported by the CLI for this conversation, in USD. */
  costUsd: number;

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  checkStatus: () => Promise<void>;
  setModel: (model: string) => void;
  send: (text: string) => Promise<void>;
  respond: (requestId: string, decision: ClaudePermissionDecision) => Promise<void>;
  cancel: () => Promise<void>;
  newConversation: () => void;
  onMessage: (event: ClaudeMessageEvent) => void;
  onPermission: (event: ClaudePermissionEvent) => void;
  onTurnEnd: (event: ClaudeTurnEndEvent) => void;
}

export const selectBusy = (s: ClaudeState) => s.turnId !== null || s.starting;
export const selectUsable = (s: ClaudeState) =>
  s.status !== null && s.status.installed && s.status.loggedIn && s.status.problem === null;

function errorMessage(err: unknown): string {
  if (err instanceof BackendError || err instanceof Error) return err.message;
  return String(err);
}

function crashNotice(event: ClaudeTurnEndEvent): string {
  const code = event.exitCode === null ? '' : ` (exit code ${String(event.exitCode)})`;
  const stderr = event.stderr ? `\n${event.stderr}` : '';
  return `The Claude CLI stopped unexpectedly${code}.${stderr}`;
}

export const useClaude = create<ClaudeState>()((set, get) => ({
  open: false,
  status: null,
  checking: false,
  model: DEFAULT_MODEL,
  sessionId: null,
  turnId: null,
  starting: false,
  buffered: [],
  items: [],
  permissions: [],
  costUsd: 0,

  setOpen(open) {
    set({ open });
  },
  toggleOpen() {
    set((s) => ({ open: !s.open }));
  },

  async checkStatus() {
    if (get().checking) return;
    set({ checking: true });
    try {
      set({ status: await backend.claudeStatus() });
    } catch (err) {
      set({
        status: {
          installed: false,
          path: null,
          version: null,
          loggedIn: false,
          email: null,
          subscription: null,
          problem: errorMessage(err),
        },
      });
    } finally {
      set({ checking: false });
    }
  },

  setModel(model) {
    set({ model: model.trim() });
  },

  async send(text) {
    const prompt = text.trim();
    if (!prompt || selectBusy(get())) return;
    set((s) => ({ items: [...s.items, userItem(prompt)], starting: true, buffered: [] }));
    const { model, sessionId } = get();
    try {
      const turnId = await backend.claudeStartTurn({
        prompt,
        ...(model ? { model } : {}),
        ...(sessionId ? { resumeSessionId: sessionId } : {}),
      });
      const buffered = get().buffered;
      set({ turnId, starting: false, buffered: [] });
      // Events of this turn that arrived before its id was known.
      for (const b of buffered) {
        if (b.event.turnId !== turnId) continue;
        if (b.type === 'message') get().onMessage(b.event);
        else if (b.type === 'permission') get().onPermission(b.event);
        else get().onTurnEnd(b.event);
      }
    } catch (err) {
      set((s) => ({
        starting: false,
        buffered: [],
        items: [...s.items, noticeItem('error', errorMessage(err))],
      }));
    }
  },

  async respond(requestId, decision) {
    const pending = get().permissions.find((p) => p.requestId === requestId);
    if (!pending) return;
    set((s) => ({ permissions: s.permissions.filter((p) => p.requestId !== requestId) }));
    try {
      await backend.claudeRespondPermission(pending.turnId, requestId, decision);
    } catch (err) {
      set((s) => ({ items: [...s.items, noticeItem('error', errorMessage(err))] }));
    }
  },

  async cancel() {
    const { turnId } = get();
    if (turnId === null) return;
    try {
      await backend.claudeCancel(turnId);
    } catch (err) {
      set((s) => ({ items: [...s.items, noticeItem('error', errorMessage(err))] }));
    }
  },

  newConversation() {
    const { turnId } = get();
    // Forget the turn first so its final event is ignored as stale.
    set({
      items: [],
      sessionId: null,
      permissions: [],
      turnId: null,
      starting: false,
      buffered: [],
      costUsd: 0,
    });
    if (turnId !== null) void backend.claudeCancel(turnId);
  },

  onMessage(event) {
    const s = get();
    if (event.turnId !== s.turnId) {
      if (s.starting) set({ buffered: [...s.buffered, { type: 'message', event }] });
      return;
    }
    const sessionId = sessionIdOf(event.message);
    const meta = resultMetaOf(event.message);
    set({
      items: applyStreamMessage(s.items, event.message),
      ...(sessionId ? { sessionId } : {}),
      ...(meta ? { costUsd: s.costUsd + meta.costUsd } : {}),
    });
  },

  onPermission(event) {
    const s = get();
    if (event.turnId !== s.turnId) {
      if (s.starting) set({ buffered: [...s.buffered, { type: 'permission', event }] });
      return;
    }
    if (s.permissions.some((p) => p.requestId === event.requestId)) return;
    set({
      permissions: [
        ...s.permissions,
        {
          turnId: event.turnId,
          requestId: event.requestId,
          toolName: event.toolName,
          input: event.input,
          description: event.description,
        },
      ],
    });
  },

  onTurnEnd(event) {
    const s = get();
    if (event.turnId !== s.turnId) {
      if (s.starting) set({ buffered: [...s.buffered, { type: 'end', event }] });
      return;
    }
    let items = finishStreaming(s.items);
    if (event.outcome === 'Cancelled') items = [...items, noticeItem('info', 'Stopped.')];
    else if (event.outcome === 'Crashed')
      items = [...items, noticeItem('error', crashNotice(event))];
    set({
      items,
      turnId: null,
      permissions: s.permissions.filter((p) => p.turnId !== event.turnId),
    });
  },
}));
