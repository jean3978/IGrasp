import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from '../MarkdownPreview';
import { renderMarkdown } from './processor';

async function show(markdown: string) {
  const rendered = await renderMarkdown(markdown);
  return render(<MarkdownPreview rendered={rendered} />).container;
}

describe('code highlighting', () => {
  it('highlights known languages with all themes as CSS variables', async () => {
    const container = await show('```ts\nconst answer: number = 42;\n```');
    const pre = container.querySelector('pre');
    expect(pre?.classList.contains('shiki')).toBe(true);
    expect(pre?.dataset.language).toBe('ts');
    const token = container.querySelector<HTMLElement>('pre span span');
    const style = token?.getAttribute('style') ?? '';
    expect(style).toContain('--shiki-light');
    expect(style).toContain('--shiki-dark');
    expect(style).toContain('--shiki-hc');
    expect(pre?.textContent).toBe('const answer: number = 42;');
  });

  it('leaves unknown languages as plain text with their name', async () => {
    const container = await show('```no-such-language\nplain\n```');
    const pre = container.querySelector('pre');
    expect(pre?.classList.contains('shiki')).toBe(false);
    expect(pre?.dataset.language).toBe('no-such-language');
    expect(pre?.textContent).toBe('plain\n');
  });

  it('does not highlight Mermaid blocks', async () => {
    const container = await show('```mermaid\ngraph TD; A-->B\n```');
    expect(container.querySelector('pre.shiki')).toBeNull();
  });

  it('adds a copy button to every code block', async () => {
    const container = await show('```\nno language\n```');
    expect(container.querySelector('button[aria-label="Copy code"]')).not.toBeNull();
  });

  it('keeps user-written styles out even next to highlighted code', async () => {
    const container = await show('<pre style="color:red"><code>x</code></pre>\n\n```js\n1\n```');
    const pres = container.querySelectorAll('pre');
    expect(pres[0]?.getAttribute('style')).toBeNull();
    expect(pres[1]?.getAttribute('style')).toContain('--shiki');
  });
});
