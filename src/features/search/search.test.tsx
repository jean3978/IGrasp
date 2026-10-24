import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import type { FileMatches } from '../../ipc/types';
import { startEventBridge } from '../../stores/eventBridge';
import { matchedTexts, mergeResults, useSearch } from '../../stores/search';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { MatchText, SearchPanel } from './SearchPanel';

const file = (relPath: string, lines: number[]): FileMatches => ({
  relPath,
  matches: lines.map((line) => ({ line, text: `line ${String(line)}`, ranges: [[0, 4]] })),
});

describe('search helpers', () => {
  it('merges batches by path, sorted, appending matches of a known file', () => {
    const merged = mergeResults([file('b.md', [1])], [file('a.md', [2]), file('b.md', [5])]);
    expect(merged.map((f) => [f.relPath, f.matches.map((m) => m.line)])).toEqual([
      ['a.md', [2]],
      ['b.md', [1, 5]],
    ]);
  });

  it('extracts the matched texts of a line', () => {
    expect(
      matchedTexts({
        line: 1,
        text: 'agent and Agent',
        ranges: [
          [0, 5],
          [10, 15],
        ],
      }),
    ).toEqual(['agent', 'Agent']);
  });

  it('renders matches as marks, trimming leading whitespace', () => {
    const { container } = render(
      <MatchText match={{ line: 3, text: '    see the agent', ranges: [[12, 17]] }} />,
    );
    expect(container.textContent).toBe('see the agent');
    expect(container.querySelector('mark')?.textContent).toBe('agent');
  });
});

describe('SearchPanel', () => {
  let stop: () => void = () => undefined;

  beforeEach(async () => {
    window.__igraspMock?.reset();
    useTabs.setState({ tabs: [], activeId: null });
    useSearch.setState({
      query: '',
      matchCase: false,
      wholeWord: false,
      regex: false,
      include: '',
      exclude: '',
      history: [],
    });
    stop = await startEventBridge();
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await vi.waitFor(() => {
      expect(useWorkspace.getState().index.state).toBe('ready');
      // The mock restarts its generations after reset(): wait for its own index too.
      expect(window.__igraspMock?.state.index).not.toBeNull();
    });
  });

  afterEach(async () => {
    stop();
    await useWorkspace.getState().closeRoot();
  });

  const renderPanel = () =>
    render(
      <Tooltip.Provider>
        <SearchPanel />
      </Tooltip.Provider>,
    );

  it('searches as you type and opens a match at its line', async () => {
    renderPanel();
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'markdown');
    expect(await screen.findByText(/results? in \d+ files?$/)).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    const first = useSearch.getState().results[0];
    if (!first) throw new Error('no results');
    useSearch.getState().openMatch({ path: first.relPath, index: 0 });
    expect(useTabs.getState().tabs[0]).toMatchObject({
      relPath: first.relPath,
      pending: { line: first.matches[0]?.line, highlight: ['markdown'] },
    });
  });

  it('toggles options with Alt+C / Alt+W / Alt+R and shows invalid patterns', async () => {
    renderPanel();
    const box = screen.getByRole('textbox', { name: 'Search' });
    await userEvent.type(box, '(unclosed');
    await userEvent.keyboard('{Alt>}r{/Alt}');
    expect(useSearch.getState().regex).toBe(true);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await userEvent.keyboard('{Alt>}c{/Alt}{Alt>}w{/Alt}');
    expect(useSearch.getState()).toMatchObject({ matchCase: true, wholeWord: true });
  });

  it('filters with include and exclude globs', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Toggle Search Details' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'files to include' }), 'docs');
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'the');
    await waitFor(() => {
      expect(useSearch.getState().status).toBe('done');
    });
    const paths = useSearch.getState().results.map((f) => f.relPath);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.startsWith('docs/'))).toBe(true);
  });

  it('steps through matches with F4 and drops files deleted on disk', async () => {
    useSearch.getState().setQuery('markdown');
    await useSearch.getState().run();
    await waitFor(() => {
      expect(useSearch.getState().status).toBe('done');
    });
    const refs = useSearch.getState().results.flatMap((f) => f.matches.map(() => f.relPath));
    useSearch.getState().step(1);
    useSearch.getState().step(1);
    expect(useTabs.getState().tabs[0]?.relPath).toBe(refs[1]);
    useSearch.getState().step(-1);
    expect(useSearch.getState().selected).toMatchObject({ path: refs[0] });
    window.__igraspMock?.deleteFiles(['README.md']);
    await waitFor(() => {
      expect(useSearch.getState().results.some((f) => f.relPath === 'README.md')).toBe(false);
    });
  });

  it('remembers the query history with the arrow keys', async () => {
    renderPanel();
    const box = screen.getByRole('textbox', { name: 'Search' });
    await userEvent.type(box, 'first{Enter}');
    await userEvent.clear(box);
    await userEvent.type(box, 'second{Enter}');
    await userEvent.clear(box);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(box).toHaveValue('first');
  });
});
