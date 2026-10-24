import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { startEventBridge } from '../../stores/eventBridge';
import { useGraph } from '../../stores/graph';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { BacklinksCount, BacklinksSection } from './BacklinksSection';

let stop: () => void = () => undefined;

beforeEach(async () => {
  window.__igraspMock?.reset();
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

describe('BacklinksSection', () => {
  it('lists the documents linking to the active one and updates live', async () => {
    useTabs.getState().openDocument('README.md');
    render(
      <>
        <span data-testid="count">
          <BacklinksCount />
        </span>
        <BacklinksSection />
      </>,
    );
    expect(await screen.findByText('getting-started.md')).toBeInTheDocument();
    expect(screen.getByText('features')).toBeInTheDocument();
    expect(screen.getByTestId('count').textContent).toBe('1');

    window.__igraspMock?.writeFiles({
      'notes/new.md': '# New\n\nSee the [readme](../README.md).\n',
    });
    expect(await screen.findByText('new.md')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('2');
    });
  });

  it('opens the linking document at the line of the link', async () => {
    useTabs.getState().openDocument('README.md');
    render(<BacklinksSection />);
    await userEvent.click(await screen.findByText('features'));
    const tab = useTabs.getState().tabs.find((t) => t.relPath === 'docs/guide/getting-started.md');
    expect(tab?.pending?.line).toBeGreaterThan(1);
  });

  it('says when nothing links here', async () => {
    useTabs.getState().openDocument('CHANGELOG.md');
    render(<BacklinksSection />);
    expect(await screen.findByText('No other document links here.')).toBeInTheDocument();
  });
});
