import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '../../ipc/client';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { startEventBridge } from '../../stores/eventBridge';
import { useGraph } from '../../stores/graph';
import { useTabs } from '../../stores/tabs';
import { useTree } from '../../stores/tree';
import { useWorkspace } from '../../stores/workspace';
import { BrokenLinksPanel } from './BrokenLinksPanel';
import { BrokenLinksBadge, BrokenLinksStatus } from './BrokenLinksStatus';

let stop: () => void = () => undefined;

beforeEach(async () => {
  window.__igraspMock?.reset();
  useTabs.setState({ tabs: [], activeId: null });
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await vi.waitFor(() => {
    expect(useGraph.getState().status.ready).toBe(true);
  });
});

afterEach(async () => {
  stop();
  await useWorkspace.getState().closeRoot();
});

const renderPanel = () =>
  render(
    <Tooltip.Provider>
      <BrokenLinksPanel />
      <BrokenLinksStatus />
      <BrokenLinksBadge />
    </Tooltip.Provider>,
  );

describe('BrokenLinksPanel', () => {
  it('lists the broken links by document with kind filters', async () => {
    renderPanel();
    expect(await screen.findByText('3 broken links in 2 files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3 broken links/ })).toBeInTheDocument();
    expect(screen.getByLabelText('3 broken links')).toHaveTextContent('3');
    expect(screen.getByText('old design')).toBeInTheDocument();
    expect(screen.getByText('→ docs/architecture.md')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Wrong case/ }));
    expect(screen.queryByText('→ docs/architecture.md')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[role=treeitem][aria-level="2"]')).toHaveLength(2);
  });

  it('opens the source document at the line of the link', async () => {
    renderPanel();
    await userEvent.click(await screen.findByText('old design'));
    const tab = useTabs.getState().tabs[0];
    expect(tab?.relPath).toBe('docs/architecture.md');
    expect(tab?.pending).toMatchObject({
      line: expect.any(Number) as number,
      highlight: ['old design'],
    });
  });

  it('follows changes on disk', async () => {
    renderPanel();
    await screen.findByText('3 broken links in 2 files');
    window.__igraspMock?.writeFiles({ 'docs/old-design.md': '# Old design\n' });
    expect(await screen.findByText('2 broken links in 1 file')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /2 broken links/ })).toBeInTheDocument();
    });
  });
});

describe('graph store', () => {
  it('refreshes only the open documents a change touches', async () => {
    const spy = vi.spyOn(useGraph.getState(), 'refreshDoc');
    await useGraph.getState().refreshDoc('README.md');
    await useGraph.getState().refreshDoc('docs/architecture.md');
    spy.mockClear();
    useGraph.getState().onChanged({
      generation: useWorkspace.getState().index.generation,
      docs: ['docs/architecture.md'],
      removed: [],
      brokenCount: 7,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('docs/architecture.md');
    expect(useGraph.getState().status.brokenCount).toBe(7);
  });

  it('fetches the links and backlinks of open documents again after a rescan', async () => {
    await useGraph.getState().refreshDoc('docs/architecture.md');
    await useGraph.getState().refreshBacklinks('README.md');
    const before = useWorkspace.getState().index.generation;
    await useTree.getState().setShowDotfiles(true);
    await vi.waitFor(() => {
      expect(useWorkspace.getState().index.generation).not.toBe(before);
      expect(useGraph.getState().status.ready).toBe(true);
    });
    await vi.waitFor(() => {
      const links = useGraph.getState().linksByDoc['docs/architecture.md'] ?? {};
      expect(Object.keys(links).length).toBeGreaterThan(0);
      expect(useGraph.getState().backlinks['README.md']).toBeDefined();
    });
  });

  it('keeps the newest response when two requests for a document overlap', async () => {
    const links = (href: string) => ({
      relPath: 'a.md',
      graphReady: true,
      links: [
        {
          href,
          text: href,
          line: 1,
          target: { kind: 'external' as const, url: href },
          status: { kind: 'ok' as const },
        },
      ],
    });
    let resolveOld: (v: ReturnType<typeof links>) => void = () => undefined;
    vi.spyOn(backend, 'getDocLinks')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(links('new'));
    const old = useGraph.getState().refreshDoc('a.md');
    await useGraph.getState().refreshDoc('a.md');
    resolveOld(links('old'));
    await old;
    expect(Object.keys(useGraph.getState().linksByDoc['a.md'] ?? {})).toEqual(['new']);
  });

  it('ignores events of another scan generation', () => {
    useGraph.getState().onChanged({ generation: 999, docs: [], removed: [], brokenCount: 42 });
    expect(useGraph.getState().status.brokenCount).not.toBe(42);
  });
});
