import { describe, expect, it } from 'vitest';
import { createMockBackend } from '.';
import type { AiEvent, AiStartRequest, Conversation, PermissionDecision } from '../types';
import { FIXTURE_ROOT } from './fixture';
import {
  DENIED_BY_SETTINGS,
  DENIED_READ_ONLY,
  MOCK_APPLIED_TEXT,
  MOCK_CRASH_DETAIL,
  MOCK_EDIT_SUFFIX,
  MOCK_NEW_FILE_CONTENT,
  MOCK_NO_CONVERSATION,
  MOCK_REJECTED_TEXT,
  REASON_ALLOWED_BY_SETTINGS,
  REASON_DENIED_BY_SETTINGS,
  REASON_READ_ONLY,
} from './mockAi';

type Mock = ReturnType<typeof createMockBackend>;
type PermissionEvent = Extract<AiEvent, { type: 'permissionRequest' }>;

async function backend(): Promise<Mock> {
  const b = createMockBackend();
  b.controls.state.ai.stepMs = 0;
  await b.openRoot(FIXTURE_ROOT);
  return b;
}

/** Runs one operation to its end, answering its permission request with `answer`. */
async function run(
  b: Mock,
  request: Partial<AiStartRequest> & { prompt: string },
  answer: (p: PermissionEvent) => PermissionDecision = () => ({
    behavior: 'allow',
    updatedEdit: null,
  }),
): Promise<AiEvent[]> {
  const events: AiEvent[] = [];
  let operationId = -1;
  let resolve: () => void = () => undefined;
  const ended = new Promise<void>((r) => (resolve = r));
  const off = await b.listen('ai://event', ({ operationId: id, event }) => {
    if (id !== operationId) return;
    events.push(event);
    if (event.type === 'permissionRequest') {
      void b.aiRespondPermission(id, event.requestId, answer(event));
    }
    if (event.type === 'done') resolve();
  });
  operationId = await b.aiStart('chatMessage', {
    contextPaths: [],
    images: [],
    policy: 'interactive',
    ...request,
  });
  await ended;
  off();
  return events;
}

const permissionOf = (events: AiEvent[]) =>
  events.find((e): e is PermissionEvent => e.type === 'permissionRequest');
const lastText = (events: AiEvent[]) =>
  events.filter((e): e is Extract<AiEvent, { type: 'text' }> => e.type === 'text').pop()?.text ??
  '';

describe('mock AI scripts', () => {
  it('edits a markdown file with one hunk and applies it when allowed', async () => {
    const b = await backend();
    const events = await run(b, { prompt: 'edit README.md' });
    const p = permissionOf(events);
    expect(p?.tool).toBe('Edit');
    expect(p?.kind).toBe('markdownEdit');
    expect(p?.proposedEdit?.hunks).toHaveLength(1);
    expect(b.controls.state.files.get('README.md')).toMatch(
      new RegExp(`^# IGrasp demo project${MOCK_EDIT_SUFFIX.replace(/[()]/g, '\\$&')}`),
    );
    expect(lastText(events)).toBe(MOCK_APPLIED_TEXT);
  });

  it('proposes two hunks and applies only the accepted one', async () => {
    const b = await backend();
    const before = b.controls.state.files.get('README.md') ?? '';
    const events = await run(b, { prompt: 'edit twice README.md' }, (p) => ({
      behavior: 'allow',
      updatedEdit: p.proposedEdit && { ...p.proposedEdit, hunks: p.proposedEdit.hunks.slice(1) },
    }));
    const p = permissionOf(events);
    expect(p?.tool).toBe('MultiEdit');
    const [first, second] = p?.proposedEdit?.hunks ?? [];
    expect(first?.oldText).toMatch(/^Welcome/);
    expect(second?.oldText).toMatch(/^The app starts/);
    const after = b.controls.state.files.get('README.md') ?? '';
    expect(after).toBe(before.replace(second?.oldText ?? '', second?.newText ?? ''));
    expect(after).toContain(first?.oldText ?? '?');
  });

  it('refuses an accepted hunk that was never proposed, like the provider', async () => {
    const b = await backend();
    const before = b.controls.state.files.get('README.md');
    const events = await run(b, { prompt: 'edit twice README.md' }, (p) => ({
      behavior: 'allow',
      updatedEdit: p.proposedEdit && {
        ...p.proposedEdit,
        hunks: [{ oldText: 'Welcome', newText: 'Hi' }],
      },
    }));
    expect(b.controls.state.files.get('README.md')).toBe(before);
    expect(events.find((e) => e.type === 'toolResult')).toMatchObject({ isError: true });
    expect(lastText(events)).toBe(MOCK_REJECTED_TEXT);
  });

  it('rewrites a whole file, or writes the composed content', async () => {
    const b = await backend();
    let events = await run(b, { prompt: 'rewrite README.md' });
    const p = permissionOf(events);
    expect(p?.tool).toBe('Write');
    expect(p?.proposedEdit?.wholeFile).toBe(true);
    expect(b.controls.state.files.get('README.md')).toContain('(rewritten)');
    events = await run(b, { prompt: 'rewrite README.md' }, (q) => ({
      behavior: 'allow',
      updatedEdit: q.proposedEdit && {
        ...q.proposedEdit,
        hunks: [{ oldText: '', newText: '# Composed\n' }],
      },
    }));
    expect(b.controls.state.files.get('README.md')).toBe('# Composed\n');
    expect(lastText(events)).toBe(MOCK_APPLIED_TEXT);
  });

  it('creates a new file', async () => {
    const b = await backend();
    const events = await run(b, { prompt: 'create notes/new.md' });
    expect(permissionOf(events)?.proposedEdit).toMatchObject({
      path: 'notes/new.md',
      wholeFile: true,
    });
    expect(b.controls.state.files.get('notes/new.md')).toBe(MOCK_NEW_FILE_CONTENT);
  });

  it('classifies a code edit, a command and a web fetch', async () => {
    const b = await backend();
    const deny = () => ({ behavior: 'deny', message: 'no' }) as const;
    const code = permissionOf(await run(b, { prompt: 'edit src/main.ts' }, deny));
    expect(code?.kind).toBe('fileEdit');
    expect(code?.proposedEdit?.isMarkdown).toBe(false);
    expect(permissionOf(await run(b, { prompt: 'run a command' }, deny))?.kind).toBe('command');
    expect(permissionOf(await run(b, { prompt: 'fetch the site' }, deny))?.kind).toBe('web');
  });

  it('acknowledges attached images with their size', async () => {
    const b = await backend();
    const events = await run(b, {
      prompt: 'what is in this image?',
      images: [{ mediaType: 'image/png', dataBase64: 'AAAA' }],
    });
    expect(lastText(events)).toBe('I see 1 attached image (3 bytes).');
  });

  it('crashes, and fails to resume an unknown conversation', async () => {
    const b = await backend();
    let events = await run(b, { prompt: 'crash now' });
    expect(events.pop()).toEqual({ type: 'done', outcome: 'Failed', detail: MOCK_CRASH_DETAIL });
    events = await run(b, { prompt: 'hello', resumeId: 'lost-session' });
    expect(events.find((e) => e.type === 'error')).toEqual({
      type: 'error',
      message: `${MOCK_NO_CONVERSATION} lost-session`,
    });
    // A session the mock issued resumes.
    const first = await run(b, { prompt: 'hello' });
    const session = first.find((e) => e.type === 'session');
    events = await run(b, {
      prompt: 'again',
      resumeId: session?.type === 'session' ? session.resumeId : '',
    });
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('applies the permission settings like the gateway, from a snapshot', async () => {
    const b = await backend();
    const rules = b.controls.state.settings.ai.permissions;
    rules.markdownEdits = 'deny';
    const before = b.controls.state.files.get('README.md');
    const asked: string[] = [];
    let events = await run(b, { prompt: 'edit README.md' }, (p) => {
      asked.push(p.tool);
      return { behavior: 'allow', updatedEdit: null };
    });
    expect(asked).toEqual([]);
    expect(events.find((e) => e.type === 'permissionDecided')).toEqual({
      type: 'permissionDecided',
      tool: 'Edit',
      kind: 'markdownEdit',
      description: 'README.md',
      allowed: false,
      reason: REASON_DENIED_BY_SETTINGS,
    });
    expect(events.find((e) => e.type === 'toolResult')).toMatchObject({
      content: DENIED_BY_SETTINGS,
      isError: true,
    });
    expect(b.controls.state.files.get('README.md')).toBe(before);

    rules.markdownEdits = 'ask';
    rules.commands = 'allow';
    events = await run(b, { prompt: 'run a command' });
    expect(events.find((e) => e.type === 'permissionDecided')).toMatchObject({
      kind: 'command',
      allowed: true,
      reason: REASON_ALLOWED_BY_SETTINGS,
    });
    expect(events.some((e) => e.type === 'permissionRequest')).toBe(false);

    // A change during an operation applies to the next one only.
    rules.commands = 'ask';
    const pending = run(b, { prompt: 'edit README.md' }, () => {
      rules.commands = 'deny';
      return { behavior: 'deny', message: 'no' };
    });
    expect(permissionOf(await pending)?.kind).toBe('markdownEdit');
  });

  it('refuses every write of a read-only operation, whatever the settings', async () => {
    const b = await backend();
    const rules = b.controls.state.settings.ai.permissions;
    rules.markdownEdits = 'allow';
    rules.commands = 'allow';
    const before = b.controls.state.files.get('README.md');
    for (const prompt of ['edit README.md', 'create notes/new.md', 'run a command']) {
      const events = await run(b, { prompt, policy: 'readOnly' });
      expect(events.find((e) => e.type === 'permissionDecided')).toMatchObject({
        allowed: false,
        reason: REASON_READ_ONLY,
      });
      expect(events.find((e) => e.type === 'toolResult')).toMatchObject({
        content: DENIED_READ_ONLY,
      });
    }
    expect(b.controls.state.files.get('README.md')).toBe(before);
    expect(b.controls.state.files.has('notes/new.md')).toBe(false);
  });

  it('streams the slow script as ten deltas', async () => {
    const b = await backend();
    const started = Date.now();
    const events = await run(b, { prompt: 'slow please' });
    expect(events.filter((e) => e.type === 'textDelta')).toHaveLength(10);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  });
});

describe('mock AI context and estimate', () => {
  it('lists the instruction files down to the current file, then reads them on start', async () => {
    const b = await backend();
    b.controls.writeFiles({ 'AGENTS.md': '# Rules\n', 'docs/AGENTS.md': '# Docs rules\n' });
    const current = 'docs/guide/getting-started.md';
    const docs = await b.aiContext(current);
    expect(docs.map((d) => [d.path, d.role])).toEqual([
      ['AGENTS.md', 'instructionFile'],
      ['docs/AGENTS.md', 'instructionFile'],
      [current, 'currentFile'],
    ]);
    expect(docs.every((d) => d.content === null && !d.truncated)).toBe(true);
    expect(await b.aiContext(null)).toHaveLength(1);

    // The user removed docs/AGENTS.md from this message.
    const paths = ['AGENTS.md', current];
    await run(b, { prompt: 'hello', contextPaths: paths });
    const last = b.controls.state.ai.lastRequest;
    expect(last?.prompt).toBe('hello');
    expect(last?.context.map((d) => d.path)).toEqual(paths);
    expect(last?.context[0]?.content).toBe('# Rules\n');
    expect(last?.context[1]?.content).toMatch(/^---\ntitle: Getting started/);

    const estimate = await b.aiEstimate({ promptBytes: 5, contextPaths: paths, images: 1 });
    expect(estimate).toMatchObject({ documents: 2, images: 1, bucket: 'small' });
    expect(estimate.bytes).toBe(5 + (docs[0]?.bytes ?? 0) + (docs[2]?.bytes ?? 0));
  });

  it('lists a file too large to inline by path, and refuses malformed paths', async () => {
    const b = await backend();
    const [huge] = await b.aiContext('logs/huge.log');
    expect(huge).toMatchObject({ path: 'logs/huge.log', truncated: true, content: null });
    const estimate = await b.aiEstimate({
      promptBytes: 0,
      contextPaths: ['logs/huge.log'],
      images: 0,
    });
    expect(estimate.bucket).toBe('large');
    await expect(b.aiContext('../x.md')).rejects.toMatchObject({ code: 'InvalidPath' });
    await expect(
      b.aiStart('chatMessage', {
        prompt: 'x',
        contextPaths: ['/etc/passwd'],
        images: [],
        policy: 'interactive',
      }),
    ).rejects.toMatchObject({ code: 'InvalidPath' });
    expect(b.controls.state.ai.starts).toEqual([]);
  });

  it('records the capture and the images the provider received', async () => {
    const b = await backend();
    const capture = { sourcePath: 'README.md', firstLine: 3, lastLine: 3, text: 'Welcome' };
    const events = await run(b, {
      prompt: 'image of this',
      capture,
      images: [{ mediaType: 'image/png', dataBase64: 'AAAAAA==' }],
    });
    expect(b.controls.state.ai.lastRequest?.capture).toEqual(capture);
    expect(b.controls.state.ai.lastRequest?.images).toHaveLength(1);
    expect(lastText(events)).toBe('I see 1 attached image (4 bytes).');
  });
});

describe('mock conversations', () => {
  const conversation = (id: string, updatedMs: number): Conversation => ({
    id,
    title: `About ${id}`,
    createdMs: updatedMs - 10,
    updatedMs,
    providerId: 'mock',
    model: 'mock-fast',
    resumeId: null,
    usage: { inputTokens: 1, outputTokens: 2, costUsd: null },
    items: [{ kind: 'user', id: 'u1', text: 'hello' }],
  });

  it('stores conversations per folder like Rust, newest first and trimmed', async () => {
    const b = await backend();
    await b.saveConversation(conversation('a', 1));
    await b.saveConversation({ ...conversation('b', 2), title: 'é'.repeat(100) });
    expect((await b.listConversations()).map((s) => s.id)).toEqual(['b', 'a']);
    expect((await b.getConversation('b')).title).toHaveLength(80);
    await b.saveConversation({
      ...conversation('a', 3),
      items: Array.from({ length: 450 }, (_, n) => ({ n })),
    });
    const a = await b.getConversation('a');
    expect(a.items).toHaveLength(400);
    expect(a.items[0]).toEqual({ n: 50 });
    expect((await b.listConversations())[0]?.id).toBe('a');

    b.controls.state.settings.ai.historyLimit = 2;
    await b.saveConversation(conversation('c', 4));
    expect((await b.listConversations()).map((s) => s.id)).toEqual(['c', 'a']);

    await b.deleteConversation('a');
    await expect(b.getConversation('a')).rejects.toMatchObject({ code: 'NotFound' });
    await expect(b.saveConversation(conversation('../x', 5))).rejects.toMatchObject({
      code: 'AppData',
    });
    expect(b.controls.state.ai.conversations.get(FIXTURE_ROOT)).toHaveLength(1);

    await b.forgetConversations();
    expect(await b.listConversations()).toEqual([]);
    await b.closeRoot();
    await expect(b.listConversations()).rejects.toMatchObject({ code: 'NoRootOpen' });
    expect(b.controls.state.ai.starts).toEqual([]);
  });
});
