import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMarkdown } from './useMarkdown';

const rendered = async (content: string, scope: 'document' | 'chat' = 'document') => {
  const { result } = renderHook(() => useMarkdown(content, scope));
  await waitFor(() => {
    expect(result.current.rendered).not.toBeNull();
  });
};

describe('useMarkdown', () => {
  it('keeps the documents cached however many chat answers are rendered', async () => {
    await rendered('# A document\n\nWith a paragraph.');
    for (let i = 0; i < 25; i++) await rendered(`Answer number ${String(i)}.`, 'chat');
    // Still cached: the render is there at once, without waiting for the pipeline.
    const { result } = renderHook(() => useMarkdown('# A document\n\nWith a paragraph.'));
    expect(result.current.rendered).not.toBeNull();
  });

  it('keeps the previous render on screen while the next version renders', async () => {
    const { result, rerender } = renderHook(({ text }) => useMarkdown(text), {
      initialProps: { text: '# One' },
    });
    await waitFor(() => {
      expect(result.current.rendered).not.toBeNull();
    });
    const first = result.current.rendered;
    rerender({ text: '# Two, a new version' });
    expect(result.current.rendered).toBe(first);
    await waitFor(() => {
      expect(result.current.rendered).not.toBe(first);
    });
  });
});
