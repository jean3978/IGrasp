import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '../../ipc/client';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { startEventBridge } from '../../stores/eventBridge';
import { useGraph } from '../../stores/graph';
import { useHistory } from '../../stores/history';
import { recentFiles, useQuickOpen } from '../../stores/quickOpen';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { Highlighted, QuickOpenDialog } from './QuickOpenDialog';

let stop: () => void = () => undefined;

beforeEach(async () => {
  window.__igraspMock?.reset();
  useTabs.setState({ tabs: [], activeId: null });
  useHistory.getState().clear();
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await vi.waitFor(() => {
    expect(useGraph.getState().status.ready).toBe(true);
  });
});

afterEach(async () => {
  useQuickOpen.getState().close();
  stop();
  await useWorkspace.getState().closeRoot();
});

describe('quick open store', () => {
  it('lists recent files from the history, most recent first, without duplicates', () => {
    for (const p of ['a.md', 'b.md', 'a.md', 'c.md']) {
      useHistory.getState().record({ relPath: p, kind: 'document' });
    }
    useHistory.getState().record({ relPath: 'src/x.rs', kind: 'code' });
    expect(recentFiles()).toEqual(['c.md', 'a.md', 'b.md']);
  });

  it('drops answers older than the latest request', async () => {
    const real = backend.searchSymbols.bind(backend);
    let release: () => void = () => undefined;
    const spy = vi
      .spyOn(backend, 'searchSymbols')
      .mockImplementationOnce(async (r) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ...(await real(r)), files: [] };
      })
      .mockImplementation(real);
    useQuickOpen.setState({ query: 'arch' });
    const slow = useQuickOpen.getState().search();
    await useQuickOpen.getState().search();
    release();
    await slow;
    expect(useQuickOpen.getState().files[0]?.relPath).toBe('docs/architecture.md');
    spy.mockRestore();
  });
});

describe('QuickOpenDialog', () => {
  it('finds a heading and opens its document scrolled to it', async () => {
    render(<QuickOpenDialog />);
    useQuickOpen.getState().openDialog();
    const box = await screen.findByRole('combobox');
    await userEvent.type(box, '#install');
    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });
    expect(box).toHaveAttribute('aria-activedescendant', 'quick-open-0');
    await userEvent.keyboard('{Enter}');
    expect(useQuickOpen.getState().open).toBe(false);
    expect(useTabs.getState().tabs[0]).toMatchObject({
      relPath: 'docs/guide/getting-started.md',
      pending: { anchor: 'install' },
    });
  });

  it('moves with the arrows and pins with Ctrl+Enter', async () => {
    render(<QuickOpenDialog />);
    useQuickOpen.getState().openDialog('md');
    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBeGreaterThan(2);
    });
    const second = useQuickOpen.getState().files[1]?.relPath;
    await userEvent.keyboard('{ArrowDown}{Control>}{Enter}{/Control}');
    expect(useTabs.getState().tabs[0]).toMatchObject({ relPath: second, pinned: true });
  });

  it('highlights matched characters', () => {
    const { container } = render(<Highlighted text="architecture" matched={[0, 1, 2, 3]} />);
    expect(container.querySelector('mark')?.textContent).toBe('arch');
  });
});
