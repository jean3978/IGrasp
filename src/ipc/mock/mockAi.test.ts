import { describe, expect, it } from 'vitest';
import { createMockBackend } from '.';
import type { AiEvent, AiRequest, PermissionDecision } from '../types';
import { FIXTURE_ROOT } from './fixture';
import {
  MOCK_APPLIED_TEXT,
  MOCK_CRASH_DETAIL,
  MOCK_EDIT_SUFFIX,
  MOCK_NEW_FILE_CONTENT,
  MOCK_NO_CONVERSATION,
  MOCK_REJECTED_TEXT,
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
  request: Partial<AiRequest> & { prompt: string },
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
    contextFiles: [],
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

  it('streams the slow script as ten deltas', async () => {
    const b = await backend();
    const started = Date.now();
    const events = await run(b, { prompt: 'slow please' });
    expect(events.filter((e) => e.type === 'textDelta')).toHaveLength(10);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  });
});
