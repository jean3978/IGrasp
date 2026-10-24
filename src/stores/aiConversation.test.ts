import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORED_RESULT_CHARS, fromStoredItems, toStoredItems } from '../features/ai/timeline';
import type { ChatItem } from '../features/ai/timeline';
import { backend } from '../ipc/client';
import { DEFAULT_SETTINGS } from '../ipc/defaults';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import { MOCK_NO_CONVERSATION } from '../ipc/mock/mockAi';
import type { Conversation } from '../ipc/types';
import { resetAiStores } from '../test/resetAi';
import { useAiConversation } from './aiConversation';
import { useAiProvider } from './aiProvider';
import { startEventBridge } from './eventBridge';
import { useSettings } from './settings';
import { useTabs } from './tabs';
import { useWorkspace } from './workspace';

let stop: () => void = () => undefined;
const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('mock backend missing');
  return m;
};
const conv = () => useAiConversation.getState();
const idle = () =>
  vi.waitFor(() => {
    expect(conv().operationId).toBeNull();
    expect(conv().starting).toBe(false);
  });

beforeEach(async () => {
  mock().reset();
  mock().state.ai.stepMs = 1;
  resetAiStores();
  useTabs.setState({ tabs: [], activeId: null });
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false });
  await useSettings.getState().load();
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await useAiProvider.getState().checkStatus();
});

afterEach(async () => {
  stop();
  await useWorkspace.getState().closeRoot();
});

/** Waits until the history lists `count` conversations. */
const saved = (count: number) =>
  vi.waitFor(async () => {
    expect(await backend.listConversations()).toHaveLength(count);
  });

describe('conversation history', () => {
  it('saves the conversation when an operation ends, as summaries', async () => {
    await conv().send('What is this project?');
    await idle();
    await saved(1);
    const [summary] = await backend.listConversations();
    expect(summary).toMatchObject({ title: 'What is this project?', model: 'mock-fast' });
    expect(summary?.usage.outputTokens).toBe(80);
    const stored = await backend.getConversation(summary?.id ?? '');
    expect(stored.resumeId).toBe(conv().resumeId);
    expect(stored.providerId).toBe('mock');
    expect(stored.items.map((i) => (i as { kind: string }).kind)).toEqual([
      'user',
      'assistant',
      'usage',
    ]);

    // A second message updates the same entry.
    await conv().send('And then?');
    await idle();
    await vi.waitFor(async () => {
      const again = await backend.getConversation(summary?.id ?? '');
      expect(again.items.filter((i) => (i as { kind: string }).kind === 'user')).toHaveLength(2);
    });
    expect(await backend.listConversations()).toHaveLength(1);
    expect(mock().state.ai.starts).toEqual(['chatMessage', 'chatMessage']);
  });

  it('saves on New conversation, then starts an empty one; an empty one is not saved', async () => {
    conv().newConversation();
    await saved(0);
    await conv().send('first');
    await idle();
    conv().newConversation();
    expect(conv().items).toEqual([]);
    expect(conv().id).toBeNull();
    await conv().send('second');
    await idle();
    await saved(2);
    expect((await backend.listConversations()).map((c) => c.title)).toEqual(['second', 'first']);
  });

  it('loads a past conversation and continues it with its resume id and model', async () => {
    await conv().send('first');
    await idle();
    const firstResume = conv().resumeId;
    conv().newConversation();
    useAiProvider.getState().setModel('mock-smart');
    await conv().send('second');
    await idle();
    await saved(2);

    const first = (await backend.listConversations()).find((c) => c.title === 'first');
    await conv().load(first?.id ?? '');
    expect(conv().items.map((i) => i.kind)).toEqual(['user', 'assistant', 'usage']);
    expect(conv().resumeId).toBe(firstResume);
    expect(useAiProvider.getState().model).toBe('mock-fast');
    expect(conv().usage.outputTokens).toBe(80);

    await conv().send('continue');
    await idle();
    expect(mock().state.ai.lastRequest).toMatchObject({
      resumeId: firstResume,
      model: 'mock-fast',
    });
    expect(conv().items.filter((i) => i.kind === 'user')).toHaveLength(2);
    // Loading and listing started nothing.
    expect(mock().state.ai.starts).toHaveLength(3);

    // New conversation: back to the remembered model.
    conv().newConversation();
    expect(useAiProvider.getState().model).toBe('mock-smart');
  });

  it('offers to start again from a conversation the provider lost', async () => {
    const lost: Conversation = {
      id: 'lost-1',
      title: 'old talk',
      createdMs: 1,
      updatedMs: 2,
      providerId: 'mock',
      model: 'mock-fast',
      resumeId: 'gone-session',
      usage: { inputTokens: 10, outputTokens: 5, costUsd: null },
      items: [
        { kind: 'user', id: 'u', text: 'old talk' },
        { kind: 'assistant', id: 'a', text: 'old answer', streaming: false },
      ],
    };
    await backend.saveConversation(lost);
    await conv().load('lost-1');
    await conv().send('are you there?');
    await idle();
    const items = conv().items;
    expect(items.some((i) => i.kind === 'error' && i.text.startsWith(MOCK_NO_CONVERSATION))).toBe(
      true,
    );
    const offer = items.at(-1);
    expect(offer).toMatchObject({ kind: 'resumeFailed', prompt: 'are you there?' });

    await conv().restartFromHere('are you there?');
    await idle();
    expect(mock().state.ai.lastRequest?.resumeId).toBeUndefined();
    expect(mock().state.ai.lastRequest?.prompt).toBe('are you there?');
    expect(conv().items.some((i) => i.kind === 'resumeFailed')).toBe(false);
    expect(conv().resumeId).toMatch(/^00000000-/);
    // Same history entry, now with the new session.
    await vi.waitFor(async () => {
      expect((await backend.getConversation('lost-1')).resumeId).toBe(conv().resumeId);
    });
  });

  it('deletes one conversation, forgets them all, and saves when the folder is left', async () => {
    await conv().send('one');
    await idle();
    conv().newConversation();
    await conv().send('two');
    await idle();
    await saved(2);
    await conv().loadHistory();
    expect(conv().history?.map((c) => c.title)).toEqual(['two', 'one']);

    const shown = conv().id ?? '';
    await conv().remove(shown);
    expect(conv().items).toEqual([]);
    expect(conv().history?.map((c) => c.title)).toEqual(['one']);

    await conv().forgetAll();
    expect(conv().history).toEqual([]);
    expect(await backend.listConversations()).toEqual([]);

    await conv().send('three');
    await idle();
    await saved(1);
    await conv().send('four');
    // Leaving the folder mid-answer saves what is shown.
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    expect(conv().items).toEqual([]);
    const stored = await backend.getConversation((await backend.listConversations())[0]?.id ?? '');
    expect(stored.items.filter((i) => (i as { kind: string }).kind === 'user')).toHaveLength(2);
  });
});

describe('stored items', () => {
  it('keeps tool calls as summaries and reads back what it wrote, with fresh ids', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u1', text: 'hi' },
      { kind: 'assistant', id: 'a1', text: 'partial', streaming: true },
      {
        kind: 'tool',
        id: 't1',
        tool: 'Read',
        summary: 'Read a.md',
        input: { file_path: 'a.md', content: 'x'.repeat(10_000) },
        result: 'y'.repeat(STORED_RESULT_CHARS + 100),
        isError: false,
      },
      {
        kind: 'decision',
        id: 'd1',
        tool: 'Bash',
        permissionKind: 'command',
        description: 'ls',
        allowed: false,
        reason: 'denied by your settings',
      },
      { kind: 'usage', id: 'g1', inputTokens: 1, outputTokens: 2, costUsd: null, durationMs: 3 },
      { kind: 'resumeFailed', id: 'r1', prompt: 'again' },
    ];
    const stored = toStoredItems(items);
    expect(stored[1]).toMatchObject({ streaming: false });
    expect(stored[2]).toMatchObject({ input: null, isError: false });
    expect((stored[2] as { result: string }).result).toHaveLength(STORED_RESULT_CHARS + 1);
    expect(stored[5]).toMatchObject({ kind: 'notice', level: 'error' });

    const back = fromStoredItems([...stored, { kind: 'mystery' }, 'junk', null]);
    expect(back.map((i) => i.kind)).toEqual([
      'user',
      'assistant',
      'tool',
      'decision',
      'usage',
      'notice',
    ]);
    expect(back.map((i) => i.id)).not.toContain('u1');
    expect(back[3]).toMatchObject({ permissionKind: 'command', allowed: false });
  });
});
