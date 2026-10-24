import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from '../MarkdownPreview';
import { renderMarkdown } from './processor';

async function show(markdown: string) {
  const rendered = await renderMarkdown(markdown);
  return render(<MarkdownPreview rendered={rendered} />).container;
}

describe('math', () => {
  it('renders inline and display math with KaTeX', async () => {
    const container = await show('Euler: $e^{i\\pi} + 1 = 0$\n\n$$\n\\frac{1}{3}\n$$');
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelector('.katex-display')).not.toBeNull();
    // MathML is kept for screen readers.
    expect(container.querySelector('math')).not.toBeNull();
  });

  it('shows invalid TeX as an error instead of failing', async () => {
    const container = await show('Bad: $\\frac{1}{$ and after');
    expect(container.textContent).toContain('and after');
    expect(container.querySelector('.katex-error')).not.toBeNull();
  });

  it('keeps dollar amounts as text, like GitHub', async () => {
    const container = await show('Costs $5 and $10.');
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toBe('Costs $5 and $10.');
  });
});
