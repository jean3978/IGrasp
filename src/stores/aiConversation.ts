// The conversation shown in the AI chat: its items, the running operation, the permission
// requests waiting for the user's answer, and the history of this folder's conversations (the
// app's own readable copy, ADR 0019; the provider keeps the real transcript for resuming).
// Everything here is provider-neutral, and only `send`, Start on the confirmation card and
// "Start a new conversation from here" reach `ai_start`.

import { create } from 'zustand';
import {
  applyEvent,
  decisionItem,
  finishStreaming,
  fromStoredItems,
  noticeItem,
  resumeFailedItem,
  toStoredItems,
  usageItem,
  userItem,
} from '../features/ai/timeline';
import type { ChatItem } from '../features/ai/timeline';
import {
  acceptedUnits,
  prepareReview,
  reviewDecision,
  reviewOutcome,
} from '../features/ai/editReview';
import type { UnitDecision } from '../features/ai/editReview';
import type { Review } from '../features/diff/changes';
import { backend } from '../ipc/client';
import type {
  AiEventEnvelope,
  AiPermissionKind,
  AiSizeBucket,
  AiSizeEstimate,
  AiStartRequest,
  ConfirmFrom,
  Conversation,
  ConversationSummary,
  JsonValue,
  PermissionDecision,
  ProposedEdit,
} from '../ipc/types';
import { BackendError } from '../ipc/types';
import { useAiPanel } from './aiPanel';
import { useDocuments } from './documents';
import { errorMessage, selectProviderName, useAiProvider } from './aiProvider';
import { useSettings } from './settings';
import { selectActiveTab, useTabs } from './tabs';
import { useToasts } from './toasts';

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

/**
 * "Allow for this conversation": the same tool asking for the same kind of permission is allowed
 * without a prompt until New conversation (a UI convenience over the same `respond` call; the
 * gateway keeps no state across operations).
 */
export interface ConversationRule {
  tool: string;
  kind: AiPermissionKind;
}

/** The transcript reason of an answer given by a conversation rule. */
export const REASON_CONVERSATION_RULE = 'allowed for this conversation';

export const ruleMatches = (rule: ConversationRule, p: { tool: string; kind: AiPermissionKind }) =>
  rule.tool === p.tool && rule.kind === p.kind;

/**
 * The markdown edit under review in the preview (plan §6.9): one at a time, the others wait in
 * `permissions` (their cards show the line diff until their turn comes).
 */
export interface PendingReview {
  operationId: number;
  requestId: string;
  path: string;
  edit: ProposedEdit;
  /** The file does not exist yet: its old content is empty. */
  isNew: boolean;
  /**
   * `loading` while the current content is read; `fallback` when the edit cannot be reviewed in
   * the preview (a hunk not found, a file too large): the chat card shows the line diff.
   */
  status: 'loading' | 'ready' | 'fallback';
  oldContent: string;
  review: Review | null;
  /** Decision per change unit id; missing means undecided. */
  decisions: Record<number, UnitDecision>;
}

/** An operation waiting for the user's Start (the estimate reached `settings.ai.confirmFrom`). */
export interface PendingConfirm {
  title: string;
  /** The message, for "Start a new conversation from here" if resuming then fails. */
  prompt: string;
  request: AiStartRequest;
  estimate: AiSizeEstimate;
  documents: { path: string; bytes: number }[];
  images: number;
  model: string;
}

interface AiConversationState {
  /** Id of this conversation in the history; null until its first message. */
  id: string | null;
  createdMs: number;
  items: ChatItem[];
  /** What continues the conversation with the provider. */
  resumeId: string | null;
  /** The model the provider reported running this conversation with; empty until known. */
  sessionModel: string;
  /** Totals for this conversation. */
  usage: Usage;
  /** The running operation, or null. */
  operationId: number | null;
  /** An operation is being started: its events may arrive before its id is known. */
  starting: boolean;
  /** The confirmation card shown before a large operation; nothing runs until Start. */
  pendingConfirm: PendingConfirm | null;
  buffered: AiEventEnvelope[];
  permissions: PendingPermission[];
  /** Permissions allowed for the rest of this conversation. */
  rules: ConversationRule[];
  /** This folder's saved conversations, newest first; null until listed. */
  history: ConversationSummary[] | null;
  pendingReview: PendingReview | null;

  send: (text: string) => Promise<void>;
  /** Start of the confirmation card: the only way a confirmed operation begins. */
  confirmStart: () => Promise<void>;
  cancelConfirm: () => void;
  respond: (requestId: string, decision: PermissionDecision) => Promise<void>;
  /** Allows this request and, until New conversation, the same tool for the same kind. */
  allowForConversation: (requestId: string) => Promise<void>;
  removeRule: (rule: ConversationRule) => void;
  /** Opens or focuses the tab of the edit under review (preview tab semantics). */
  showReview: () => void;
  /** Accepts or rejects one change unit of the review; null makes it undecided again. */
  decideUnit: (unitId: number, decision: UnitDecision | null) => void;
  /** Accepts every undecided unit and answers with what is accepted. */
  acceptAllChanges: () => Promise<void>;
  /** Rejects the whole edit at once (Deny). */
  rejectAllChanges: () => Promise<void>;
  /** Answers with the decided units (every unit decided, at least one accepted). */
  applyReview: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Saves this conversation (if it has a message), stops its operation, starts an empty one. */
  newConversation: () => void;
  onEvent: (envelope: AiEventEnvelope) => void;
  /** Writes this conversation to the folder's history (app data) if it has a user message. */
  save: () => Promise<void>;
  /** Lists the folder's conversations (app data only). */
  loadHistory: () => Promise<void>;
  /** Shows a saved conversation; the next message continues it. */
  load: (id: string) => Promise<void>;
  /** Deletes a saved conversation (a new one starts if it is the one shown). */
  remove: (id: string) => Promise<void>;
  /** Deletes every conversation of the folder ("Forget this folder's conversations"). */
  forgetAll: () => Promise<void>;
  /** After a failed resume: sends `prompt` again in a new provider session, same history entry. */
  restartFromHere: (prompt: string) => Promise<void>;
  /** Saves and clears everything before another folder is opened (or this one closed). */
  leaveFolder: () => Promise<void>;
}

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: null };

const BUCKET_RANK: Record<AiSizeBucket, number> = { small: 0, medium: 1, large: 2 };

/** Whether an estimate must be confirmed with the card under this setting. */
export function needsConfirmation(bucket: AiSizeBucket, confirmFrom: ConfirmFrom): boolean {
  return confirmFrom !== 'never' && BUCKET_RANK[bucket] >= BUCKET_RANK[confirmFrom];
}

export const selectBusy = (s: AiConversationState) => s.operationId !== null || s.starting;

/** The fresh state of a conversation (the history list is kept). */
const EMPTY = {
  id: null,
  createdMs: 0,
  items: [],
  resumeId: null,
  sessionModel: '',
  usage: NO_USAGE,
  operationId: null,
  starting: false,
  pendingConfirm: null,
  buffered: [],
  permissions: [],
  rules: [],
  pendingReview: null,
} satisfies Partial<AiConversationState>;

let idCounter = 0;
/** History ids: `<ms>-<counter>`, the characters the backend accepts. */
const newConversationId = () => `${String(Date.now())}-${String(++idCounter)}`;

/** What the operation being run has shown so far, to recognize a failed resume. */
interface Run {
  prompt: string;
  resumed: boolean;
  answered: boolean;
  failed: boolean;
}
let run: Run | null = null;

/** The conversation as the history stores it, or null when it has no user message yet. */
function snapshot(s: AiConversationState): Conversation | null {
  const first = s.items.find((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user');
  if (!first || s.id === null) return null;
  const provider = useAiProvider.getState();
  return {
    id: s.id,
    title: first.text.split('\n')[0] ?? first.text,
    createdMs: s.createdMs,
    updatedMs: Date.now(),
    providerId: provider.status?.providerId ?? useSettings.getState().settings.ai.provider,
    model: s.sessionModel || provider.model,
    resumeId: s.resumeId,
    usage: { ...s.usage },
    items: toStoredItems(s.items),
  };
}

async function write(conversation: Conversation | null): Promise<void> {
  if (!conversation) return;
  try {
    await backend.saveConversation(conversation);
  } catch (err) {
    useToasts.getState().notify('error', `Cannot save the conversation: ${errorMessage(err)}`);
    return;
  }
  // The list follows when it has been shown once.
  if (useAiConversation.getState().history !== null) {
    await useAiConversation.getState().loadHistory();
  }
}

/** The document or code file of the active tab (null for a settings or shortcuts tab). */
export function activeFilePath(): string | null {
  const tab = selectActiveTab(useTabs.getState());
  return tab && tab.relPath !== null ? tab.relPath : null;
}

/** A markdown edit inside the folder, for the review in the preview. */
const reviewable = (
  p: PendingPermission,
): p is PendingPermission & { proposedEdit: ProposedEdit } =>
  p.kind === 'markdownEdit' && p.proposedEdit !== null && p.proposedEdit.isMarkdown;

/** The current content of a document: the open tab's, else read from disk; null if absent. */
async function currentContent(path: string): Promise<string | null> {
  const doc = useDocuments.getState().byPath[path];
  if (doc?.status === 'ready') return doc.content;
  try {
    return (await backend.readMarkdown(path)).content;
  } catch (err) {
    if (err instanceof BackendError && err.code === 'NotFound') return null;
    throw err;
  }
}

/** Calls `ai_start` (the only call that spends tokens) and hands buffered events over. */
async function runStart(request: AiStartRequest, prompt: string): Promise<void> {
  run = { prompt, resumed: request.resumeId !== undefined, answered: false, failed: false };
  const operationId = await backend.aiStart('chatMessage', request);
  useAiPanel.getState().messageSent();
  const buffered = useAiConversation.getState().buffered;
  useAiConversation.setState({ operationId, starting: false, buffered: [] });
  // Events of this operation that arrived before its id was known.
  for (const envelope of buffered) {
    if (envelope.operationId === operationId) useAiConversation.getState().onEvent(envelope);
  }
}

export const useAiConversation = create<AiConversationState>()((set, get) => {
  const fail = (err: unknown) => {
    set((s) => ({
      starting: false,
      buffered: [],
      items: [...s.items, noticeItem('error', errorMessage(err))],
    }));
  };

  /** Estimates, then starts or shows the confirmation card. */
  const startMessage = async (prompt: string, showUserItem: boolean) => {
    set((s) => ({
      id: s.id ?? newConversationId(),
      createdMs: s.id === null ? Date.now() : s.createdMs,
      items: showUserItem ? [...s.items, userItem(prompt)] : s.items,
      starting: true,
      buffered: [],
    }));
    const { resumeId } = get();
    const { model } = useAiProvider.getState();
    try {
      // What the context bar lists for the current file, minus what the user dropped (listed
      // now if the bar has not been shown for this file), then the size of it all.
      const current = activeFilePath();
      if (useAiPanel.getState().context?.currentPath !== current) {
        await useAiPanel.getState().refreshContext(current);
      }
      const panel = useAiPanel.getState();
      const contextPaths = panel.contextPaths();
      const documents = (panel.context?.documents ?? []).filter((d) =>
        contextPaths.includes(d.path),
      );
      const { attachment } = panel;
      const request: AiStartRequest = {
        prompt,
        contextPaths,
        images: attachment?.image ? [attachment.image] : [],
        ...(attachment ? { capture: attachment.capture } : {}),
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
            prompt,
            request,
            estimate,
            documents: documents.map((d) => ({ path: d.path, bytes: d.bytes })),
            images: request.images.length,
            model,
          },
        });
        return;
      }
      await runStart(request, prompt);
    } catch (err) {
      fail(err);
    }
  };

  /** Starts the review of the next markdown edit waiting, if none is under review. */
  const nextReview = () => {
    if (get().pendingReview) return;
    const p = get().permissions.find(reviewable);
    if (!p) return;
    const edit = p.proposedEdit;
    const base: PendingReview = {
      operationId: p.operationId,
      requestId: p.requestId,
      path: edit.path,
      edit,
      isNew: false,
      status: 'loading',
      oldContent: '',
      review: null,
      decisions: {},
    };
    set({ pendingReview: base });
    const current = () => get().pendingReview?.requestId === p.requestId;
    void (async () => {
      let content: string | null;
      try {
        content = await currentContent(edit.path);
      } catch (err) {
        console.warn(`Cannot read ${edit.path} for the review`, err);
        if (current()) set({ pendingReview: { ...base, status: 'fallback' } });
        return;
      }
      if (!current()) return;
      const oldContent = content ?? '';
      const review = prepareReview(edit, oldContent);
      set({
        pendingReview: {
          ...base,
          isNew: content === null,
          oldContent,
          review,
          status: review ? 'ready' : 'fallback',
        },
      });
      if (review) get().showReview();
    })();
  };

  /** Answers the edit under review and says in the transcript what was applied. */
  const answerReview = async (accepted: ReadonlySet<number>) => {
    const pending = get().pendingReview;
    if (pending?.status !== 'ready' || !pending.review) return;
    const { review } = pending;
    const decision = reviewDecision(pending.edit, review, accepted, REJECTION_MESSAGE);
    const count = review.units.filter((u) => accepted.has(u.id)).length;
    const outcome = reviewOutcome(pending.path, review.units.length, count);
    set((s) => ({ items: [...s.items, noticeItem('info', outcome)] }));
    // A new file that is not created leaves no tab behind.
    if (pending.isNew && count === 0) {
      const tab = useTabs
        .getState()
        .tabs.find((t) => t.kind === 'document' && t.relPath === pending.path);
      if (tab) useTabs.getState().close(tab.id);
    }
    await get().respond(pending.requestId, decision);
  };

  /** Back to an empty conversation; the running operation's last events are ignored. */
  const reset = () => {
    const { operationId } = get();
    run = null;
    set({ ...EMPTY });
    if (operationId !== null) void backend.aiCancel(operationId);
    useAiProvider.getState().showRememberedModel();
  };

  return {
    ...EMPTY,
    history: null,

    async send(text) {
      const prompt = text.trim();
      if (!prompt || selectBusy(get()) || get().pendingConfirm) return;
      await startMessage(prompt, true);
    },

    async confirmStart() {
      const pending = get().pendingConfirm;
      if (!pending || selectBusy(get())) return;
      set({ pendingConfirm: null, starting: true, buffered: [] });
      try {
        await runStart(pending.request, pending.prompt);
      } catch (err) {
        fail(err);
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
      set((s) => ({
        permissions: s.permissions.filter((p) => p.requestId !== requestId),
        // The tab leaves review mode on the decision; the written file arrives by live reload.
        pendingReview: s.pendingReview?.requestId === requestId ? null : s.pendingReview,
      }));
      nextReview();
      try {
        await backend.aiRespondPermission(pending.operationId, requestId, decision);
      } catch (err) {
        set((s) => ({ items: [...s.items, noticeItem('error', errorMessage(err))] }));
      }
    },

    async allowForConversation(requestId) {
      const pending = get().permissions.find((p) => p.requestId === requestId);
      if (!pending || pending.kind === 'markdownEdit') return;
      const rule = { tool: pending.tool, kind: pending.kind };
      if (!get().rules.some((r) => ruleMatches(r, rule))) {
        set((s) => ({ rules: [...s.rules, rule] }));
      }
      await get().respond(requestId, { behavior: 'allow', updatedEdit: null });
    },

    removeRule(rule) {
      set((s) => ({ rules: s.rules.filter((r) => !ruleMatches(r, rule)) }));
    },

    showReview() {
      const pending = get().pendingReview;
      if (pending?.status !== 'ready') return;
      useTabs.getState().openDocument(pending.path);
    },

    decideUnit(unitId, decision) {
      const pending = get().pendingReview;
      if (pending?.status !== 'ready' || !pending.review?.units.some((u) => u.id === unitId)) {
        return;
      }
      const decisions = Object.fromEntries(
        Object.entries(pending.decisions).filter(([id]) => Number(id) !== unitId),
      ) as Record<number, UnitDecision>;
      if (decision !== null) decisions[unitId] = decision;
      set({ pendingReview: { ...pending, decisions } });
    },

    async acceptAllChanges() {
      const pending = get().pendingReview;
      if (pending?.status !== 'ready' || !pending.review) return;
      const decisions = { ...pending.decisions };
      for (const unit of pending.review.units) decisions[unit.id] ??= 'accepted';
      set({ pendingReview: { ...pending, decisions } });
      await answerReview(acceptedUnits(decisions));
    },

    async rejectAllChanges() {
      await answerReview(new Set());
    },

    async applyReview() {
      const pending = get().pendingReview;
      if (pending?.status !== 'ready' || !pending.review) return;
      const { decisions } = pending;
      const accepted = acceptedUnits(decisions);
      if (pending.review.units.some((u) => !(u.id in decisions)) || accepted.size === 0) return;
      await answerReview(accepted);
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
      const previous = snapshot(get());
      reset();
      void write(previous);
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
          set({ resumeId: event.resumeId, sessionModel: event.model });
          return;
        case 'permissionRequest':
          if (s.permissions.some((p) => p.requestId === event.requestId)) return;
          // A conversation rule answers without asking, and says so in the transcript.
          if (event.kind !== 'markdownEdit' && s.rules.some((r) => ruleMatches(r, event))) {
            set({
              items: [
                ...s.items,
                decisionItem({
                  tool: event.tool,
                  permissionKind: event.kind,
                  description: event.description,
                  allowed: true,
                  reason: REASON_CONVERSATION_RULE,
                }),
              ],
            });
            backend
              .aiRespondPermission(envelope.operationId, event.requestId, {
                behavior: 'allow',
                updatedEdit: null,
              })
              .catch((err: unknown) => {
                set((st) => ({ items: [...st.items, noticeItem('error', errorMessage(err))] }));
              });
            return;
          }
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
          // A markdown edit inside the folder is reviewed in the preview.
          nextReview();
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
              noticeItem(
                'error',
                `${selectProviderName(useAiProvider.getState())} stopped unexpectedly.${detail}`,
              ),
            ];
          }
          // A resumed conversation that failed before any answer: the provider has lost it.
          const lost =
            run !== null &&
            run.resumed &&
            !run.answered &&
            (run.failed || event.outcome === 'Failed');
          if (lost && run) items = [...items, resumeFailedItem(run.prompt)];
          run = null;
          set({
            items,
            operationId: null,
            permissions: s.permissions.filter((p) => p.operationId !== envelope.operationId),
            pendingReview:
              s.pendingReview?.operationId === envelope.operationId ? null : s.pendingReview,
          });
          // The history copy is written once per operation, not per delta.
          void write(snapshot(get()));
          return;
        }
        default:
          if (run) {
            if (event.type === 'error') run.failed = true;
            else if (event.type !== 'permissionDecided') run.answered = true;
          }
          set({ items: applyEvent(s.items, event) });
      }
    },

    async save() {
      await write(snapshot(get()));
    },

    async loadHistory() {
      try {
        set({ history: await backend.listConversations() });
      } catch (err) {
        set({ history: [] });
        useToasts.getState().notify('error', `Cannot list the conversations: ${errorMessage(err)}`);
      }
    },

    async load(id) {
      if (selectBusy(get()) || get().pendingConfirm) return;
      if (get().id === id) return;
      let conversation: Conversation;
      try {
        conversation = await backend.getConversation(id);
      } catch (err) {
        useToasts.getState().notify('error', `Cannot open the conversation: ${errorMessage(err)}`);
        return;
      }
      const previous = snapshot(get());
      run = null;
      set({
        ...EMPTY,
        id: conversation.id,
        createdMs: conversation.createdMs,
        items: fromStoredItems(conversation.items),
        resumeId: conversation.resumeId,
        sessionModel: conversation.model,
        usage: { ...conversation.usage },
      });
      // It continues with the model it ran with (the picker shows it, the setting is unchanged).
      useAiProvider.getState().showModel(conversation.model);
      await write(previous);
    },

    async remove(id) {
      try {
        await backend.deleteConversation(id);
      } catch (err) {
        useToasts
          .getState()
          .notify('error', `Cannot delete the conversation: ${errorMessage(err)}`);
        return;
      }
      if (get().id === id) reset();
      set((s) => ({ history: s.history?.filter((c) => c.id !== id) ?? null }));
    },

    async forgetAll() {
      try {
        await backend.forgetConversations();
      } catch (err) {
        useToasts
          .getState()
          .notify('error', `Cannot forget the conversations: ${errorMessage(err)}`);
        return;
      }
      reset();
      set({ history: [] });
    },

    async restartFromHere(prompt) {
      if (selectBusy(get()) || get().pendingConfirm) return;
      set((s) => ({
        resumeId: null,
        items: [
          ...s.items.filter((i) => i.kind !== 'resumeFailed'),
          noticeItem('info', 'Started a new conversation from here.'),
        ],
      }));
      await startMessage(prompt, false);
    },

    async leaveFolder() {
      const previous = snapshot(get());
      run = null;
      set({ ...EMPTY, history: null });
      useAiProvider.getState().showRememberedModel();
      if (previous) {
        try {
          await backend.saveConversation(previous);
        } catch (err) {
          console.warn('Cannot save the conversation', err);
        }
      }
    },
  };
});
