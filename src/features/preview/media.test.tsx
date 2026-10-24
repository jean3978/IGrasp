import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { classifyLink } from './links';
import { MarkdownPreview } from './MarkdownPreview';
import { renderMarkdown } from './pipeline/processor';

async function show(markdown: string, relPath = 'docs/guide/page.md') {
  const rendered = await renderMarkdown(markdown);
  return render(<MarkdownPreview rendered={rendered} relPath={relPath} rootPath={FIXTURE_ROOT} />)
    .container;
}

const opened = () => window.__igraspMock?.state.opened ?? [];

beforeEach(() => {
  window.__igraspMock?.reset();
  useTabs.setState({ tabs: [], activeId: null });
});

describe('links', () => {
  it('classifies anchors, web links, documents and other files', () => {
    expect(classifyLink('a.md', '#install')).toEqual({ kind: 'anchor', id: 'install' });
    expect(classifyLink('a.md', 'https://x.org')).toEqual({
      kind: 'external',
      url: 'https://x.org',
    });
    expect(classifyLink('a.md', 'mailto:me@x.org').kind).toBe('external');
    expect(classifyLink('docs/a.md', '../README.md#top')).toEqual({
      kind: 'document',
      relPath: 'README.md',
    });
    expect(classifyLink('a.md', 'src/main.rs#L3-L5')).toEqual({
      kind: 'code',
      relPath: 'src/main.rs',
      fragment: 'L3-L5',
    });
    expect(classifyLink('a.md', 'javascript:alert(1)').kind).toBe('unsupported');
  });

  it('opens web links in the system browser', async () => {
    const container = await show('[site](https://example.com)');
    const link = container.querySelector('a');
    if (!link) throw new Error('no link');
    fireEvent.click(link);
    expect(opened()).toEqual(['https://example.com']);
  });

  it('opens an existing linked markdown file in a tab', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await waitFor(() => {
      expect(window.__igraspMock?.state.index).not.toBeNull();
    });
    const container = await show('[arch](../architecture.md) and [gone](../missing.md)');
    const [arch, gone] = container.querySelectorAll('a');
    if (!arch || !gone) throw new Error('links missing');
    fireEvent.click(gone);
    fireEvent.click(arch);
    await waitFor(() => {
      expect(useTabs.getState().tabs.map((t) => t.relPath)).toEqual(['docs/architecture.md']);
    });
  });

  it('marks links to source files for the code viewer', async () => {
    const container = await show('[code](../../src/main.ts)');
    expect(container.querySelector('a')?.dataset.link).toBe('code');
  });
});

describe('media', () => {
  it('shows a placeholder for images outside the folder', async () => {
    const container = await show('![x](../../../outside.png)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('outside the opened folder');
  });

  it('shows a placeholder when an image fails to load', async () => {
    const container = await show('![missing](nope.png)');
    const img = container.querySelector('img');
    if (!img) throw new Error('no img');
    fireEvent.error(img);
    expect(await screen.findByRole('img', { name: /Image not found: nope.png/ })).toBeTruthy();
  });

  it('replaces an unplayable video with a card that opens it externally', async () => {
    const container = await show('<video src="demo.mp4"></video>');
    const video = container.querySelector('video');
    if (!video) throw new Error('no video');
    fireEvent.error(video);
    fireEvent.click(await screen.findByRole('button', { name: /Open externally/ }));
    expect(opened()).toEqual(['docs/guide/demo.mp4']);
  });

  it('handles <source> children', async () => {
    const container = await show('<video controls><source src="b.webm" type="video/webm"></video>');
    const source = container.querySelector('source');
    expect(source?.getAttribute('src')).toContain(encodeURIComponent('docs/guide/b.webm'));
    if (!source) throw new Error('no source');
    fireEvent.error(source);
    expect(await screen.findByText('b.webm')).toBeTruthy();
  });
});
