import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { useOutline } from '../../stores/outline';
import { useTabs } from '../../stores/tabs';
import { renderMarkdown } from '../preview/pipeline/processor';
import { activeIndex, buildOutline, visibleOutline } from './outline';
import { OutlinePanel } from './OutlinePanel';

const DOC = `# Title

## Install

### Windows

### Linux

#### Ubuntu

## Usage

###### Deep, skipping levels

# Appendix
`;

const outlineOf = async (markdown: string) => buildOutline((await renderMarkdown(markdown)).hast);

describe('outline', () => {
  it('nests headings by level, skipped levels under the nearest shallower one', async () => {
    const items = await outlineOf(DOC);
    expect(items.map((i) => [i.text, i.depth, i.hasChildren])).toEqual([
      ['Title', 0, true],
      ['Install', 1, true],
      ['Windows', 2, false],
      ['Linux', 2, true],
      ['Ubuntu', 3, false],
      ['Usage', 1, true],
      ['Deep, skipping levels', 2, false],
      ['Appendix', 0, false],
    ]);
    expect(items[1]?.id).toBe('user-content-install');
  });

  it('hides collapsed sections and keeps ancestors of filter matches', async () => {
    const items = await outlineOf(DOC);
    const install = items[1]?.id ?? '';
    expect(visibleOutline(items, new Set([install]), '').map((i) => i.text)).toEqual([
      'Title',
      'Install',
      'Usage',
      'Deep, skipping levels',
      'Appendix',
    ]);
    expect(visibleOutline(items, new Set([install]), 'ubu').map((i) => i.text)).toEqual([
      'Title',
      'Install',
      'Linux',
      'Ubuntu',
    ]);
  });

  it('finds the section at the top of the viewport by binary search', () => {
    const offsets = [0, 400, 900, 2000];
    expect(activeIndex(offsets, 0)).toBe(0);
    expect(activeIndex(offsets, 395)).toBe(1);
    expect(activeIndex(offsets, 1999)).toBe(3);
    expect(activeIndex([100], 0)).toBe(-1);
  });

  it('builds 2,000 headings quickly', async () => {
    const big = Array.from({ length: 2000 }, (_, i) => `${'#'.repeat((i % 4) + 1)} H${String(i)}`);
    const { hast } = await renderMarkdown(big.join('\n\n'));
    const started = performance.now();
    expect(buildOutline(hast)).toHaveLength(2000);
    expect(performance.now() - started).toBeLessThan(300);
  });
});

describe('OutlinePanel', () => {
  beforeEach(async () => {
    useTabs.setState({ tabs: [], activeId: null });
    useOutline.setState({ byPath: {}, collapsed: {}, filter: '' });
    useTabs.getState().openDocument('a.md');
    useOutline.getState().setOutline('a.md', await outlineOf(DOC));
  });

  it('shows a tree that filters and collapses with the keyboard', async () => {
    render(
      <Tooltip.Provider>
        <OutlinePanel />
      </Tooltip.Provider>,
    );
    const tree = screen.getByRole('tree', { name: 'Outline' });
    expect(screen.getAllByRole('treeitem')).toHaveLength(8);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter headings' }), 'win');
    expect(screen.getAllByRole('treeitem').map((r) => r.textContent)).toEqual([
      'Title',
      'Install',
      'Windows',
    ]);
    await userEvent.clear(screen.getByRole('searchbox'));
    tree.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowLeft}');
    await waitFor(() => {
      expect(screen.getAllByRole('treeitem')).toHaveLength(5);
    });
  });

  it('says when there is no document or no heading', () => {
    useOutline.getState().setOutline('a.md', []);
    render(<OutlinePanel />);
    expect(screen.getByText('No headings.')).toBeInTheDocument();
  });
});
