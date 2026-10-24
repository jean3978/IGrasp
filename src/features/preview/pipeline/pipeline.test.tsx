import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import gfm from '../../../test/fixtures/markdown/gfm.md?raw';
import unsafe from '../../../test/fixtures/markdown/unsafe.md?raw';
import { MarkdownPreview } from '../MarkdownPreview';
import { renderMarkdown } from './processor';

const FIXTURES: Record<string, string> = { 'gfm.md': gfm, 'unsafe.md': unsafe };
const fixture = (name: string) => FIXTURES[name] ?? '';

async function show(markdown: string) {
  const rendered = await renderMarkdown(markdown);
  const { container } = render(<MarkdownPreview rendered={rendered} />);
  return { container, rendered };
}

describe('markdown pipeline', () => {
  it('renders GitHub Flavored Markdown', async () => {
    const { container } = await show(fixture('gfm.md'));
    expect(container.querySelector('del')?.textContent).toBe('deleted');
    expect(container.querySelector('a[href="https://example.com"]')).not.toBeNull();
    // Column alignment becomes a trusted text-align style when converted to React.
    const headers = container.querySelectorAll<HTMLElement>('table th');
    expect([...headers].map((h) => h.style.textAlign)).toEqual(['left', 'center']);
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect([...boxes].map((b) => b.checked)).toEqual([true, false]);
    expect(boxes[0]?.disabled).toBe(true);
    expect(container.querySelector('section.footnotes')).not.toBeNull();
  });

  it('prefixes heading and footnote ids once', async () => {
    const { container } = await show(fixture('gfm.md'));
    expect(container.querySelector('h2')?.id).toBe('user-content-second-heading');
    const ref = container.querySelector('a[data-footnote-ref]');
    expect(ref?.getAttribute('href')).toBe('#fn-note');
    expect(container.querySelector('#user-content-fn-note')).not.toBeNull();
  });

  it('turns GitHub alerts into alert blocks', async () => {
    const { container } = await show('> [!WARNING]\n> Careful.\n\n> [!TIP]\n> Nice.');
    const alerts = container.querySelectorAll('.markdown-alert');
    expect([...alerts].map((a) => a.className)).toEqual([
      'markdown-alert markdown-alert-warning',
      'markdown-alert markdown-alert-tip',
    ]);
    expect(alerts[0]?.querySelector('.markdown-alert-title')?.textContent).toBe('Warning');
    expect(alerts[0]?.textContent).toContain('Careful.');
  });

  it('extracts YAML front matter into a card', async () => {
    const { container, rendered } = await show('---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body');
    expect(rendered.frontMatter?.data).toEqual({ title: 'Hello', tags: ['a', 'b'] });
    expect(container.querySelector('.front-matter')?.textContent).toContain('Hello');
    expect([...container.querySelectorAll('.fm-chip')].map((c) => c.textContent)).toEqual([
      'a',
      'b',
    ]);
    // The YAML is not rendered as a thematic break and text.
    expect(container.querySelector('hr')).toBeNull();
  });

  it('reports invalid front matter instead of failing', async () => {
    const { container } = await show('---\ntitle: [unclosed\n---\n\nText');
    expect(container.querySelector('.fm-error')).not.toBeNull();
    expect(container.textContent).toContain('Text');
  });

  it('strips scripts, event handlers, styles and dangerous URLs', async () => {
    const { container } = await show(fixture('unsafe.md'));
    const html = container.innerHTML;
    expect(container.querySelector('script, iframe')).toBeNull();
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(');
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.querySelector('.evil')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container.textContent).toContain('bad link');
  });

  it('only allows https remote media and keeps relative paths', async () => {
    const { container } = await show(fixture('unsafe.md'));
    const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(srcs).not.toContain('http://example.com/a.png');
    expect(srcs).toContain('https://example.com/b.png');
    // Relative paths go through the backend's asset URLs (the mock encodes the path).
    expect(srcs.some((s) => s?.includes(encodeURIComponent('images/c.png')))).toBe(true);
    expect(container.querySelector('video')?.getAttribute('src')).toContain('clip.mp4');
    expect(container.textContent).toContain('Blocked insecure (http) image');
    expect(container.querySelector('details kbd')?.textContent).toBe('Ctrl');
  });
});
