// AI chat: the provider's status and capabilities, the conversation, the running operation and
// the permission requests waiting for the user's answer. Everything here is provider-neutral;
// the backend's gateway decides which provider runs (ADR 0015).

import { create } from 'zustand';
import {
  applyEvent,
  finishStreaming,
  noticeItem,
  usageItem,
  userItem,
} from '../features/ai/timeline';
import type { ChatItem } from '../features/ai/timeline';
import { backend } from '../ipc/client';
import { BackendError } from '../ipc/types';
import { useSettings } from './settings';
import { selectActiveTab, useTabs } from './tabs';
import type {
  AiCapabilities,
  AiEventEnvelope,
  AiPermissionKind,
  AiProviderInfo,
  AiProviderStatus,
  AiSizeBucket,
  AiSizeEstimate,
  AiStartRequest,
  ConfirmFrom,
  JsonValue,
  PermissionDecision,
  ProposedEdit,
} from '../ipc/types';

/** What the model is told when the user rejects a tool call. */
export const REJECTION_MESSAGE = 'The user rejected this in IGrasp.';

export interface PendingPermission {
  operationId: number;
  requestId: string;
  tool: string;
  /** What the tool would do (the UI keys on this, never on the tool name). */
  kind: AiPermissionKind;
  description: string | null;
  input: JsonValue;
  proposedEdit: ProposedEdit | null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Null until a provider reports a cost. */
  costUsd: number | null;
}

/** An operation waiting for the user's Start (the estimate reached `settings.ai.confirmFrom`). */
export interface PendingConfirm {
  title: string;
  request: AiStartRequest;
  estimate: AiSizeEstimate;
  documents: { path: string; bytes: number }[];
  images: number;
  model: string;
}

interface AiState {
  open: boolean;
  status: AiProviderStatus | null;
  capabilities: AiCapabilities | null;
  checking: boolean;
  /** The providers the "AI provider" setting offers; null until loaded. */
  providers: AiProviderInfo[] | null;
  /**
   * Model id or alias for the provider; empty for its default. Starts on `settings.ai.model`
   * and is written back there when the user picks one.
   */
  model: string;
  resumeId: string | null;
  /** The running operation, or null. */
  operationId: number | null;
  /** An operation is being started: its events may arrive before its id is known. */
  starting: boolean;
  /** The confirmation card shown before a large operation; nothing runs until Start. */
  pendingConfirm: PendingConfirm | null;
  buffered: AiEventEnvelope[];
  items: ChatItem[];
  permissions: PendingPermission[];
  /** Totals for this conversation. */
  usage: Usage;

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  /** Checks the provider; a check younger than a minute is reused unless `force`. */
  checkStatus: (force?: boolean) => Promise<void>;
  /** Picks the model and remembers it in the settings (debounced). */
  setModel: (model: string) => void;
  loadProviders: () => Promise<void>;
  /** Switches the provider (refused by the backend while an operation runs). */
  setProvider: (id: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  /** Start of the confirmation card: the only way a confirmed operation begins. */
  confirmStart: () => Promise<void>;
  cancelConfirm: () => void;
  respond: (requestId: string, decision: PermissionDecision) => Promise<void>;
  cancel: () => Promise<void>;
  newConversation: () => void;
  onEvent: (envelope: AiEventEnvelope) => void;
}

/** How long the model picker waits before remembering a choice. */
export const MODEL_SAVE_DELAY_MS = 400;
let modelSaveTimer: ReturnType<typeof setTimeout> | null = null;

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: null };

const BUCKET_RANK: Record<AiSizeBucket, number> = { small: 0, medium: 1, large: 2 };

/** Whether an estimate must be confirmed with the card under this setting. */
export function needsConfirmation(bucket: AiSizeBucket, confirmFrom: ConfirmFrom): boolean {
  return confirmFrom !== 'never' && BUCKET_RANK[bucket] >= BUCKET_RANK[confirmFrom];
}

export const selectBusy = (s: AiState) => s.operationId !== null || s.starting;
export const selectUsable = (s: AiState) =>
  s.status !== null && s.status.installed && s.status.loggedIn && s.status.problem === null;
export const selectProviderName = (s: AiState) => s.status?.displayName ?? 'AI';

function errorMessage(err: unknown): string {
  if (err instanceof BackendError || err instanceof Error) return err.message;
  return String(err);
}

/** Calls `ai_start` (the only call that spends tokens) and hands buffered events over. */
async function runStart(request: AiStartRequest): Promise<void> {
  const operationId = await backend.aiStart('chatMessage', request);
  const buffered = useAi.getState().buffered;
  useAi.setState({ operationId, starting: false, buffered: [] });
  // Events of this operation that arrived before its id was known.
  for (const envelope of buffered) {
    if (envelope.operationId === operationId) useAi.getState().onEvent(envelope);
  }
}

export const useAi = create<AiState>()((set, get) => ({
  open: false,
  status: null,
  capabilities: null,
  checking: false,
  providers: null,
  model: '',
  resumeId: null,
  operationId: null,
  starting: false,
  pendingConfirm: null,
  buffered: [],
  items: [],
  permissions: [],
  usage: NO_USAGE,

  setOpen(open) {
    set({ open });
  },
  toggleOpen() {
    set((s) => ({ open: !s.open }));
  },

  async checkStatus(force = false) {
    if (get().checking) return;
    set({ checking: true });
    try {
      const [status, capabilities] = await Promise.all([
        backend.aiStatus(force),
        get().capabilities ? Promise.resolve(get().capabilities) : backend.aiCapabilities(),
      ]);
      // The picker starts on the last model chosen (remembered in the settings).
      const remembered = useSettings.getState().settings.ai.model;
      set((s) => ({
        status,
        capabilities,
        model: s.model || remembered || (capabilities?.models[0]?.id ?? ''),
      }));
    } catch (err) {
      set({
        status: {
          providerId: 'unknown',
          displayName: 'AI',
          installed: false,
          loggedIn: false,
          version: null,
          account: null,
          plan: null,
          problem: errorMessage(err),
          help: null,
        },
      });
    } finally {
      set({ checking: false });
    }
  },

  setModel(model) {
    const next = model.trim();
    set({ model: next });
    // Remembered for the next conversations and the next start (debounced: a custom id is
    // typed character by character).
    if (modelSaveTimer) clearTimeout(modelSaveTimer);
    modelSaveTimer = setTimeout(() => {
      modelSaveTimer = null;
      if (useSettings.getState().settings.ai.model === next) return;
      useSettings
        .getState()
        .update({ ai: { model: next } })
        .catch((err: unknown) => {
          set((s) => ({ items: [...s.items, noticeItem('error', errorMessage(err))] }));
        });
    }, MODEL_SAVE_DELAY_MS);
  },

  async loadProviders() {
    try {
      set({ providers: await backend.aiProviders() });
    } catch (err) {
      set((s) => ({ items: [...s.items, noticeItem('error', errorMessage(err))] }));
    }
  },

  async setProvider(id) {
    const settings = await backend.aiSetProvider(id);
    useSettings.setState({ settings });
    // Another provider: its status and capabilities are checked again when needed.
    if (get().status?.providerId !== id) set({ status: null, capabilities: null, model: '' });
  },

  async send(text) {
    const prompt = text.trim();
    if (!prompt || selectBusy(get()) || get().pendingConfirm) return;
    set((s) => ({ items: [...s.items, userItem(prompt)], starting: true, buffered: [] }));
    const { model, resumeId } = get();
    try {
      // The documents this message would carry (paths and sizes only), then their size.
      const tab = selectActiveTab(useTabs.getState());
      const current = tab && tab.relPath !== null ? tab.relPath : null;
      const documents = await backend.aiContext(current);
      const request: AiStartRequest = {
        prompt,
        contextPaths: documents.map((d) => d.path),
        images: [],
        policy: 'interactive',
        ...(model ? { model } : {}),
        ...(resumeId ? { resumeId } : {}),
      };
      const estimate = await backend.aiEstimate({
        promptBytes: new TextEncoder().encode(prompt).length,
        contextPaths: request.contextPaths,
        images: request.images.length,
      });
      if (needsConfirmation(estimate.bucket, useSettings.getState().settings.ai.confirmFrom)) {
        // Nothing starts until the user presses Start on the card.
        set({
          starting: false,
          pendingConfirm: {
            title: 'Send message',
            request,
            estimate,
            documents: documents.map((d) => ({ path: d.path, bytes: d.bytes })),
            images: request.images.length,
            model,
          },
        });
        return;
      }
      await runStart(request);
    } catch (err) {
      set((s) => ({
        starting: false,
        buffered: [],
        items: [...s.items, noticeItem('error', errorMessage(err))],
      }));
    }
  },

  async confirmStart() {
    const pending = get().pendingConfirm;
    if (!pending || selectBusy(get())) return;
    set({ pendingConfirm: null, starting: true, buffered: [] });
    try {
      await runStart(pending.request);
    } catch (err) {
      set((s) => ({
        starting: false,
        buffered: [],
        items: [...s.items, noticeItem('error', errorMessage(err))],
      }));
    }
  },

  cancelConfirm() {
    if (!get().pendingConfirm) return;
    set((s) => ({
      pendingConfirm: null,
      items: [...s.items, noticeItem('info', 'Cancelled: nothing was sent.')],
    }));
  },

  async respond(requestId, decision) {
    const pending = get().permissions.find((p) => p.requestId === requestId);
    if (!pending) return;
    set((s) => ({ permissions: s.permissions.filter((p) => p.requestId !== requestId) }));
    try {
      await backend.aiRespondPermission(pending.operationId, requestId, decision);
    } catch (err) {
      set((s) => ({ items: [...s.items, noticeItem('error', errorMessage(err))] }));
    }
  },

  async cancel() {
    const { operationId } = get();
    if (operationId === null) return;
    try {
      await backend.aiCancel(operationId);
    } catch (err) {
      set((s) => ({ items: [...s.items, noticeItem('error', errorMessage(err))] }));
    }
  },

  newConversation() {
    const { operationId } = get();
    // Forget the operation first so its final event is ignored as stale.
    set({
      items: [],
      resumeId: null,
      permissions: [],
      operationId: null,
      starting: false,
      pendingConfirm: null,
      buffered: [],
      usage: NO_USAGE,
    });
    if (operationId !== null) void backend.aiCancel(operationId);
  },

  onEvent(envelope) {
    const s = get();
    if (envelope.operationId !== s.operationId) {
      if (s.starting) set({ buffered: [...s.buffered, envelope] });
      return;
    }
    const { event } = envelope;
    switch (event.type) {
      case 'session':
        set({ resumeId: event.resumeId });
        return;
      case 'permissionRequest':
        if (s.permissions.some((p) => p.requestId === event.requestId)) return;
        set({
          permissions: [
            ...s.permissions,
            {
              operationId: envelope.operationId,
              requestId: event.requestId,
              tool: event.tool,
              kind: event.kind,
              description: event.description,
              input: event.input,
              proposedEdit: event.proposedEdit,
            },
          ],
        });
        return;
      case 'usage':
        set({
          items: [...s.items, usageItem(event)],
          usage: {
            inputTokens: s.usage.inputTokens + event.inputTokens,
            outputTokens: s.usage.outputTokens + event.outputTokens,
            costUsd:
              event.costUsd === null ? s.usage.costUsd : (s.usage.costUsd ?? 0) + event.costUsd,
          },
        });
        return;
      case 'done': {
        let items = finishStreaming(s.items);
        if (event.outcome === 'Cancelled') items = [...items, noticeItem('info', 'Stopped.')];
        else if (event.outcome === 'Failed') {
          const detail = event.detail ? `\n${event.detail}` : '';
          items = [
            ...items,
            noticeItem('error', `${selectProviderName(s)} stopped unexpectedly.${detail}`),
          ];
        }
        set({
          items,
          operationId: null,
          permissions: s.permissions.filter((p) => p.operationId !== envelope.operationId),
        });
        return;
      }
      default:
        set({ items: applyEvent(s.items, event) });
    }
  },
}));
