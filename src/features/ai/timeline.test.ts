import { describe, expect, it } from 'vitest';
import type { AiEvent } from '../../ipc/types';
import {
  applyEvent,
  captureItem,
  captureLabel,
  decisionText,
  finishStreaming,
  fromStoredItems,
  toStoredItems,
} from './timeline';
import type { ChatItem } from './timeline';

const reduce = (events: AiEvent[], start: ChatItem[] = []) => events.reduce(applyEvent, start);

describe('applyEvent', () => {
  it('streams deltas into one item that the complete text then replaces', () => {
    let items = reduce([
      { type: 'session', resumeId: 's1', model: 'm' },
      { type: 'textDelta', text: 'The edit ' },
      { type: 'textDelta', text: 'was rejected' },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'assistant',
      text: 'The edit was rejected',
      streaming: true,
    });
    items = reduce(
      [{ type: 'text', text: 'The edit was rejected, so the file is unchanged.' }],
      items,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'assistant',
      text: 'The edit was rejected, so the file is unchanged.',
      streaming: false,
    });
  });

  it('lists a tool call, attaches its result and keeps text blocks apart', () => {
    const items = reduce([
      { type: 'text', text: 'Let me look.' },
      { type: 'toolUse', toolId: 't1', tool: 'Edit', summary: 'Edit notes.md', input: { a: 1 } },
      { type: 'toolResult', toolId: 't1', content: 'The user rejected this.', isError: true },
      { type: 'text', text: 'Understood.' },
    ]);
    expect(items.map((i) => i.kind)).toEqual(['assistant', 'tool', 'assistant']);
    expect(items[1]).toMatchObject({
      tool: 'Edit',
      summary: 'Edit notes.md',
      result: 'The user rejected this.',
      isError: true,
    });
  });

  it('shows provider errors and ignores session, permission, usage and done', () => {
    const items: ChatItem[] = [];
    expect(applyEvent(items, { type: 'session', resumeId: 's', model: 'm' })).toBe(items);
    expect(
      applyEvent(items, {
        type: 'permissionRequest',
        requestId: 'r',
        tool: 'Bash',
        kind: 'command',
        description: null,
        input: null,
        proposedEdit: null,
      }),
    ).toBe(items);
    expect(
      applyEvent(items, {
        type: 'usage',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: null,
        durationMs: 1,
      }),
    ).toBe(items);
    expect(applyEvent(items, { type: 'done', outcome: 'Completed', detail: null })).toBe(items);
    expect(applyEvent(items, { type: 'textDelta', text: '' })).toBe(items);
    expect(
      applyEvent(items, { type: 'toolResult', toolId: 'nope', content: '', isError: false }),
    ).toBe(items);
    expect(reduce([{ type: 'error', message: 'Not logged in' }])).toEqual([
      expect.objectContaining({ kind: 'error', text: 'Not logged in' }),
    ]);
  });

  it('lists automatic permission decisions as transcript lines', () => {
    const [item] = reduce([
      {
        type: 'permissionDecided',
        tool: 'Edit',
        kind: 'markdownEdit',
        description: 'notes.md',
        allowed: true,
        reason: 'allowed by your settings',
      },
    ]);
    expect(item).toMatchObject({ kind: 'decision', permissionKind: 'markdownEdit', allowed: true });
    expect(item?.kind === 'decision' && decisionText(item)).toBe(
      'Allowed by your settings: Edit notes.md',
    );
    expect(
      decisionText({ tool: 'Bash', description: null, reason: 'denied by your settings' }),
    ).toBe('Denied by your settings: Bash');
  });

  it('finishes streaming items when the operation ends early', () => {
    const items = reduce([{ type: 'textDelta', text: 'Hi' }]);
    expect(finishStreaming(items)[0]).toMatchObject({ streaming: false, text: 'Hi' });
    const done = reduce([{ type: 'text', text: 'Hi' }]);
    expect(finishStreaming(done)).toBe(done);
  });
});

describe('capture items', () => {
  it('keep the text, the line range and the highlighted text in the history', () => {
    const item = captureItem({
      sourcePath: 'docs/a.md',
      firstLine: 40,
      lastLine: 58,
      text: 'Some **text**',
      selection: 'Some text',
    });
    if (item.kind !== 'capture') throw new Error('not a capture item');
    expect(captureLabel(item)).toBe('docs/a.md lines 40–58');
    const stored = toStoredItems([item]);
    expect(stored[0]).toMatchObject({ kind: 'capture', firstLine: 40, text: 'Some **text**' });
    expect(fromStoredItems(stored)[0]).toMatchObject({
      kind: 'capture',
      sourcePath: 'docs/a.md',
      lastLine: 58,
      selection: 'Some text',
    });
  });

  it('keep a region without a highlighted text', () => {
    const item = captureItem({ sourcePath: 'a.md', firstLine: 1, lastLine: 1, text: '# A' });
    const restored = fromStoredItems(toStoredItems([item]))[0];
    expect(restored).toMatchObject({ kind: 'capture', text: '# A' });
    expect(restored && 'selection' in restored).toBe(false);
  });
});
