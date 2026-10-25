// Every control that can start an AI operation (action flagged `usesAi`) or opens the AI feature
// (`aiFeature`) shows the marker, and no other control does.

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { MOCK_PROVIDER_NAME } from '../../ipc/mock/mockAi';
import { useAiProvider } from '../../stores/aiProvider';
import { useAiPanel } from '../../stores/aiPanel';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';
import { MenuBar } from './MenuBar';
import { actions } from './menuActions';
import type { ActionId } from './menuActions';
import { ToolbarActions } from './ToolbarActions';
import { ViewportToolbar } from '../ai/ViewportToolbar';

const flagged = (Object.keys(actions) as ActionId[]).filter(
  (id) => actions[id].usesAi || actions[id].aiFeature,
);

beforeEach(async () => {
  window.__igraspMock?.reset();
  useAiPanel.setState({ open: false });
  useAiProvider.setState({ status: null, providers: null });
  await useSettings.getState().load();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

function renderBars() {
  return render(
    <Tooltip.Provider>
      <MenuBar />
      <ToolbarActions />
      <ViewportToolbar />
    </Tooltip.Provider>,
  );
}

describe('the "uses AI" marker', () => {
  it('flags the AI chat action', () => {
    expect(flagged).toContain('ai.chat');
  });

  it('is on exactly the flagged controls of the toolbars', () => {
    renderBars();
    for (const button of screen
      .getAllByRole('toolbar')
      .flatMap((t) => within(t).getAllByRole('button'))) {
      const marked = button.querySelector('[data-ai-mark]') !== null;
      const label = button.getAttribute('aria-label') ?? '';
      const action = (Object.keys(actions) as ActionId[]).find((id) => actions[id].label === label);
      const expected = action !== undefined && flagged.includes(action);
      expect(marked, label).toBe(expected);
    }
    const tools = screen.getByRole('toolbar', { name: 'AI tools' });
    for (const id of ['ai.chat', 'ai.selectText', 'ai.capture'] as const) {
      const button = within(tools).getByRole('button', { name: actions[id].label });
      expect(button.querySelector('[data-ai-mark]')).not.toBeNull();
    }
  });

  it('keeps the AI tools off the window toolbar', () => {
    renderBars();
    const windowBar = screen.getByRole('toolbar', { name: 'Window toolbar' });
    expect(windowBar.querySelector('[data-ai-mark]')).toBeNull();
  });

  it('is on exactly the flagged items of every menu', async () => {
    renderBars();
    for (const title of ['File', 'Edit', 'View', 'Learn', 'Help']) {
      await userEvent.click(screen.getByRole('menuitem', { name: title }));
      const menu = await screen.findByRole('menu');
      for (const item of within(menu).getAllByRole('menuitem')) {
        const label = item.querySelector('.menu-item-label')?.textContent ?? '';
        const action = (Object.keys(actions) as ActionId[]).find(
          (id) => actions[id].label === label,
        );
        const expected = action !== undefined && flagged.includes(action);
        expect(item.querySelector('[data-ai-mark]') !== null, `${title} > ${label}`).toBe(expected);
      }
      await userEvent.keyboard('{Escape}');
    }
  });

  it('names the provider from its status, never from code', async () => {
    renderBars();
    const toolbar = screen.getByRole('toolbar', { name: 'AI tools' });
    const mark = () =>
      within(toolbar)
        .getByRole('button', { name: actions['ai.chat'].label })
        .querySelector<HTMLElement>('[data-ai-mark]');
    // Before any status check the provider list (which probes nothing) names it.
    await waitFor(() => {
      expect(mark()?.title).toContain(`uses ${MOCK_PROVIDER_NAME}`);
    });
    await act(() => useAiProvider.getState().checkStatus());
    expect(mark()?.title).toContain(MOCK_PROVIDER_NAME);
  });
});
