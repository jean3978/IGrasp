import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from './MarkdownPreview';
import { blockForLine } from './pipeline/lines';
import { renderMarkdown } from './pipeline/processor';
import { findAnchor, revealPending } from './reveal';

const SOURCE = `---
title: x
---

# Title

First paragraph
on two lines.

- item one
- item two

## Second Part

\`\`\`ts
const a = 1;
\`\`\`
`;

async function show(markdown: string) {
  const rendered = await renderMarkdown(markdown);
  const { container } = render(
    <div className="document-scroll">
      <MarkdownPreview rendered={rendered} />
    </div>,
  );
  return container.firstElementChild as HTMLElement;
}

describe('source lines in the preview', () => {
  it('marks blocks with the line they start on, front matter included', async () => {
    const root = await show(SOURCE);
    expect(root.querySelector('h1')?.dataset.line).toBe('5');
    expect(root.querySelector('p')?.dataset.line).toBe('7');
    expect(root.querySelector('li')?.dataset.line).toBe('10');
    expect(root.querySelector('pre')?.dataset.line).toBe('15');
  });

  it('finds the block for a line inside it', async () => {
    const root = await show(SOURCE);
    expect(blockForLine(root, 8)?.tagName).toBe('P');
    expect(blockForLine(root, 11)?.textContent).toBe('item two');
    expect(blockForLine(root, 16)?.tagName).toBe('PRE');
    expect(blockForLine(root, 1)).toBeNull();
  });
});

describe('revealing a pending target', () => {
  it('scrolls to anchors, also ignoring case, and flashes them', async () => {
    const root = await show(SOURCE);
    expect(findAnchor(root, 'Second-Part')?.tagName).toBe('H2');
    expect(revealPending(root, { anchor: 'second-part' })).toBe(true);
    await waitFor(() => {
      expect(root.querySelector('h2')?.classList.contains('flash')).toBe(true);
    });
    expect(revealPending(root, { anchor: 'missing' })).toBe(false);
  });

  it('scrolls to the block of a line', async () => {
    const root = await show(SOURCE);
    expect(revealPending(root, { line: 8, highlight: ['two lines'] })).toBe(true);
    expect(root.querySelector('p')?.classList.contains('flash')).toBe(true);
  });
});
