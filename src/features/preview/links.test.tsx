import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import type { LinkInfo } from '../../ipc/types';
import { byHref, useGraph } from '../../stores/graph';
import { useTabs } from '../../stores/tabs';
import { useUi } from '../../stores/ui';
import { useWorkspace } from '../../stores/workspace';
import { linkProblem, statusFlag } from './links';
import { MarkdownPreview } from './MarkdownPreview';
import { renderMarkdown } from './pipeline/processor';

const DOC = 'docs/guide/getting-started.md';

const link = (href: string, info: Omit<LinkInfo, 'href' | 'text' | 'line'>): LinkInfo => ({
  href,
  text: href,
  line: 1,
  ...info,
});

async function show(markdown: string) {
  const rendered = await renderMarkdown(markdown);
  return render(<MarkdownPreview rendered={rendered} relPath={DOC} rootPath={FIXTURE_ROOT} />)
    .container;
}

beforeEach(() => {
  window.__igraspMock?.reset();
  useTabs.setState({ tabs: [], activeId: null });
  useGraph.getState().reset();
});

describe('link problems', () => {
  it('explains each status', () => {
    expect(
      linkProblem({
        target: { kind: 'document', relPath: 'a.md', fragment: 'x' },
        status: { kind: 'missingAnchor' },
      }),
    ).toBe('Heading not found: #x in a.md');
    expect(
      linkProblem({
        target: { kind: 'file', relPath: 'src/x.rs', fragment: null },
        status: { kind: 'missingFile' },
      }),
    ).toBe('File not found: src/x.rs');
    expect(
      linkProblem({
        target: { kind: 'document', relPath: 'a.md', fragment: null },
        status: { kind: 'caseMismatch', actual: 'a.md' },
      }),
    ).toContain('Wrong case');
    expect(statusFlag({ kind: 'caseMismatch', actual: 'a' })).toBe('warning');
    expect(statusFlag({ kind: 'notChecked' })).toBeUndefined();
  });

  it('keeps the flag when the same href appears twice', () => {
    const ok = link('a.md', {
      target: { kind: 'document', relPath: 'a.md', fragment: null },
      status: { kind: 'ok' },
    });
    const bad = { ...ok, status: { kind: 'missingFile' as const } };
    expect(byHref([ok, bad])['a.md']?.status.kind).toBe('missingFile');
  });
});

describe('links in the preview', () => {
  it('flags broken links from the graph without re-rendering the document', async () => {
    const container = await show('[gone](missing.md) and [fine](../architecture.md)');
    const [gone, fine] = container.querySelectorAll('a');
    expect(gone?.dataset.status).toBeUndefined();
    useGraph.setState({
      linksByDoc: {
        [DOC]: byHref([
          link('missing.md', {
            target: { kind: 'document', relPath: 'docs/guide/missing.md', fragment: null },
            status: { kind: 'missingFile' },
          }),
        ]),
      },
    });
    await waitFor(() => {
      expect(gone?.dataset.status).toBe('broken');
    });
    expect(gone?.title).toBe('File not found: docs/guide/missing.md');
    expect(fine?.dataset.status).toBeUndefined();
    // Same DOM node: the markdown was not rendered again.
    expect(container.querySelector('a')).toBe(gone);
  });

  it('opens a linked document at its heading, pinned with Ctrl', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await waitFor(() => {
      expect(window.__igraspMock?.state.index).not.toBeNull();
    });
    const container = await show('[arch](../architecture.md#components)');
    const a = container.querySelector('a');
    if (!a) throw new Error('no link');
    fireEvent.click(a, { ctrlKey: true });
    await waitFor(() => {
      expect(useTabs.getState().tabs[0]).toMatchObject({
        relPath: 'docs/architecture.md',
        pinned: true,
        pending: { anchor: 'components' },
      });
    });
  });

  it('shows the target in the status bar while hovered', async () => {
    const container = await show('[code](../../src/main.ts#L3)');
    const a = container.querySelector('a');
    if (!a) throw new Error('no link');
    fireEvent.mouseEnter(a);
    expect(useUi.getState().hoveredLink).toBe('src/main.ts#L3');
    fireEvent.mouseLeave(a);
    expect(useUi.getState().hoveredLink).toBeNull();
  });
});
