import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { useTabs } from '../../stores/tabs';
import { useTextFiles } from '../../stores/textFiles';
import { useWorkspace } from '../../stores/workspace';
import { CodeTab } from './CodeTab';
import { formatSize, parseLineFragment, splitLines } from './codeLines';
import { languageOf } from './languages';

describe('code viewer helpers', () => {
  it('maps file names and extensions to languages', () => {
    expect(languageOf('src/main.rs')).toBe('rust');
    expect(languageOf('a/B.TSX')).toBe('tsx');
    expect(languageOf('Makefile')).toBe('make');
    expect(languageOf('docker/Dockerfile')).toBe('docker');
    expect(languageOf('CMakeLists.txt')).toBe('cmake');
    expect(languageOf('notes.unknownext')).toBeNull();
    expect(languageOf('.hidden')).toBeNull();
  });

  it('parses line fragments', () => {
    expect(parseLineFragment('L12')).toEqual({ start: 12, end: 12 });
    expect(parseLineFragment('L20-L10')).toEqual({ start: 10, end: 20 });
    expect(parseLineFragment('l3-5')).toEqual({ start: 3, end: 5 });
    expect(parseLineFragment('L0')).toBeNull();
    expect(parseLineFragment('section')).toBeNull();
  });

  it('splits lines without an extra final line', () => {
    expect(splitLines('a\r\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual(['']);
    expect(formatSize(12_400_000)).toBe('11.8 MB');
  });
});

const renderTab = (relPath: string) => {
  useTabs.getState().openCode(relPath);
  const tab = useTabs.getState().tabs.find((t) => t.relPath === relPath);
  if (!tab) throw new Error('no tab');
  return render(
    <Tooltip.Provider>
      <CodeTab tabId={tab.id} relPath={relPath} />
    </Tooltip.Provider>,
  );
};

describe('CodeTab', () => {
  beforeEach(async () => {
    window.__igraspMock?.reset();
    useTabs.setState({ tabs: [], activeId: null });
    useTextFiles.getState().clear();
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  });

  it('shows the file with line numbers and selects a requested line range', async () => {
    useTabs.getState().openCode('src/main.ts', { scroll: { line: 4, endLine: 6 } });
    const tab = useTabs.getState().tabs[0];
    if (!tab) throw new Error('no tab');
    const { container } = render(
      <Tooltip.Provider>
        <CodeTab tabId={tab.id} relPath="src/main.ts" />
      </Tooltip.Provider>,
    );
    await screen.findByText('Read-only');
    await waitFor(() => {
      expect(container.querySelectorAll('.code-line[data-selected]')).toHaveLength(3);
    });
    expect(container.querySelector('.code-ln')?.textContent).toBe('1');
    expect(screen.getByRole('region', { name: /src\/main.ts/ }).textContent).toContain(
      'export function main',
    );
  });

  it('shows a card for binary and huge files', async () => {
    renderTab('assets/logo.bin');
    expect(await screen.findByRole('heading', { name: 'Binary file' })).toBeInTheDocument();
  });

  it('refuses to open scripts with the default app', async () => {
    renderTab('scripts/deploy.sh');
    await screen.findByText('Read-only');
    await userEvent.click(screen.getByRole('button', { name: 'Open in Default Editor' }));
    expect(window.__igraspMock?.state.opened).toEqual([]);
    await act(async () => {
      await useTextFiles.getState().reload('scripts/deploy.sh');
    });
  });

  it('opens text files with the default app', async () => {
    renderTab('Makefile');
    await screen.findByText('Read-only');
    await userEvent.click(screen.getByRole('button', { name: 'Open in Default Editor' }));
    await waitFor(() => {
      expect(window.__igraspMock?.state.opened).toEqual(['editor:Makefile']);
    });
  });
});
