// Budgets of the AI features (plan phase 3, step 22): a 400-item conversation updates in under
// 50 ms per event, and a 5 000-line document diffs in under 200 ms. The assertions use 3x the
// budget so a loaded CI machine does not flake; the measured numbers are logged.

import { act, render } from '@testing-library/react';
import { Tooltip } from 'radix-ui';
import { describe, expect, it } from 'vitest';
import { useAiConversation } from '../../stores/aiConversation';
import { buildEditReview, buildWriteReview } from '../diff/changes';
import { Transcript } from './Transcript';
import { applyEvent } from './timeline';
import type { ChatItem } from './timeline';

const SLACK = 3;

function conversation(count: number): ChatItem[] {
  const items: ChatItem[] = [];
  for (let i = 0; items.length < count; i++) {
    items.push({ kind: 'user', id: `u${String(i)}`, text: `Question ${String(i)} about the docs` });
    items.push({
      kind: 'tool',
      id: `t${String(i)}`,
      tool: 'Read',
      summary: `Read docs/file-${String(i)}.md`,
      input: {},
      result: 'x'.repeat(500),
    });
    items.push({
      kind: 'assistant',
      id: `a${String(i)}`,
      text: `Answer ${String(i)}. `.repeat(30),
      streaming: false,
    });
    items.push({
      kind: 'usage',
      id: `s${String(i)}`,
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.01,
      durationMs: 2000,
    });
  }
  return items.slice(0, count);
}

function bigDocument(lines: number, tweak: boolean): string {
  const out: string[] = [];
  let n = 0;
  while (out.length < lines) {
    n++;
    out.push(`## Section ${String(n)}`, '');
    out.push(
      `Paragraph ${String(n)}${tweak && n % 50 === 0 ? ' changed' : ''} with some **bold** text and a [link](other.md).`,
      '',
    );
    out.push(`- item ${String(n)}a`, `- item ${String(n)}b`, '');
    out.push('```ts', `const x${String(n)} = ${String(n)};`, '```', '');
  }
  return out.slice(0, lines).join('\n') + '\n';
}

describe('performance budgets', () => {
  it('updates a 400-item conversation in under 50 ms per event', () => {
    useAiConversation.setState({ items: conversation(400) });
    render(
      <Tooltip.Provider>
        <Transcript />
      </Tooltip.Provider>,
    );
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      act(() => {
        useAiConversation.setState((s) => ({
          items: applyEvent(s.items, { type: 'textDelta', text: 'more ' }),
        }));
      });
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[10] ?? 0;
    console.info(`transcript: 400 items, median ${median.toFixed(1)} ms per event`);
    expect(median).toBeLessThan(50 * SLACK);
    useAiConversation.getState().newConversation();
  });

  it('diffs a 5 000-line document in under 200 ms', () => {
    const before = bigDocument(5000, false);
    const after = bigDocument(5000, true);
    let start = performance.now();
    const write = buildWriteReview(before, after);
    const writeMs = performance.now() - start;
    start = performance.now();
    const edit = buildEditReview(before, [
      { oldText: 'Paragraph 50 with', newText: 'Paragraph 50 changed with' },
    ]);
    const editMs = performance.now() - start;
    console.info(
      `diff: 5000 lines, write ${writeMs.toFixed(0)} ms (${String(write.units.length)} units), edit ${editMs.toFixed(0)} ms (${String(edit.units.length)} units)`,
    );
    expect(write.units.length).toBeGreaterThan(5);
    expect(writeMs).toBeLessThan(200 * SLACK);
    expect(editMs).toBeLessThan(200 * SLACK);
  });
});
